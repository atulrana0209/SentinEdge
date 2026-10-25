/**
 * SentinEdge Watchdog Background Worker
 * Monitors device heartbeats and silence durations.
 * 
 * Features:
 * 1. Anti-Fatigue Throttle: Prevents database bloat and WebSocket message storms
 *    when devices remain offline.
 * 2. Auto-Resolve Healing: Automatically detects when a previously offline device
 *    resumes heartbeats and resolves open silence incidents.
 */
class DeviceWatchdog {
  constructor(db, ruleEngine, checkIntervalMs = 5000) {
    this.db = db;
    this.ruleEngine = ruleEngine;
    this.checkIntervalMs = checkIntervalMs;
    this.timer = null;
    this.isRunning = false;
    this.wsBroadcaster = null;

    // Map of deviceId -> timestamp of last triggered silence alert for anti-fatigue throttling
    this.lastSilenceAlertTime = new Map();
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Watchdog] Started device heartbeat monitor (interval: ${this.checkIntervalMs}ms)`);
    this.timer = setInterval(() => this.checkDevices(), this.checkIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[Watchdog] Stopped device heartbeat monitor.');
  }

  checkDevices() {
    try {
      const now = Date.now();
      const heartbeatRules = this.db.prepare(`
        SELECT * FROM rules WHERE rule_type = 'HEARTBEAT_TIMEOUT' AND is_enabled = 1
      `).all();

      if (heartbeatRules.length === 0) return;

      const devices = this.db.prepare('SELECT * FROM devices').all();

      for (const device of devices) {
        if (!device.last_seen_at) continue;

        const lastSeenMs = new Date(device.last_seen_at).getTime();
        const silenceSeconds = Math.max(0, Math.floor((now - lastSeenMs) / 1000));

        for (const rule of heartbeatRules) {
          // Check device filter if rule specifies one
          if (rule.device_filter && rule.device_filter !== device.id) continue;

          const timeoutSec = rule.timeout_seconds || 30;
          const cooldownMs = (rule.cooldown_seconds || 60) * 1000;

          if (silenceSeconds > timeoutSec) {
            // 1. Device is SILENT: transition status to OFFLINE if needed
            if (device.status !== 'OFFLINE') {
              this.db.prepare(`
                UPDATE devices
                SET status = 'OFFLINE', updated_at = datetime('now')
                WHERE id = ?
              `).run(device.id);

              const updatedDevice = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(device.id);
              if (this.wsBroadcaster) {
                this.wsBroadcaster('device:status_change', {
                  deviceId: device.id,
                  previousStatus: device.status,
                  currentStatus: 'OFFLINE',
                  device: updatedDevice,
                  silenceSeconds
                });
              }
            }

            // 2. ANTI-FATIGUE THROTTLE:
            // Check if we already dispatched an alert for this device within the cooldown window
            const lastAlert = this.lastSilenceAlertTime.get(device.id) || 0;
            if (now - lastAlert < cooldownMs) {
              // Throttled: do not spam incident timeline or WebSocket clients
              continue;
            }

            this.lastSilenceAlertTime.set(device.id, now);
            const reason = `Device silence detected: no heartbeat received for ${silenceSeconds}s (threshold: ${timeoutSec}s)`;
            this.ruleEngine.handleIncidentTrigger(rule, device, null, reason);
            this.ruleEngine.logTrace(null, device.id, rule.id, rule.name, 1, reason);

          } else {
            // 3. AUTO-RESOLVE HEALING:
            // Device heartbeat is healthy. If there are any open silence incidents for this device,
            // automatically mark them RESOLVED.
            this.autoResolveSilenceIncidents(rule, device, silenceSeconds, timeoutSec);
            // Clear any active silence throttle tracker
            this.lastSilenceAlertTime.delete(device.id);
          }
        }
      }
    } catch (err) {
      console.error('[Watchdog] Check iteration error:', err);
    }
  }

  /**
   * Auto-resolves active silence incidents when telemetry resumes.
   */
  autoResolveSilenceIncidents(rule, device, silenceSeconds, timeoutSec) {
    try {
      const activeIncidents = this.db.prepare(`
        SELECT * FROM incidents
        WHERE rule_id = ? AND device_id = ? AND status IN ('OPEN', 'ACKNOWLEDGED')
      `).all(rule.id, device.id);

      if (activeIncidents.length === 0) return;

      const nowIso = new Date().toISOString();
      for (const incident of activeIncidents) {
        const resolutionNotes = `Auto-healed: Heartbeat signal restored. Device reported ${silenceSeconds}s ago (threshold: ${timeoutSec}s).`;

        this.db.prepare(`
          UPDATE incidents
          SET status = 'RESOLVED',
              resolved_at = ?,
              resolution_notes = ?
          WHERE id = ?
        `).run(nowIso, resolutionNotes, incident.id);

        // Append resolution event to timeline
        this.db.prepare(`
          INSERT INTO incident_events (incident_id, event_id, timestamp, details)
          VALUES (?, NULL, ?, ?)
        `).run(incident.id, nowIso, resolutionNotes);

        const resolvedIncident = this.db.prepare('SELECT * FROM incidents WHERE id = ?').get(incident.id);

        if (this.wsBroadcaster) {
          this.wsBroadcaster('incident:resolved', resolvedIncident);
        }

        console.log(`[Watchdog] Auto-resolved silence incident ${incident.id} for device ${device.id}.`);
      }
    } catch (err) {
      console.error('[Watchdog] Auto-resolve error:', err);
    }
  }
}

module.exports = DeviceWatchdog;
