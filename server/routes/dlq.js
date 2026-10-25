const express = require('express');

module.exports = function createDlqRouter(dlqService) {
  const router = express.Router();

  // List DLQ events
  router.get('/', (req, res) => {
    try {
      const status = req.query.status || null;
      const limit = parseInt(req.query.limit, 10) || 50;
      const items = dlqService.getAll(status, limit);
      return res.json({ success: true, count: items.length, items });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Retry a failed/quarantined event
  router.post('/:id/retry', async (req, res) => {
    try {
      const result = await dlqService.retryEvent(req.params.id);
      if (!result.success) {
        return res.status(400).json(result);
      }
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Discard DLQ item
  router.post('/:id/discard', (req, res) => {
    try {
      const ok = dlqService.discard(req.params.id);
      return res.json({ success: ok });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
