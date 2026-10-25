const { v4: uuidv4 } = require('uuid');

/**
 * Rule management service for creating, updating, and auditing dynamic alert rules.
 */
class RuleService {
  constructor(db, wsBroadcaster) {
    this.db = db;
    this.wsBroadcaster = wsBroadcaster;
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  getAllRules() {
    return this.db.prepare('SELECT * FROM rules ORDER BY created_at DESC').all();
  }

  getRuleById(id) {
    return this.db.prepare('SELECT * FROM rules WHERE id = ?').get(id);
  }

  createRule(data) {
    const id = data.id || `rule-${uuidv4().substring(0, 8)}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO rules (
        id, name, description, rule_type, device_filter, metric_key,
        operator, threshold_value, event_type_filter, timeout_seconds,
        severity, cooldown_seconds, is_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.name,
      data.description || '',
      data.rule_type,
      data.device_filter || null,
      data.metric_key || null,
      data.operator || null,
      data.threshold_value !== undefined ? Number(data.threshold_value) : null,
      data.event_type_filter || null,
      data.timeout_seconds !== undefined ? Number(data.timeout_seconds) : null,
      data.severity || 'WARNING',
      data.cooldown_seconds !== undefined ? Number(data.cooldown_seconds) : 60,
      data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : 1,
      now,
      now
    );

    const created = this.getRuleById(id);
    if (this.wsBroadcaster) {
      this.wsBroadcaster('rule:created', created);
    }
    return created;
  }

  toggleRule(id, isEnabled) {
    this.db.prepare(`
      UPDATE rules
      SET is_enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(isEnabled ? 1 : 0, id);

    const updated = this.getRuleById(id);
    if (this.wsBroadcaster) {
      this.wsBroadcaster('rule:updated', updated);
    }
    return updated;
  }

  deleteRule(id) {
    const existing = this.getRuleById(id);
    if (!existing) return false;

    this.db.prepare('DELETE FROM rules WHERE id = ?').run(id);
    if (this.wsBroadcaster) {
      this.wsBroadcaster('rule:deleted', { id });
    }
    return true;
  }

  getEvaluationTraces(limit = 100, filters = {}) {
    let query = 'SELECT * FROM evaluation_traces';
    const params = [];
    const conditions = [];

    if (filters.deviceId) {
      conditions.push('device_id = ?');
      params.push(filters.deviceId);
    }
    if (filters.eventId) {
      conditions.push('event_id = ?');
      params.push(filters.eventId);
    }
    if (filters.ruleId) {
      conditions.push('rule_id = ?');
      params.push(filters.ruleId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY evaluated_at DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(query).all(...params);
  }
}

module.exports = RuleService;
