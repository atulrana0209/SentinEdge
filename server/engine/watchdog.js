/**
 * Watchdog background worker that monitors device heartbeats and silence durations.
 * Triggers incidents when devices fail to report within configurable thresholds.
 */
class DeviceWatchdog {
  constructor(db, ruleEngine, checkIntervalMs = 5000) {
    this.db = db;
    this.ruleEngine = ruleEngine;
    this.checkIntervalMs = checkIntervalMs;
    this.timer = null;
    this.isRunning = false;
    this.wsBroadcaster = null;
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
      const now = new Date();
      const heartbeatRules = this.db.prepare(`
        SELECT * FROM rules WHERE rule_type = 'HEARTBEAT_TIMEOUT' AND is_enabled = 1
      `).all();

      if (heartbeatRules.length === 0) return;

      const devices = this.db.prepare('SELECT * FROM devices').all();

      for (const device of devices) {
        if (!device.last_seen_at) continue;

        const lastSeen = new Date(device.last_seen_at);
        const silenceSeconds = Math.floor((now.getTime() - lastSeen.getTime()) / 1000);

        for (const rule of heartbeatRules) {
          // Check device filter if applicable
          if (rule.device_filter && rule.device_filter !== device.id) continue;

          const timeoutSec = rule.timeout_seconds || 30;

          if (silenceSeconds > timeoutSec) {
            // Check if device status needs updating
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

            const reason = `Device silence detected: no heartbeat received for ${silenceSeconds}s (threshold: ${timeoutSec}s)`;
            this.ruleEngine.handleIncidentTrigger(rule, device, null, reason);
            this.ruleEngine.logTrace(null, device.id, rule.id, rule.name, 1, reason);
          }
        }
      }
    } catch (err) {
      console.error('[Watchdog] Check iteration error:', err);
    }
  }
}

module.exports = DeviceWatchdog;
