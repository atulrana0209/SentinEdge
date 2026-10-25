/**
 * Notification service with Circuit Breaker pattern.
 * Safely notifies external operator channels (webhooks, email, SMS, Slack).
 * If external endpoint fails repeatedly, circuit opens to prevent cascade failures
 * and buffers notifications for retry.
 */
class NotificationService {
  constructor() {
    this.state = 'CLOSED'; // 'CLOSED' | 'OPEN' | 'HALF_OPEN'
    this.failureCount = 0;
    this.failureThreshold = 3;
    this.cooldownPeriodMs = 15000; // 15s circuit reset attempt
    this.lastFailureTime = 0;
    this.successCount = 0;
    this.halfOpenSuccessThreshold = 2;

    this.pendingQueue = [];
    this.notificationHistory = [];
    this.simulatedFailureMode = false; // Flag to simulate external webhook outage for evaluation tests
  }

  setSimulatedFailure(enabled) {
    this.simulatedFailureMode = enabled;
  }

  async sendIncidentNotification(incident) {
    const notification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      incidentId: incident.id,
      severity: incident.severity,
      title: incident.title,
      summary: incident.summary,
      status: 'PENDING'
    };

    // Check circuit breaker state
    const now = Date.now();
    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime > this.cooldownPeriodMs) {
        console.log('[NotificationService] Cooldown elapsed. Circuit transitioning from OPEN -> HALF_OPEN');
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        // Circuit still OPEN, buffer notification
        console.warn(`[NotificationService] Circuit is OPEN! Buffering notification ${notification.id}`);
        notification.status = 'BUFFERED';
        notification.failureReason = 'Circuit breaker is OPEN. External service unavailable.';
        this.pendingQueue.push(notification);
        this.recordHistory(notification);
        return { success: false, buffered: true, state: this.state };
      }
    }

    // Attempt delivery
    try {
      await this.dispatchToExternalChannel(notification);
      this.onSuccess(notification);
      return { success: true, buffered: false, state: this.state };
    } catch (err) {
      this.onFailure(notification, err);
      return { success: false, buffered: true, error: err.message, state: this.state };
    }
  }

  async dispatchToExternalChannel(notification) {
    // Simulated external HTTP dispatch or real webhook
    if (this.simulatedFailureMode) {
      throw new Error('External Notification Service unavailable (Simulated 503 HTTP Outage)');
    }

    // In a real integration, this sends an HTTP POST request to client webhook / PagerDuty / Slack.
    // For local evaluation, we simulate network latency and high reliability:
    await new Promise(resolve => setTimeout(resolve, 50));
    return true;
  }

  onSuccess(notification) {
    notification.status = 'DELIVERED';
    notification.deliveredAt = new Date().toISOString();
    this.recordHistory(notification);

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        console.log('[NotificationService] Circuit recovered! Transitioning HALF_OPEN -> CLOSED');
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.flushPendingQueue();
      }
    } else {
      this.failureCount = 0;
    }
  }

  onFailure(notification, error) {
    this.lastFailureTime = Date.now();
    this.failureCount++;
    notification.status = 'FAILED_BUFFERED';
    notification.error = error.message;
    this.pendingQueue.push(notification);
    this.recordHistory(notification);

    console.error(`[NotificationService] Delivery failed (${this.failureCount}/${this.failureThreshold}): ${error.message}`);

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.warn(`[NotificationService] Circuit Breaker tripped to OPEN! Threshold reached.`);
    }
  }

  async flushPendingQueue() {
    if (this.pendingQueue.length === 0 || this.state !== 'CLOSED') return;
    console.log(`[NotificationService] Flushing ${this.pendingQueue.length} buffered notifications...`);
    const queue = [...this.pendingQueue];
    this.pendingQueue = [];

    for (const notif of queue) {
      try {
        await this.dispatchToExternalChannel(notif);
        notif.status = 'DELIVERED_REPLAY';
        notif.deliveredAt = new Date().toISOString();
      } catch (err) {
        this.pendingQueue.push(notif);
        break;
      }
    }
  }

  recordHistory(notif) {
    this.notificationHistory.unshift(notif);
    if (this.notificationHistory.length > 100) {
      this.notificationHistory.pop();
    }
  }

  getMetrics() {
    return {
      circuitState: this.state,
      failureCount: this.failureCount,
      failureThreshold: this.failureThreshold,
      pendingBufferedCount: this.pendingQueue.length,
      simulatedFailureMode: this.simulatedFailureMode,
      recentHistory: this.notificationHistory.slice(0, 10)
    };
  }
}

module.exports = new NotificationService();
