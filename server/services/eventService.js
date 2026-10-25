const dedupCache = require('../engine/dedupCache');

/**
 * Event ingestion and processing pipeline for SentinEdge.
 * Validates schemas, guarantees ACID transactional persistence, eliminates duplicates,
 * preserves monotonic device states, guards against out-of-order false alarms,
 * and routes to the rule evaluation engine.
 */
class EventService {
  constructor(db, deviceService, ruleEngine, wsBroadcaster) {
    this.db = db;
    this.deviceService = deviceService;
    this.ruleEngine = ruleEngine;
    this.wsBroadcaster = wsBroadcaster;

    // Prepared statements compiled once for optimal throughput
    this.insertEventStmt = this.db.prepare(`
      INSERT INTO events (
        id, device_id, sequence_number, timestamp, received_at, event_type, payload, is_duplicate, is_out_of_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);
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
   * Core ingestion pipeline with ACID transactional guarantees and idempotency.
   */
  async processIngestedEvent(rawEvent) {
    // 1. Validation check
    const validation = this.validatePayload(rawEvent);
    if (!validation.valid) {
      const err = new Error(`Malformed event payload: ${validation.errors.join('; ')}`);
      err.status = 400;
      err.validationErrors = validation.errors;
      throw err;
    }

    const event = validation.normalized;

    // 2. Fast-path in-memory deduplication check
    const isDuplicate = dedupCache.isDuplicate(event.id, this.db);
    if (isDuplicate) {
      return {
        id: event.id,
        deviceId: event.deviceId,
        status: 'DUPLICATE_IGNORED',
        isDuplicate: true,
        isOutOfOrder: false,
        wasOffline: false,
        rulesEvaluated: 0,
        matchedRules: [],
        message: 'Event was already ingested and processed previously.'
      };
    }

    // 3. ATOMIC ACID TRANSACTION: Wraps device state update, event insert, and rule evaluation
    const executeAtomicTransaction = this.db.transaction(() => {
      // Step A: Device state monotonic update & out-of-order sequence check
      const { device, isOutOfOrder, wasOffline } = this.deviceService.upsertDeviceForEvent(
        event.deviceId,
        event.timestamp,
        event.sequenceNumber,
        event.metadata
      );

      // Step B: Persist event to database with primary key duplicate protection
      const payloadJson = JSON.stringify(event.payload);
      const now = new Date().toISOString();

      try {
        this.insertEventStmt.run(
          event.id,
          event.deviceId,
          event.sequenceNumber,
          event.timestamp,
          now,
          event.eventType,
          payloadJson,
          isOutOfOrder ? 1 : 0
        );
      } catch (dbErr) {
        // Handle database-level unique constraint collision cleanly without throwing 500 or polluting DLQ
        const isConstraint =
          dbErr.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
          dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
          (dbErr.message && (
            dbErr.message.includes('UNIQUE constraint') ||
            dbErr.message.includes('PRIMARY KEY')
          ));

        if (isConstraint) {
          dedupCache.record(event.id);
          return {
            id: event.id,
            deviceId: event.deviceId,
            status: 'DUPLICATE_IGNORED',
            isDuplicate: true,
            isOutOfOrder: false,
            wasOffline: false,
            rulesEvaluated: 0,
            matchedRules: [],
            message: 'Event was already ingested and recorded in database.'
          };
        }
        throw dbErr;
      }

      // Step C: Rule Engine Evaluation
      // OUT-OF-ORDER GUARD: Stale historical events arriving out-of-order MUST NOT trigger active operational alerts
      let ruleMatches = [];
      if (!isOutOfOrder) {
        ruleMatches = this.ruleEngine.evaluateEvent({
          id: event.id,
          device_id: event.deviceId,
          event_type: event.eventType,
          payload: event.payload,
          timestamp: event.timestamp
        }, device);
      } else {
        this.ruleEngine.logTrace(
          event.id,
          event.deviceId,
          'SYS_OUT_OF_ORDER',
          'Out-of-Order Ingestion Guard',
          0,
          `Telemetry arrived out-of-order (Seq #${event.sequenceNumber} < Device Seq #${device.last_sequence_number}). Stored for analytics; active rule evaluation suppressed.`
        );
      }

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

      return {
        id: event.id,
        deviceId: event.deviceId,
        status: 'PROCESSED',
        isDuplicate: false,
        isOutOfOrder,
        wasOffline,
        rulesEvaluated: ruleMatches.length,
        matchedRules: ruleMatches.map(m => (m.rule ? m.rule.name : m.rule_name || m.name || 'Rule')),
        _savedEvent: savedEvent,
        _device: device
      };
    });

    const outcome = executeAtomicTransaction();

    // 4. Broadcast to connected real-time dashboard operators (executed outside DB transaction)
    if (!outcome.isDuplicate && this.wsBroadcaster && outcome._savedEvent) {
      this.wsBroadcaster('event:new', {
        event: outcome._savedEvent,
        device: {
          id: outcome._device.id,
          name: outcome._device.name,
          status: outcome._device.status
        }
      });
    }

    // Clean internal properties before returning
    delete outcome._savedEvent;
    delete outcome._device;

    return outcome;
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
