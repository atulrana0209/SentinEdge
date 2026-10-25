const express = require('express');

module.exports = function createDevicesRouter(deviceService) {
  const router = express.Router();

  // List all devices
  router.get('/', (req, res) => {
    try {
      const filters = {
        status: req.query.status
      };
      const devices = deviceService.getAllDevices(filters);
      return res.json({ success: true, count: devices.length, devices });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Get device details
  router.get('/:id', (req, res) => {
    try {
      const device = deviceService.getDeviceById(req.params.id);
      if (!device) {
        return res.status(404).json({ success: false, error: 'Device not found' });
      }
      return res.json({ success: true, device });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Update metadata
  router.patch('/:id', (req, res) => {
    try {
      const updated = deviceService.updateDeviceMetadata(req.params.id, req.body);
      if (!updated) {
        return res.status(404).json({ success: false, error: 'Device not found' });
      }
      return res.json({ success: true, device: updated });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
