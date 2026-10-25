/**
 * Dead Letter Queue (DLQ) service for inspecting, retrying, or discarding malformed and failed events.
 */
class DlqService {
  constructor(db, eventService, wsBroadcaster) {
    this.db = db;
    this.eventService = eventService;
    this.wsBroadcaster = wsBroadcaster;
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  getAll(status = null, limit = 100) {
    let query = 'SELECT * FROM dlq_events';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY received_at DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params);
    return rows.map(r => ({
      ...r,
      raw_payload: this.safeParse(r.raw_payload)
    }));
  }

  getById(id) {
    const row = this.db.prepare('SELECT * FROM dlq_events WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      raw_payload: this.safeParse(row.raw_payload)
    };
  }

  async retryEvent(id) {
    const row = this.db.prepare('SELECT * FROM dlq_events WHERE id = ?').get(id);
    if (!row) return { success: false, error: 'DLQ item not found' };

    try {
      const payload = typeof row.raw_payload === 'string' ? JSON.parse(row.raw_payload) : row.raw_payload;
      const result = await this.eventService.processIngestedEvent(payload);

      this.db.prepare(`
        UPDATE dlq_events
        SET status = 'RETRIED', retries = retries + 1
        WHERE id = ?
      `).run(id);

      if (this.wsBroadcaster) {
        this.wsBroadcaster('dlq:retried', { id, result });
      }

      return { success: true, result };
    } catch (err) {
      this.db.prepare(`
        UPDATE dlq_events
        SET retries = retries + 1, error_details = ?
        WHERE id = ?
      `).run(err.message, id);

      return { success: false, error: err.message };
    }
  }

  discard(id) {
    this.db.prepare(`
      UPDATE dlq_events
      SET status = 'DISCARDED'
      WHERE id = ?
    `).run(id);

    if (this.wsBroadcaster) {
      this.wsBroadcaster('dlq:discarded', { id });
    }
    return true;
  }

  safeParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  }
}

module.exports = DlqService;
