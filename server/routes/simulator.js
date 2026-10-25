const express = require('express');
const { v4: uuidv4 } = require('uuid');

module.exports = function createSimulatorRouter(eventService, ingestionQueue, db) {
  const router = express.Router();

  // Helper to generate simulated telemetry payload
  const createSamplePayload = (deviceId, custom = {}) => ({
    temperature: +(20 + Math.random() * 15).toFixed(1),
    humidity: +(40 + Math.random() * 20).toFixed(1),
    battery: +(80 + Math.random() * 20).toFixed(1),
    vibration: +(0.1 + Math.random() * 0.5).toFixed(2),
    status: 'NORMAL',
    ...custom
  });

  // 1. Send normal telemetry
  router.post('/send-normal', async (req, res) => {
    try {
      const deviceId = req.body.deviceId || 'device-001';
      const event = {
        eventId: `evt-${uuidv4().substring(0, 8)}`,
        deviceId: deviceId,
        sequenceNumber: req.body.sequenceNumber || Date.now() % 100000,
        timestamp: new Date().toISOString(),
        type: 'telemetry',
        payload: createSamplePayload(deviceId, req.body.payload || {}),
        metadata: { location: req.body.location || 'Warehouse Alpha' }
      };

      const result = await eventService.processIngestedEvent(event);
      return res.json({ success: true, event, result });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Send duplicate event (sends first event, then resends exact same ID)
  router.post('/send-duplicate', async (req, res) => {
    try {
      const deviceId = req.body.deviceId || 'device-002';
      const fixedEventId = `dup-${uuidv4().substring(0, 8)}`;
      const event = {
        eventId: fixedEventId,
        deviceId: deviceId,
        sequenceNumber: 101,
        timestamp: new Date().toISOString(),
        type: 'telemetry',
        payload: createSamplePayload(deviceId, { note: 'Initial event delivery' })
      };

      // First delivery
      const firstResult = await eventService.processIngestedEvent(event);

      // Duplicate delivery with identical eventId
      const duplicateResult = await eventService.processIngestedEvent({
        ...event,
        payload: createSamplePayload(deviceId, { note: 'Duplicate retry attempt' })
      });

      return res.json({
        success: true,
        eventId: fixedEventId,
        firstDelivery: firstResult,
        duplicateDelivery: duplicateResult
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Send out-of-order events (higher sequence first, then lower sequence)
  router.post('/send-out-of-order', async (req, res) => {
    try {
      const deviceId = req.body.deviceId || 'device-003';

      // Advanced sequence #50
      const eventNew = {
        eventId: `evt-seq50-${uuidv4().substring(0, 6)}`,
        deviceId: deviceId,
        sequenceNumber: 50,
        timestamp: new Date().toISOString(),
        type: 'telemetry',
        payload: createSamplePayload(deviceId, { note: 'Sequence 50' })
      };
      await eventService.processIngestedEvent(eventNew);

      // Delayed older sequence #35 arriving later
      const delayedTimestamp = new Date(Date.now() - 60000).toISOString();
      const eventOld = {
        eventId: `evt-seq35-${uuidv4().substring(0, 6)}`,
        deviceId: deviceId,
        sequenceNumber: 35,
        timestamp: delayedTimestamp,
        type: 'telemetry',
        payload: createSamplePayload(deviceId, { note: 'Delayed Sequence 35 arriving out of order' })
      };
      const resultOld = await eventService.processIngestedEvent(eventOld);

      return res.json({
        success: true,
        message: 'Out-of-order sequence delivered',
        firstDelivered: eventNew,
        outOfOrderDelivered: eventOld,
        result: resultOld
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Send malformed event (missing required fields or invalid types)
  router.post('/send-malformed', async (req, res) => {
    try {
      const malformedPayload = req.body.payload || {
        // Missing eventId, missing type, invalid timestamp
        deviceId: 'device-malformed',
        timestamp: 'invalid-date-format',
        payload: 'not-an-object'
      };

      try {
        await eventService.processIngestedEvent(malformedPayload);
        return res.json({ success: true, message: 'Processed unexpectedly' });
      } catch (validationErr) {
        // Sent to DLQ
        const dlqId = ingestionQueue.sendToDlq(malformedPayload, 'MALFORMED_PAYLOAD', validationErr.message);
        return res.status(400).json({
          success: false,
          error: validationErr.message,
          quarantinedInDlqId: dlqId
        });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. Send sudden burst of incoming buffered events (e.g. 15 events replayed on reconnect)
  router.post('/send-burst', async (req, res) => {
    try {
      const count = parseInt(req.body.count, 10) || 15;
      const deviceId = req.body.deviceId || 'device-buffered-004';
      const events = [];

      const baseTime = Date.now() - (count * 2000);
      for (let i = 1; i <= count; i++) {
        events.push({
          eventId: `burst-${uuidv4().substring(0, 8)}`,
          deviceId: deviceId,
          sequenceNumber: i,
          timestamp: new Date(baseTime + i * 2000).toISOString(),
          type: 'telemetry',
          payload: createSamplePayload(deviceId, {
            sampleIndex: i,
            buffered: true,
            temperature: +(22 + Math.sin(i) * 5).toFixed(1)
          })
        });
      }

      const results = [];
      for (const evt of events) {
        const r = await eventService.processIngestedEvent(evt);
        results.push(r);
      }

      return res.json({
        success: true,
        message: `Successfully replayed burst of ${count} buffered events`,
        deviceId,
        resultsCount: results.length
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. Trigger overheat condition (> 80°C)
  router.post('/send-overheat', async (req, res) => {
    try {
      const deviceId = req.body.deviceId || 'device-001';
      const temp = req.body.temperature || 88.5;
      const event = {
        eventId: `evt-temp-${uuidv4().substring(0, 8)}`,
        deviceId: deviceId,
        sequenceNumber: Date.now() % 100000,
        timestamp: new Date().toISOString(),
        type: 'telemetry',
        payload: createSamplePayload(deviceId, {
          temperature: temp,
          status: 'WARNING_OVERHEAT'
        })
      };

      const result = await eventService.processIngestedEvent(event);
      return res.json({
        success: true,
        message: `High temperature reading of ${temp}°C sent to ${deviceId}`,
        event,
        result
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. Trigger low battery condition (< 15%)
  router.post('/send-low-battery', async (req, res) => {
    try {
      const deviceId = req.body.deviceId || 'device-002';
      const battery = req.body.battery || 9.2;
      const event = {
        eventId: `evt-bat-${uuidv4().substring(0, 8)}`,
        deviceId: deviceId,
        sequenceNumber: Date.now() % 100000,
        timestamp: new Date().toISOString(),
        type: 'telemetry',
        payload: createSamplePayload(deviceId, {
          battery: battery,
          status: 'LOW_POWER'
        })
      };

      const result = await eventService.processIngestedEvent(event);
      return res.json({
        success: true,
        message: `Critical battery reading of ${battery}% sent to ${deviceId}`,
        event,
        result
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8. Trigger critical fault event
  router.post('/send-fault', async (req, res) => {
    try {
      const deviceId = req.body.deviceId || 'device-003';
      const event = {
        eventId: `evt-fault-${uuidv4().substring(0, 8)}`,
        deviceId: deviceId,
        sequenceNumber: Date.now() % 100000,
        timestamp: new Date().toISOString(),
        type: 'FAULT',
        payload: {
          errorCode: 'ERR_ACTUATOR_JAM',
          severity: 'CRITICAL',
          description: 'Mechanical actuator stalled due to resistance.',
          status: 'FAULT'
        }
      };

      const result = await eventService.processIngestedEvent(event);
      return res.json({
        success: true,
        message: `Critical FAULT event sent to ${deviceId}`,
        event,
        result
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9. Simulate device disconnection (set last seen to 45 seconds ago so watchdog triggers)
  router.post('/disconnect-device', (req, res) => {
    try {
      const deviceId = req.body.deviceId || 'device-001';
      const staleTime = new Date(Date.now() - 45000).toISOString();

      db.prepare(`
        UPDATE devices
        SET last_seen_at = ?, status = 'ONLINE'
        WHERE id = ?
      `).run(staleTime, deviceId);

      return res.json({
        success: true,
        message: `Device ${deviceId} last seen rolled back to 45s ago. Watchdog will mark it OFFLINE within 5s.`,
        deviceId,
        staleLastSeen: staleTime
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
