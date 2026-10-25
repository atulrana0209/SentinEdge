const express = require('express');
const notificationService = require('../services/notificationService');
const dedupCache = require('../engine/dedupCache');

module.exports = function createHealthRouter(db, ingestionQueue, wsManager) {
  const router = express.Router();
  const startTime = Date.now();

  // Basic health check
  router.get('/health', (req, res) => {
    try {
      // Test DB connection
      const dbCheck = db.prepare('SELECT 1 as alive').get();

      return res.json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        database: dbCheck && dbCheck.alive === 1 ? 'HEALTHY' : 'UNHEALTHY',
        activeWebSockets: wsManager ? wsManager.getClientCount() : 0,
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
      });
    } catch (err) {
      return res.status(500).json({
        status: 'DOWN',
        error: err.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Comprehensive operational statistics and metrics
  router.get('/metrics', (req, res) => {
    try {
      const deviceStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'ONLINE' THEN 1 ELSE 0 END) as online,
          SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) as offline,
          SUM(CASE WHEN status = 'DEGRADED' THEN 1 ELSE 0 END) as degraded
        FROM devices
      `).get();

      const eventStats = db.prepare(`
        SELECT
          COUNT(*) as totalIngested,
          SUM(is_duplicate) as duplicatesInDb,
          SUM(is_out_of_order) as outOfOrderInDb
        FROM events
      `).get();

      const incidentStats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) as open,
          SUM(CASE WHEN status = 'ACKNOWLEDGED' THEN 1 ELSE 0 END) as acknowledged,
          SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved,
          SUM(CASE WHEN severity = 'CRITICAL' AND status != 'RESOLVED' THEN 1 ELSE 0 END) as criticalActive
        FROM incidents
      `).get();

      const dlqCount = db.prepare(`
        SELECT COUNT(*) as pending FROM dlq_events WHERE status = 'PENDING'
      `).get().pending;

      const queueMetrics = ingestionQueue.getMetrics();
      const dedupMetrics = dedupCache.getStats();
      const notificationMetrics = notificationService.getMetrics();

      return res.json({
        success: true,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        devices: {
          total: deviceStats.total || 0,
          online: deviceStats.online || 0,
          offline: deviceStats.offline || 0,
          degraded: deviceStats.degraded || 0
        },
        events: {
          totalIngested: eventStats.totalIngested || 0,
          duplicatesInDb: eventStats.duplicatesInDb || 0,
          outOfOrderInDb: eventStats.outOfOrderInDb || 0,
          cacheStats: dedupMetrics
        },
        incidents: {
          total: incidentStats.total || 0,
          open: incidentStats.open || 0,
          acknowledged: incidentStats.acknowledged || 0,
          resolved: incidentStats.resolved || 0,
          criticalActive: incidentStats.criticalActive || 0
        },
        dlq: {
          pendingCount: dlqCount
        },
        queue: queueMetrics,
        notificationCircuitBreaker: notificationMetrics,
        websockets: {
          activeConnections: wsManager ? wsManager.getClientCount() : 0
        }
      });
    } catch (err) {
      console.error('[HealthRouter] Metrics error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Toggle notification circuit breaker simulation
  router.post('/circuit-breaker/toggle', (req, res) => {
    try {
      const { enableFailure } = req.body;
      notificationService.setSimulatedFailure(Boolean(enableFailure));
      return res.json({
        success: true,
        simulatedFailureMode: notificationService.simulatedFailureMode,
        circuitState: notificationService.state
      });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
