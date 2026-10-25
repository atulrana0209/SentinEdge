const dedupCache = require('../engine/dedupCache');

/**
 * Event ingestion and processing pipeline.
 * Validates schemas, eliminates duplicates, reconciles device states,
 * and routes to the rule evaluation engine.
 */
class EventService {
  constructor(db, deviceService, ruleEngine, wsBroadcaster) {
    this.db = db;
    this.deviceService = deviceService;
    this.ruleEngine = ruleEngine;
    this.wsBroadcaster = wsBroadcaster;
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  /**
   * Validate incoming raw event payload.
   * Returns validation errors if malformed.
   */
  validatePayload(raw) {
    const errors = [];
    if (!raw || typeof raw !== 'object') {
      errors.push('Event payload must be a non-null JSON object');
      return { valid: false, errors };
    }

    const eventId = raw.eventId || raw.id;
    if (!eventId || typeof eventId !== 'string' || eventId.trim() === '') {
      errors.push("Missing or invalid 'eventId' (must be a non-empty string)");
    }

    const deviceId = raw.deviceId || raw.device_id;
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
      errors.push("Missing or invalid 'deviceId' (must be a non-empty string)");
    }

    const eventType = raw.type || raw.eventType || raw.event_type;
    if (!eventType || typeof eventType !== 'string') {
      errors.push("Missing or invalid 'type' (e.g. telemetry, heartbeat, alert)");
    }

    const timestamp = raw.timestamp;
    const isValidDate = timestamp && !isNaN(new Date(timestamp).getTime());
    if (!isValidDate) {
      errors.push("Missing or invalid 'timestamp' (must be valid ISO-8601 string)");
    }

    const payload = raw.payload;
    if (payload === undefined || payload === null || typeof payload !== 'object') {
      errors.push("Missing or invalid 'payload' (must be an object containing metric data)");
    }

    return {
      valid: errors.length === 0,
      errors,
      normalized: {
        id: eventId,
        deviceId: deviceId,
        timestamp: isValidDate ? new Date(timestamp).toISOString() : new Date().toISOString(),
        eventType: eventType,
        sequenceNumber: raw.sequenceNumber ?? raw.sequence_number ?? 0,
        payload: payload,
        metadata: raw.metadata || {}
      }
    };
  }

  /**
   * Core ingestion pipeline for a single event.
   */
  async processIngestedEvent(rawEvent) {
    // 1. Validation
    const validation = this.validatePayload(rawEvent);
    if (!validation.valid) {
      const err = new Error(`Malformed event payload: ${validation.errors.join('; ')}`);
      err.status = 400;
      err.validationErrors = validation.errors;
      throw err;
    }

    const event = validation.normalized;

    // 2. Deduplication check
    const isDuplicate = dedupCache.isDuplicate(event.id, this.db);
    if (isDuplicate) {
      // Return idempotent success without running rules again
      return {
        id: event.id,
        deviceId: event.deviceId,
        status: 'DUPLICATE_IGNORED',
        isDuplicate: true,
        message: 'Event was already ingested and processed previously.'
      };
    }

    // 3. Device state update and out-of-order check
    const { device, isOutOfOrder, wasOffline } = this.deviceService.upsertDeviceForEvent(
      event.deviceId,
      event.timestamp,
      event.sequenceNumber,
      event.metadata
    );

    // 4. Persist event into database
    const payloadJson = JSON.stringify(event.payload);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO events (
        id, device_id, sequence_number, timestamp, received_at, event_type, payload, is_duplicate, is_out_of_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      event.id,
      event.deviceId,
      event.sequenceNumber,
      event.timestamp,
      now,
      event.eventType,
      payloadJson,
      isOutOfOrder ? 1 : 0
    );

    const savedEvent = {
      id: event.id,
      deviceId: event.deviceId,
      sequenceNumber: event.sequenceNumber,
      timestamp: event.timestamp,
      receivedAt: now,
      eventType: event.eventType,
      payload: event.payload,
      isOutOfOrder,
      isDuplicate: false
    };

    // 5. Broadcast to connected real-time dashboard operators
    if (this.wsBroadcaster) {
      this.wsBroadcaster('event:new', {
        event: savedEvent,
        device: {
          id: device.id,
          name: device.name,
          status: device.status
        }
      });
    }

    // 6. Evaluate against Rule Engine
    const ruleMatches = this.ruleEngine.evaluateEvent({
      id: event.id,
      device_id: event.deviceId,
      event_type: event.eventType,
      payload: event.payload,
      timestamp: event.timestamp
    }, device);

    return {
      id: event.id,
      deviceId: event.deviceId,
      status: 'PROCESSED',
      isDuplicate: false,
      isOutOfOrder,
      wasOffline,
      rulesEvaluated: ruleMatches.length,
      matchedRules: ruleMatches.map(m => m.rule.name)
    };
  }

  getRecentEvents(limit = 100, filters = {}) {
    let query = 'SELECT * FROM events';
    const params = [];
    const conditions = [];

    if (filters.deviceId) {
      conditions.push('device_id = ?');
      params.push(filters.deviceId);
    }
    if (filters.eventType) {
      conditions.push('event_type = ?');
      params.push(filters.eventType);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY received_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      payload: JSON.parse(r.payload)
    }));
  }
}

module.exports = EventService;
