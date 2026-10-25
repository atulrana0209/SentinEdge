/**
 * Incident management lifecycle service.
 * Handles incident querying, acknowledgement, resolution, and event timeline inspection.
 */
class IncidentService {
  constructor(db, wsBroadcaster) {
    this.db = db;
    this.wsBroadcaster = wsBroadcaster;
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  getAllIncidents(filters = {}) {
    let query = 'SELECT * FROM incidents';
    const params = [];
    const conditions = [];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.severity) {
      conditions.push('severity = ?');
      params.push(filters.severity);
    }
    if (filters.deviceId) {
      conditions.push('device_id = ?');
      params.push(filters.deviceId);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += " ORDER BY CASE status WHEN 'OPEN' THEN 1 WHEN 'ACKNOWLEDGED' THEN 2 ELSE 3 END, last_seen_at DESC";

    const incidents = this.db.prepare(query).all(...params);
    return incidents.map(inc => ({
      ...inc,
      trigger_payload: inc.trigger_payload ? JSON.parse(inc.trigger_payload) : {}
    }));
  }

  getIncidentById(id) {
    const inc = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
    if (!inc) return null;

    // Fetch timeline events
    const timeline = this.db.prepare(`
      SELECT * FROM incident_events WHERE incident_id = ? ORDER BY timestamp DESC
    `).all(id);

    return {
      ...inc,
      trigger_payload: inc.trigger_payload ? JSON.parse(inc.trigger_payload) : {},
      timeline
    };
  }

  acknowledgeIncident(id, operatorName = 'Operator') {
    const inc = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
    if (!inc) return null;

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE incidents
      SET status = 'ACKNOWLEDGED',
          acknowledged_at = ?,
          acknowledged_by = ?
      WHERE id = ?
    `).run(now, operatorName, id);

    this.db.prepare(`
      INSERT INTO incident_events (incident_id, timestamp, details)
      VALUES (?, ?, ?)
    `).run(id, now, `Incident acknowledged by ${operatorName}`);

    const updated = this.getIncidentById(id);
    if (this.wsBroadcaster) {
      this.wsBroadcaster('incident:acknowledged', updated);
    }
    return updated;
  }

  resolveIncident(id, resolutionNotes = 'Resolved by operator') {
    const inc = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(id);
    if (!inc) return null;

    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE incidents
      SET status = 'RESOLVED',
          resolved_at = ?,
          resolution_notes = ?
      WHERE id = ?
    `).run(now, resolutionNotes, id);

    this.db.prepare(`
      INSERT INTO incident_events (incident_id, timestamp, details)
      VALUES (?, ?, ?)
    `).run(id, now, `Incident resolved. Notes: ${resolutionNotes}`);

    const updated = this.getIncidentById(id);
    if (this.wsBroadcaster) {
      this.wsBroadcaster('incident:resolved', updated);
    }
    return updated;
  }
}

module.exports = IncidentService;
