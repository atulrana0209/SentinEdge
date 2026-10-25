/**
 * Device identity and state lifecycle service.
 * Handles auto-registration, state updates, monotonic sequence tracking,
 * and out-of-order detection.
 */
class DeviceService {
  constructor(db, wsBroadcaster) {
    this.db = db;
    this.wsBroadcaster = wsBroadcaster;
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  /**
   * Finds or automatically provisions a device upon receiving an event.
   * Compares sequence numbers and timestamps to detect out-of-order events.
   */
  upsertDeviceForEvent(deviceId, eventTimestamp, sequenceNumber, metadata = {}) {
    const existing = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    const now = new Date().toISOString();
    const eventTime = new Date(eventTimestamp);

    if (!existing) {
      // Auto-provision device
      const defaultName = metadata.name || `Device ${deviceId}`;
      const location = metadata.location || 'Site Alpha';
      const deviceType = metadata.deviceType || 'sensor';

      this.db.prepare(`
        INSERT INTO devices (
          id, name, type, location, status, last_seen_at, last_sequence_number, total_events, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'ONLINE', ?, ?, 1, ?, ?, ?)
      `).run(
        deviceId,
        defaultName,
        deviceType,
        location,
        now,
        sequenceNumber || 1,
        JSON.stringify(metadata),
        now,
        now
      );

      const newDevice = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
      if (this.wsBroadcaster) {
        this.wsBroadcaster('device:registered', newDevice);
      }

      return {
        device: newDevice,
        isOutOfOrder: false,
        wasOffline: false
      };
    }

    // Check for out-of-order sequencing vs device reboot/rollover
    let isOutOfOrder = false;
    const lastSeq = existing.last_sequence_number || 0;
    const lastSeenTime = existing.last_seen_at ? new Date(existing.last_seen_at).getTime() : 0;
    const eventTimeMs = eventTime.getTime();

    if (sequenceNumber !== undefined && sequenceNumber !== null) {
      if (sequenceNumber < lastSeq) {
        // If event timestamp is substantially newer than last_seen_at (>5s newer),
        // the device restarted its sequence counter after a reboot.
        if (eventTimeMs > lastSeenTime + 5000) {
          isOutOfOrder = false;
        } else {
          isOutOfOrder = true;
        }
      }
    } else if (existing.last_seen_at) {
      if (eventTimeMs < lastSeenTime - 2000) { // 2s skew tolerance
        isOutOfOrder = true;
      }
    }

    const wasOffline = existing.status === 'OFFLINE';
    // If device rebooted, adopt current sequence; else monotonic high-water mark
    const newSeq = isOutOfOrder ? lastSeq : (sequenceNumber !== undefined && sequenceNumber !== null ? Math.max(lastSeq, sequenceNumber) : lastSeq);
    const totalEvents = (existing.total_events || 0) + 1;

    // Advance last_seen_at if the event is live/recent, preventing false silence triggers
    const isEventRecent = eventTimeMs >= (lastSeenTime - 2000);
    const updatedLastSeen = (isEventRecent || !isOutOfOrder) ? now : existing.last_seen_at;

    this.db.prepare(`
      UPDATE devices
      SET status = 'ONLINE',
          last_seen_at = ?,
          last_sequence_number = ?,
          total_events = ?,
          updated_at = ?
      WHERE id = ?
    `).run(updatedLastSeen, newSeq, totalEvents, now, deviceId);

    const updatedDevice = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);

    if (wasOffline && this.wsBroadcaster) {
      this.wsBroadcaster('device:reconnected', {
        device: updatedDevice,
        reconnectedAt: now
      });
    }

    return {
      device: updatedDevice,
      isOutOfOrder,
      wasOffline
    };
  }

  getAllDevices(filters = {}) {
    let query = 'SELECT * FROM devices';
    const params = [];

    if (filters.status) {
      query += ' WHERE status = ?';
      params.push(filters.status);
    }

    query += ' ORDER BY last_seen_at DESC';
    return this.db.prepare(query).all(...params);
  }

  getDeviceById(id) {
    const device = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    if (!device) return null;

    // Attach recent events
    const recentEvents = this.db.prepare(`
      SELECT * FROM events WHERE device_id = ? ORDER BY received_at DESC LIMIT 25
    `).all(id);

    // Attach active incidents
    const activeIncidents = this.db.prepare(`
      SELECT * FROM incidents WHERE device_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED') ORDER BY first_seen_at DESC
    `).all(id);

    return {
      ...device,
      metadata: device.metadata ? JSON.parse(device.metadata) : {},
      recentEvents: recentEvents.map(e => ({ ...e, payload: JSON.parse(e.payload) })),
      activeIncidents
    };
  }

  updateDeviceMetadata(id, updates) {
    const device = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    if (!device) return null;

    const name = updates.name !== undefined ? updates.name : device.name;
    const location = updates.location !== undefined ? updates.location : device.location;
    const type = updates.type !== undefined ? updates.type : device.type;

    this.db.prepare(`
      UPDATE devices
      SET name = ?, location = ?, type = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, location, type, id);

    return this.getDeviceById(id);
  }
}

module.exports = DeviceService;
