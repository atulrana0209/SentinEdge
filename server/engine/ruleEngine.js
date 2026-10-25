const { v4: uuidv4 } = require('uuid');
const notificationService = require('../services/notificationService');

/**
 * Rule Engine for evaluating real-time events and device states against user-defined rules.
 * Implements incident deduplication / alert fatigue protection and evaluation audit tracing.
 */
class RuleEngine {
  constructor(db, wsBroadcaster) {
    this.db = db;
    this.wsBroadcaster = wsBroadcaster;
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  /**
   * Evaluates an ingested event against all active rules.
   * @param {Object} event
   * @param {Object} device
   * @returns {Array<Object>} list of matched rules and incident outcomes
   */
  evaluateEvent(event, device) {
    const results = [];
    const activeRules = this.db.prepare('SELECT * FROM rules WHERE is_enabled = 1').all();

    for (const rule of activeRules) {
      // 1. Device filter check
      if (rule.device_filter && rule.device_filter !== event.device_id) {
        this.logTrace(event.id, event.device_id, rule.id, rule.name, 0, `Skipped: Rule restricted to device ${rule.device_filter}`);
        continue;
      }

      let matched = false;
      let reason = '';

      // 2. Evaluate based on rule type
      if (rule.rule_type === 'THRESHOLD') {
        const evalResult = this.evaluateThreshold(rule, event);
        matched = evalResult.matched;
        reason = evalResult.reason;
      } else if (rule.rule_type === 'EVENT_TYPE') {
        const evalResult = this.evaluateEventType(rule, event);
        matched = evalResult.matched;
        reason = evalResult.reason;
      } else if (rule.rule_type === 'HEARTBEAT_TIMEOUT') {
        // Heartbeat timeout is evaluated by the watchdog, not per-event
        continue;
      }

      this.logTrace(event.id, event.device_id, rule.id, rule.name, matched ? 1 : 0, reason);

      if (matched) {
        const incidentOutcome = this.handleIncidentTrigger(rule, device, event, reason);
        results.push({ rule, matched: true, incidentOutcome });
      }
    }

    return results;
  }

  evaluateThreshold(rule, event) {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    const metricVal = payload[rule.metric_key];

    if (metricVal === undefined || metricVal === null || isNaN(Number(metricVal))) {
      return {
        matched: false,
        reason: `Metric '${rule.metric_key}' missing or not numeric in event payload.`
      };
    }

    const val = Number(metricVal);
    const target = Number(rule.threshold_value);
    let matched = false;

    switch (rule.operator) {
      case '>': matched = val > target; break;
      case '<': matched = val < target; break;
      case '>=': matched = val >= target; break;
      case '<=': matched = val <= target; break;
      case '==': matched = val === target; break;
      case '!=': matched = val !== target; break;
      default: matched = false;
    }

    const reason = matched
      ? `Condition met: payload.${rule.metric_key} (${val}) ${rule.operator} ${target}`
      : `Condition not met: payload.${rule.metric_key} (${val}) ${rule.operator} ${target} is false`;

    return { matched, reason };
  }

  evaluateEventType(rule, event) {
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    const target = (rule.event_type_filter || '').toUpperCase();
    const eventType = (event.event_type || '').toUpperCase();
    const payloadStatus = (payload.status || payload.eventType || payload.type || '').toUpperCase();

    const matched = eventType === target || payloadStatus === target || eventType.includes(target);
    const reason = matched
      ? `Event type / status matched filter '${target}' (event_type: '${event.event_type}', status: '${payloadStatus}')`
      : `Event type '${event.event_type}' does not match filter '${target}'`;

    return { matched, reason };
  }

  /**
   * Handles incident creation or deduplication/grouping.
   * If an active (OPEN / ACKNOWLEDGED) incident exists for this rule and device,
   * we update occurrence count and last seen instead of creating a spam duplicate.
   */
  handleIncidentTrigger(rule, device, event, reason) {
    const existing = this.db.prepare(`
      SELECT * FROM incidents
      WHERE rule_id = ? AND device_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED')
      ORDER BY first_seen_at DESC LIMIT 1
    `).get(rule.id, device.id);

    const now = new Date().toISOString();
    const payloadJson = typeof event?.payload === 'string' ? event.payload : JSON.stringify(event?.payload || {});

    if (existing) {
      // DEDUPLICATION: Increment existing incident occurrence count
      const updatedCount = existing.occurrence_count + 1;
      this.db.prepare(`
        UPDATE incidents
        SET occurrence_count = ?,
            last_seen_at = ?,
            trigger_payload = ?
        WHERE id = ?
      `).run(updatedCount, now, payloadJson, existing.id);

      // Record timeline event
      this.db.prepare(`
        INSERT INTO incident_events (incident_id, event_id, timestamp, details)
        VALUES (?, ?, ?, ?)
      `).run(existing.id, event?.id || null, now, reason);

      const updatedIncident = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(existing.id);

      if (this.wsBroadcaster) {
        this.wsBroadcaster('incident:updated', updatedIncident);
      }

      return { action: 'DEDUPLICATED', incident: updatedIncident };
    }

    // NEW INCIDENT: Create new incident record
    const incidentId = `inc-${uuidv4().substring(0, 8)}`;
    const title = `${rule.name} on ${device.name || device.id}`;
    const summary = `${reason}. Triggered on device ${device.id} at ${now}`;

    this.db.prepare(`
      INSERT INTO incidents (
        id, rule_id, rule_name, device_id, device_name, severity, status,
        title, summary, trigger_payload, occurrence_count, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, 1, ?, ?)
    `).run(
      incidentId,
      rule.id,
      rule.name,
      device.id,
      device.name || device.id,
      rule.severity || 'WARNING',
      title,
      summary,
      payloadJson,
      now,
      now
    );

    // Insert initial event in timeline
    this.db.prepare(`
      INSERT INTO incident_events (incident_id, event_id, timestamp, details)
      VALUES (?, ?, ?, ?)
    `).run(incidentId, event?.id || null, now, summary);

    const newIncident = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(incidentId);

    // Dispatch external notification via circuit breaker
    notificationService.sendIncidentNotification(newIncident).catch(err => {
      console.error('[RuleEngine] Notification dispatch error:', err);
    });

    if (this.wsBroadcaster) {
      this.wsBroadcaster('incident:created', newIncident);
    }

    return { action: 'CREATED', incident: newIncident };
  }

  logTrace(eventId, deviceId, ruleId, ruleName, matched, reason) {
    try {
      this.db.prepare(`
        INSERT INTO evaluation_traces (event_id, device_id, rule_id, rule_name, matched, reason)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(eventId || null, deviceId, ruleId, ruleName, matched, reason);
    } catch (e) {
      // Non-blocking trace error
      console.error('[RuleEngine] Trace log error:', e);
    }
  }
}

module.exports = RuleEngine;
