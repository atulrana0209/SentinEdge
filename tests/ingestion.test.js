const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, `test_ingest_${Date.now()}.db`);
process.env.DB_PATH = TEST_DB_PATH;

const createApp = require('../server/app');

describe('Event Ingestion & Schema Tests', () => {
  let appInstance;

  before(() => {
    appInstance = createApp();
  });

  after(() => {
    try {
      appInstance.watchdog.stop();
      appInstance.wsManager.close();
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
});
