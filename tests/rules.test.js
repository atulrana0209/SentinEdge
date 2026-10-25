const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const TEST_DB_PATH = path.join(__dirname, `test_rules_${Date.now()}.db`);
process.env.DB_PATH = TEST_DB_PATH;

const createApp = require('../server/app');

describe('Rules Engine & Incident Management Tests', () => {
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
      // safe cleanup
    }
  });

  test('Temperature exceeding threshold triggers a new incident', async () => {
    const event = {
      eventId: 'evt-overheat-01',
      deviceId: 'device-boiler-10',
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 95.5, pressure: 3.2 }
    };

    const res = await appInstance.eventService.processIngestedEvent(event);
    assert.ok(res.matchedRules.includes('High Temperature Alert'));

    const incidents = appInstance.incidentService.getAllIncidents({ deviceId: 'device-boiler-10' });
    assert.strictEqual(incidents.length, 1);
    assert.strictEqual(incidents[0].status, 'OPEN');
    assert.strictEqual(incidents[0].severity, 'CRITICAL');
    assert.strictEqual(incidents[0].occurrence_count, 1);
  });

  test('Repeated matching events do NOT create duplicate incidents (Fatigue Protection)', async () => {
    // Send a 2nd overheat event
    const event2 = {
      eventId: 'evt-overheat-02',
      deviceId: 'device-boiler-10',
      sequenceNumber: 2,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 96.0, pressure: 3.3 }
    };
    await appInstance.eventService.processIngestedEvent(event2);

    // Send a 3rd overheat event
    const event3 = {
      eventId: 'evt-overheat-03',
      deviceId: 'device-boiler-10',
      sequenceNumber: 3,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 97.2, pressure: 3.4 }
    };
    await appInstance.eventService.processIngestedEvent(event3);

    // Verify only ONE incident exists with occurrence count = 3
    const incidents = appInstance.incidentService.getAllIncidents({ deviceId: 'device-boiler-10' });
    assert.strictEqual(incidents.length, 1, 'Should NOT create duplicate incidents for the same condition');
    assert.strictEqual(incidents[0].occurrence_count, 3, 'Should increment occurrence_count');
  });

  test('Incident lifecycle: Acknowledge and Resolve', async () => {
    const incidents = appInstance.incidentService.getAllIncidents({ deviceId: 'device-boiler-10' });
    const targetId = incidents[0].id;

    // Acknowledge
    const acked = appInstance.incidentService.acknowledgeIncident(targetId, 'Senior Engineer John');
    assert.strictEqual(acked.status, 'ACKNOWLEDGED');
    assert.strictEqual(acked.acknowledged_by, 'Senior Engineer John');

    // Resolve
    const resolved = appInstance.incidentService.resolveIncident(targetId, 'Coolant valve replaced. Operating temperature stabilized.');
    assert.strictEqual(resolved.status, 'RESOLVED');
    assert.ok(resolved.resolved_at);

    // Check timeline has audit entries
    const detailed = appInstance.incidentService.getIncidentById(targetId);
    assert.ok(detailed.timeline.length >= 3);
  });

  test('Device silence watchdog marks device OFFLINE and creates silence incident', async () => {
    // Register active device
    await appInstance.eventService.processIngestedEvent({
      eventId: 'evt-silent-01',
      deviceId: 'device-silent-99',
      sequenceNumber: 1,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: { temperature: 22.0 }
    });

    // Manually backdate last_seen_at by 45 seconds (exceeds 30s threshold)
    const staleTime = new Date(Date.now() - 45000).toISOString();
    appInstance.db.exec(`UPDATE devices SET last_seen_at = '${staleTime}' WHERE id = 'device-silent-99';`);

    // Run watchdog check
    appInstance.watchdog.checkDevices();

    // Verify device is now marked OFFLINE
    const device = appInstance.deviceService.getDeviceById('device-silent-99');
    assert.strictEqual(device.status, 'OFFLINE');

    // Verify silence incident was created
    const incidents = appInstance.incidentService.getAllIncidents({ deviceId: 'device-silent-99' });
    assert.ok(incidents.length >= 1);
    assert.strictEqual(incidents[0].rule_name, 'Device Silence / Offline Watchdog');
  });
});
