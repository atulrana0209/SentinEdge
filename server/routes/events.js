const express = require('express');

module.exports = function createEventsRouter(eventService, ingestionQueue) {
  const router = express.Router();

  // Ingest single event with backpressure capacity check and ACID pipeline
  router.post('/', async (req, res) => {
    try {
      // 1. Backpressure Guard: Check if bounded ingestion queue has capacity
      ingestionQueue.checkCapacity(1);

      // 2. Strict Schema Validation
      const validation = eventService.validatePayload(req.body);
      if (!validation.valid) {
        // Send malformed event directly to DLQ
        ingestionQueue.sendToDlq(req.body, 'MALFORMED_PAYLOAD', validation.errors.join('; '));
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          validationErrors: validation.errors
        });
      }

      // 3. Process event through atomic ACID transaction
      const result = await eventService.processIngestedEvent(req.body);
      return res.status(200).json({
        success: true,
        ...result
      });
    } catch (err) {
      if (err.status === 429) {
        const retryAfter = err.retryAfter || 2;
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          success: false,
          error: err.message || 'Ingestion buffer capacity exceeded. System applying backpressure.',
          retryAfter
        });
      }

      console.error('[EventsRouter] Ingestion error:', err);
      ingestionQueue.sendToDlq(req.body, 'INGESTION_ERROR', err.message);
      return res.status(err.status || 500).json({
        success: false,
        error: err.message
      });
    }
  });

  // Batch ingestion (for bursts and reconnected buffered data replay)
  router.post('/batch', async (req, res) => {
    try {
      const { events } = req.body;
      if (!Array.isArray(events)) {
        return res.status(400).json({
          success: false,
          error: "Payload must include an 'events' array"
        });
      }

      // Backpressure check for the entire incoming batch size
      ingestionQueue.checkCapacity(events.length);

      const results = [];
      let acceptedCount = 0;
      let duplicateCount = 0;
      let outOfOrderCount = 0;
      let rejectedCount = 0;

      for (const item of events) {
        try {
          const outcome = await eventService.processIngestedEvent(item);
          if (outcome.isDuplicate) duplicateCount++;
          else acceptedCount++;
          if (outcome.isOutOfOrder) outOfOrderCount++;
          results.push(outcome);
        } catch (itemErr) {
          rejectedCount++;
          ingestionQueue.sendToDlq(item, 'BATCH_INGESTION_ERROR', itemErr.message);
          results.push({
            id: item?.eventId || item?.id || 'unknown',
            status: 'REJECTED',
            error: itemErr.message
          });
        }
      }

      return res.status(200).json({
        success: true,
        summary: {
          total: events.length,
          acceptedCount,
          duplicateCount,
          outOfOrderCount,
          rejectedCount
        },
        results
      });
    } catch (err) {
      if (err.status === 429) {
        const retryAfter = err.retryAfter || 2;
        res.setHeader('Retry-After', retryAfter);
        return res.status(429).json({
          success: false,
          error: err.message || 'Ingestion buffer capacity exceeded. System applying backpressure.',
          retryAfter
        });
      }

      console.error('[EventsRouter] Batch ingestion error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // Query historical events
  router.get('/', (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 100;
      const filters = {
        deviceId: req.query.deviceId,
        eventType: req.query.eventType
      };
      const events = eventService.getRecentEvents(limit, filters);
      return res.json({ success: true, count: events.length, events });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
