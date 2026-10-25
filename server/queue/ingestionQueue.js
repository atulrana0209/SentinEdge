const { v4: uuidv4 } = require('uuid');

/**
 * Bounded Ingestion Queue with Backpressure handling and Dead Letter Queue (DLQ).
 * Handles sudden traffic spikes, isolates slow processing, and buffers incoming telemetry.
 */
class IngestionQueue {
  constructor(db, eventService, ruleEngine, maxCapacity = 5000) {
    this.db = db;
    this.eventService = eventService;
    this.ruleEngine = ruleEngine;
    this.maxCapacity = maxCapacity;

    this.queue = [];
    this.isProcessing = false;
    this.wsBroadcaster = null;

    // Metrics
    this.totalEnqueued = 0;
    this.totalProcessed = 0;
    this.totalRejected = 0;
    this.totalDlq = 0;
    this.recentProcessingTimesMs = [];
  }

  setBroadcaster(broadcaster) {
    this.wsBroadcaster = broadcaster;
  }

  /**
   * Enqueue a validated or raw event for processing.
   * If queue is full, throws error for HTTP 429 backpressure response.
   */
  enqueue(eventData) {
    if (this.queue.length >= this.maxCapacity) {
      this.totalRejected++;
      const err = new Error('Ingestion buffer capacity exceeded. System applying backpressure.');
      err.status = 429;
      err.retryAfter = 2; // seconds
      throw err;
    }

    this.queue.push({
      item: eventData,
      enqueuedAt: Date.now()
    });
    this.totalEnqueued++;

    // Trigger async queue drain
    this.processNextTick();

    return {
      queued: true,
      queueDepth: this.queue.length
    };
  }

  processNextTick() {
    if (this.isProcessing) return;
    setImmediate(() => this.drainQueue());
  }

  async drainQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.queue.length > 0) {
        // Process in micro-batches of up to 50 items for high throughput
        const batchSize = Math.min(this.queue.length, 50);
        const batch = this.queue.splice(0, batchSize);

        for (const entry of batch) {
          const startTime = Date.now();
          try {
            await this.processItem(entry.item);
            this.totalProcessed++;

            const duration = Date.now() - startTime;
            this.recentProcessingTimesMs.push(duration);
            if (this.recentProcessingTimesMs.length > 100) {
              this.recentProcessingTimesMs.shift();
            }
          } catch (itemErr) {
            console.error('[IngestionQueue] Processing error for item, moving to DLQ:', itemErr);
            this.sendToDlq(entry.item, 'PROCESSING_ERROR', itemErr.message);
          }
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        this.processNextTick();
      }
    }
  }

  async processItem(item) {
    return this.eventService.processIngestedEvent(item);
  }

  /**
   * Stores failed, invalid or malformed payloads in the Dead Letter Queue
   */
  sendToDlq(rawPayload, reason, errorDetails = '') {
    this.totalDlq++;
    const dlqId = `dlq-${uuidv4().substring(0, 8)}`;
    const payloadStr = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);

    try {
      this.db.prepare(`
        INSERT INTO dlq_events (id, raw_payload, reason, error_details, status)
        VALUES (?, ?, ?, ?, 'PENDING')
      `).run(dlqId, payloadStr, reason, errorDetails);

      if (this.wsBroadcaster) {
        this.wsBroadcaster('dlq:new', {
          id: dlqId,
          reason,
          errorDetails,
          receivedAt: new Date().toISOString()
        });
      }
    } catch (dbErr) {
      console.error('[IngestionQueue] Failed to record in DLQ:', dbErr);
    }

    return dlqId;
  }

  getMetrics() {
    const avgLatency = this.recentProcessingTimesMs.length > 0
      ? Math.round(this.recentProcessingTimesMs.reduce((a, b) => a + b, 0) / this.recentProcessingTimesMs.length)
      : 0;

    return {
      queueDepth: this.queue.length,
      maxCapacity: this.maxCapacity,
      utilizationPercent: Math.round((this.queue.length / this.maxCapacity) * 100),
      totalEnqueued: this.totalEnqueued,
      totalProcessed: this.totalProcessed,
      totalRejected: this.totalRejected,
      totalDlq: this.totalDlq,
      avgProcessingLatencyMs: avgLatency
    };
  }
}

module.exports = IngestionQueue;
