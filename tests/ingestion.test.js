const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const dedupCache = require('../server/engine/dedupCache');

const TEST_DB_PATH = path.join(__dirname, `test_ingest_${Date.now()}.db`);
process.env.DB_PATH = TEST_DB_PATH;

const createApp = require('../server/app');

describe('Event Ingestion & Schema Tests', () => {
  let appInstance;
  let serverPort;

  before(async () => {
    appInstance = createApp();
    // Bind server to ephemeral port for HTTP route verification
    await new Promise((resolve) => {
      appInstance.server.listen(0, () => {
        serverPort = appInstance.server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    try {
      appInstance.watchdog.stop();
      appInstance.wsManager.close();
      await new Promise((resolve) => appInstance.server.close(resolve));
      appInstance.db.close();
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
      if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');
    } catch (e) {
      // non-critical cleanup
    }
  });

  test('Normal Telemetry Event Ingestion succeeds and auto-provisions device', async () => {
    const event = {
      eventId: 'test-evt-001',
      deviceId: 'device-test-alpha',
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 24.5, battery: 95 }
    };

    const result = await appInstance.eventService.processIngestedEvent(event);
    assert.strictEqual(result.status, 'PROCESSED');
    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.isOutOfOrder, false);

    const device = appInstance.deviceService.getDeviceById('device-test-alpha');
    assert.ok(device);
    assert.strictEqual(device.status, 'ONLINE');
    assert.strictEqual(device.total_events, 1);
  });

  test('Duplicate Event Delivery is safely deduplicated and ignored', async () => {
    const event = {
      eventId: 'test-evt-dup-100',
      deviceId: 'device-test-alpha',
      sequenceNumber: 2,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 25.0 }
    };

    // First arrival
    const res1 = await appInstance.eventService.processIngestedEvent(event);
    assert.strictEqual(res1.status, 'PROCESSED');
    assert.strictEqual(res1.isDuplicate, false);

    // Duplicate arrival with exact same eventId
    const res2 = await appInstance.eventService.processIngestedEvent(event);
    assert.strictEqual(res2.isDuplicate, true);
    assert.strictEqual(res2.status, 'DUPLICATE_IGNORED');
  });

  test('Race duplicate hitting SQLite PRIMARY KEY constraint directly does NOT throw 500 or pollute DLQ', async () => {
    const event = {
      eventId: 'test-evt-sqlite-constraint-race',
      deviceId: 'device-test-alpha',
      sequenceNumber: 3,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 25.5 }
    };

    // First delivery
    const res1 = await appInstance.eventService.processIngestedEvent(event);
    assert.strictEqual(res1.status, 'PROCESSED');

    // Simulate in-memory LRU eviction or second concurrent worker: clear in-memory cache
    dedupCache.clear();

    const initialDlqCount = appInstance.db.prepare('SELECT COUNT(*) as count FROM dlq_events').get().count;

    // Second delivery bypasses in-memory cache and hits SQLite PRIMARY KEY constraint directly
    const res2 = await appInstance.eventService.processIngestedEvent(event);
    assert.strictEqual(res2.isDuplicate, true);
    assert.strictEqual(res2.status, 'DUPLICATE_IGNORED');

    // Verify DLQ was NOT polluted with this valid duplicate retry
    const finalDlqCount = appInstance.db.prepare('SELECT COUNT(*) as count FROM dlq_events').get().count;
    assert.strictEqual(finalDlqCount, initialDlqCount, 'DLQ should not be incremented for duplicate database collision');
  });

  test('Out-of-order sequence arrival is detected and does not regress device sequence', async () => {
    // Advanced sequence 50
    await appInstance.eventService.processIngestedEvent({
      eventId: 'test-evt-seq-50',
      deviceId: 'device-test-alpha',
      sequenceNumber: 50,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 26.0 }
    });

    const devState1 = appInstance.deviceService.getDeviceById('device-test-alpha');
    assert.strictEqual(devState1.last_sequence_number, 50);

    // Delayed older sequence 30 arrives
    const outOfOrderResult = await appInstance.eventService.processIngestedEvent({
      eventId: 'test-evt-seq-30',
      deviceId: 'device-test-alpha',
      sequenceNumber: 30,
      timestamp: new Date(Date.now() - 30000).toISOString(),
      type: 'telemetry',
      payload: { temperature: 23.0 }
    });

    assert.strictEqual(outOfOrderResult.isOutOfOrder, true);

    // Device state should NOT have regressed to 30!
    const devState2 = appInstance.deviceService.getDeviceById('device-test-alpha');
    assert.strictEqual(devState2.last_sequence_number, 50);
  });

  test('Out-of-order telemetry does NOT evaluate active rules (prevents false active alerts)', async () => {
    // Current sequence on device is 50. Delayed historical sequence 20 arrives with CRITICAL temperature 99°C
    const delayedSpikeEvent = {
      eventId: 'test-evt-seq-20-stale-spike',
      deviceId: 'device-test-alpha',
      sequenceNumber: 20,
      timestamp: new Date(Date.now() - 120000).toISOString(),
      type: 'telemetry',
      payload: { temperature: 99.0 } // Exceeds 80°C threshold!
    };

    const outOfOrderResult = await appInstance.eventService.processIngestedEvent(delayedSpikeEvent);
    assert.strictEqual(outOfOrderResult.isOutOfOrder, true);
    assert.strictEqual(outOfOrderResult.rulesEvaluated, 0, 'Active rule evaluation should be suppressed for out-of-order events');
    assert.deepStrictEqual(outOfOrderResult.matchedRules, []);

    // Ensure no incident was created for device-test-alpha
    const incidents = appInstance.incidentService.getAllIncidents({ deviceId: 'device-test-alpha' });
    const overheatIncidents = incidents.filter(i => i.rule_id === 'rule-temp-overheat');
    assert.strictEqual(overheatIncidents.length, 0, 'Out-of-order historic event must not trigger active incident');
  });

  test('Malformed payload is rejected and routed to Dead Letter Queue (DLQ)', async () => {
    const invalidEvent = {
      // missing eventId
      deviceId: 'device-test-beta',
      timestamp: 'not-a-date',
      payload: null
    };

    const validation = appInstance.eventService.validatePayload(invalidEvent);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.length >= 2);

    const dlqId = appInstance.ingestionQueue.sendToDlq(invalidEvent, 'TEST_MALFORMED', validation.errors.join('; '));
    assert.ok(dlqId.startsWith('dlq-'));

    const dlqItem = appInstance.dlqService.getById(dlqId);
    assert.ok(dlqItem);
    assert.strictEqual(dlqItem.reason, 'TEST_MALFORMED');
    assert.strictEqual(dlqItem.status, 'PENDING');
  });

  test('HTTP Ingestion Route enforces bounded queue capacity with HTTP 429 backpressure and Retry-After header', async () => {
    // Artificially saturate queue capacity to test route-level backpressure
    appInstance.ingestionQueue.maxCapacity = 1;
    appInstance.ingestionQueue.queue.push({ item: { dummy: 1 } }); // Queue is now at 1/1 capacity

    const res = await fetch(`http://localhost:${serverPort}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: 'test-evt-overflow',
        deviceId: 'device-test-alpha',
        sequenceNumber: 99,
        timestamp: new Date().toISOString(),
        type: 'telemetry',
        payload: { temperature: 20 }
      })
    });

    assert.strictEqual(res.status, 429, 'Route must return HTTP 429 when queue capacity is reached');
    assert.strictEqual(res.headers.get('retry-after'), '2');

    const body = await res.json();
    assert.strictEqual(body.success, false);
    assert.strictEqual(body.retryAfter, 2);

    // Reset queue capacity
    appInstance.ingestionQueue.queue = [];
    appInstance.ingestionQueue.maxCapacity = 5000;
  });

  test('Database transaction rolls back atomically if a failure occurs during event processing', async () => {
    const deviceId = 'device-test-atomic-rollback';
    const eventId = 'evt-atomic-fail-001';

    // Mock an unexpected error during rule evaluation inside the transaction
    const originalEvaluateEvent = appInstance.ruleEngine.evaluateEvent;
    appInstance.ruleEngine.evaluateEvent = () => {
      throw new Error('SIMULATED_MID_TRANSACTION_FAILURE');
    };

    const testEvent = {
      eventId: eventId,
      deviceId: deviceId,
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 25.0 }
    };

    let caughtError = null;
    try {
      await appInstance.eventService.processIngestedEvent(testEvent);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError);
    assert.strictEqual(caughtError.message, 'SIMULATED_MID_TRANSACTION_FAILURE');

    // VERIFY TRANSACTION ROLLBACK: Device should NOT exist in database, and event should NOT exist
    const dev = appInstance.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    assert.strictEqual(dev, undefined, 'Device insert must be completely rolled back');

    const evt = appInstance.db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    assert.strictEqual(evt, undefined, 'Event insert must be completely rolled back');

    // Restore original method
    appInstance.ruleEngine.evaluateEvent = originalEvaluateEvent;
  });
});
