const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, `test_resilience_${Date.now()}.db`);
process.env.DB_PATH = TEST_DB_PATH;

let createApp = require('../server/app');
const notificationService = require('../server/services/notificationService');

describe('Reliability, Resilience & Circuit Breaker Tests', () => {
  let appInstance;

  before(() => {
    appInstance = createApp();
  });

  after(() => {
    try {
      if (appInstance) {
        appInstance.watchdog.stop();
        appInstance.wsManager.close();
        appInstance.db.close();
      }
      if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
      if (fs.existsSync(TEST_DB_PATH + '-wal')) fs.unlinkSync(TEST_DB_PATH + '-wal');
      if (fs.existsSync(TEST_DB_PATH + '-shm')) fs.unlinkSync(TEST_DB_PATH + '-shm');
    } catch (e) {
      // safe cleanup
    }
  });

  test('Notification Service Circuit Breaker trips to OPEN on repeated external failures', async () => {
    notificationService.setSimulatedFailure(true);
    notificationService.failureThreshold = 3;
    notificationService.failureCount = 0;
    notificationService.state = 'CLOSED';

    const sampleIncident = {
      id: 'inc-test-cb',
      severity: 'CRITICAL',
      title: 'Circuit Breaker Test Incident',
      summary: 'Testing circuit failure transitions'
    };

    // 1st failure
    const r1 = await notificationService.sendIncidentNotification(sampleIncident);
    assert.strictEqual(r1.success, false);
    assert.strictEqual(notificationService.failureCount, 1);

    // 2nd failure
    const r2 = await notificationService.sendIncidentNotification(sampleIncident);
    assert.strictEqual(r2.success, false);
    assert.strictEqual(notificationService.failureCount, 2);

    // 3rd failure -> trips circuit to OPEN
    const r3 = await notificationService.sendIncidentNotification(sampleIncident);
    assert.strictEqual(r3.success, false);
    assert.strictEqual(notificationService.state, 'OPEN');

    // 4th delivery attempt while OPEN should be short-circuited and buffered without attempting external call
    const r4 = await notificationService.sendIncidentNotification(sampleIncident);
    assert.strictEqual(r4.buffered, true);
    assert.strictEqual(r4.state, 'OPEN');

    // Recover external service
    notificationService.setSimulatedFailure(false);
  });

  test('Database persistence across simulated application / worker restart', async () => {
    const event = {
      eventId: 'evt-persist-test-99',
      deviceId: 'device-restart-test',
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 42.0, battery: 88 }
    };
    await appInstance.eventService.processIngestedEvent(event);

    const devBefore = appInstance.deviceService.getDeviceById('device-restart-test');
    assert.ok(devBefore);

    // SIMULATE PROCESS RESTART: Stop background jobs and close current DB
    appInstance.watchdog.stop();
    appInstance.wsManager.close();
    appInstance.db.close();

    // Invalidate require cache to simulate fresh cold boot
    delete require.cache[require.resolve('../server/db/database')];
    delete require.cache[require.resolve('../server/app')];
    createApp = require('../server/app');

    // Re-initialize application from disk database
    const restartedApp = createApp();

    // Verify all state is persisted across restart!
    const devAfter = restartedApp.deviceService.getDeviceById('device-restart-test');
    assert.ok(devAfter, 'Device should persist after process restart');
    assert.strictEqual(devAfter.id, 'device-restart-test');
    assert.strictEqual(devAfter.total_events, 1);

    // Replace appInstance with restarted instance for subsequent tests
    appInstance = restartedApp;
  });

  test('Ingestion Queue backpressure rejection when buffer capacity is exceeded', () => {
    // Set small capacity for test and disable auto-processing temporarily
    appInstance.ingestionQueue.maxCapacity = 2;
    appInstance.ingestionQueue.isProcessing = true; // prevent draining while testing queue overflow

    // Enqueue 1
    const q1 = appInstance.ingestionQueue.enqueue({ id: 'evt-q1' });
    assert.strictEqual(q1.queued, true);

    // Enqueue 2
    const q2 = appInstance.ingestionQueue.enqueue({ id: 'evt-q2' });
    assert.strictEqual(q2.queued, true);

    // Enqueue 3 should trigger backpressure HTTP 429
    assert.throws(() => {
      appInstance.ingestionQueue.enqueue({ id: 'evt-q3' });
    }, (err) => {
      return err.status === 429 && err.retryAfter === 2;
    });

    // Reset capacity and processing state
    appInstance.ingestionQueue.queue = [];
    appInstance.ingestionQueue.isProcessing = false;
    appInstance.ingestionQueue.maxCapacity = 5000;
  });
});
