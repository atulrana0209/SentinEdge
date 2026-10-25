const express = require('express');

module.exports = function createRulesRouter(ruleService) {
  const router = express.Router();

  // List all rules
  router.get('/', (req, res) => {
    try {
      const rules = ruleService.getAllRules();
      return res.json({ success: true, count: rules.length, rules });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Create rule
  router.post('/', (req, res) => {
    try {
      const { name, rule_type } = req.body;
      if (!name || !rule_type) {
        return res.status(400).json({
          success: false,
          error: "Fields 'name' and 'rule_type' (THRESHOLD, HEARTBEAT_TIMEOUT, EVENT_TYPE) are required"
        });
      }

      const created = ruleService.createRule(req.body);
      return res.status(201).json({ success: true, rule: created });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Toggle rule enabled
  router.patch('/:id/toggle', (req, res) => {
    try {
      const { is_enabled } = req.body;
      const updated = ruleService.toggleRule(req.params.id, is_enabled);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }
      return res.json({ success: true, rule: updated });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Delete rule
  router.delete('/:id', (req, res) => {
    try {
      const deleted = ruleService.deleteRule(req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }
      return res.json({ success: true, message: 'Rule deleted successfully' });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Rule evaluation audit traces ("Why an incident was or was not created")
  router.get('/traces', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 100;
      const filters = {
        deviceId: req.query.deviceId,
        eventId: req.query.eventId,
        ruleId: req.query.ruleId
      };
      const traces = ruleService.getEvaluationTraces(limit, filters);
      return res.json({ success: true, count: traces.length, traces });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
