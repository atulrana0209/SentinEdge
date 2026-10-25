const express = require('express');

module.exports = function createIncidentsRouter(incidentService) {
  const router = express.Router();

  // List incidents
  router.get('/', (req, res) => {
    try {
      const filters = {
        status: req.query.status,
        severity: req.query.severity,
        deviceId: req.query.deviceId
      };
      const incidents = incidentService.getAllIncidents(filters);
      return res.json({ success: true, count: incidents.length, incidents });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get incident details with timeline
  router.get('/:id', (req, res) => {
    try {
      const incident = incidentService.getIncidentById(req.params.id);
      if (!incident) {
        return res.status(404).json({ success: false, error: 'Incident not found' });
      }
      return res.json({ success: true, incident });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Acknowledge incident
  router.post('/:id/acknowledge', (req, res) => {
    try {
      const operatorName = req.body.operatorName || 'Current Operator';
      const updated = incidentService.acknowledgeIncident(req.params.id, operatorName);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Incident not found' });
      }
      return res.json({ success: true, incident: updated });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Resolve incident
  router.post('/:id/resolve', (req, res) => {
    try {
      const notes = req.body.notes || 'Resolved via operations dashboard';
      const updated = incidentService.resolveIncident(req.params.id, notes);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Incident not found' });
      }
      return res.json({ success: true, incident: updated });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
