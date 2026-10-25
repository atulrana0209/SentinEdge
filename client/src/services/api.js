/**
 * SentinEdge API and Resilient WebSocket Client Service
 */

const BASE_URL = '';

export async function fetchJson(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data?.error || data?.message || `HTTP error ${response.status}`;
    const err = new Error(errorMsg);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

// REST API Methods
export const api = {
  // Metrics & Health
  getHealth: () => fetchJson('/api/health'),
  getMetrics: () => fetchJson('/api/metrics'),
  toggleCircuitBreaker: (enableFailure) =>
    fetchJson('/api/circuit-breaker/toggle', {
      method: 'POST',
      body: JSON.stringify({ enableFailure })
    }),

  // Devices
  getDevices: (status) => fetchJson(`/api/devices${status ? `?status=${status}` : ''}`),
  getDeviceById: (id) => fetchJson(`/api/devices/${id}`),

  // Events
  getEvents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetchJson(`/api/events${qs ? `?${qs}` : ''}`);
  },

  // Incidents
  getIncidents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetchJson(`/api/incidents${qs ? `?${qs}` : ''}`);
  },
  getIncidentById: (id) => fetchJson(`/api/incidents/${id}`),
  acknowledgeIncident: (id, operatorName) =>
    fetchJson(`/api/incidents/${id}/acknowledge`, {
      method: 'POST',
      body: JSON.stringify({ operatorName })
    }),
  resolveIncident: (id, notes) =>
    fetchJson(`/api/incidents/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ notes })
    }),

  // Rules
  getRules: () => fetchJson('/api/rules'),
  createRule: (ruleData) =>
    fetchJson('/api/rules', {
      method: 'POST',
      body: JSON.stringify(ruleData)
    }),
  toggleRule: (id, isEnabled) =>
    fetchJson(`/api/rules/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ is_enabled: isEnabled })
    }),
  deleteRule: (id) => fetchJson(`/api/rules/${id}`, { method: 'DELETE' }),
  getEvaluationTraces: (limit = 50) => fetchJson(`/api/rules/traces?limit=${limit}`),

  // DLQ
  getDlq: (status) => fetchJson(`/api/dlq${status ? `?status=${status}` : ''}`),
  retryDlq: (id) => fetchJson(`/api/dlq/${id}/retry`, { method: 'POST' }),
  discardDlq: (id) => fetchJson(`/api/dlq/${id}/discard`, { method: 'POST' }),

  // Simulator Triggers
  simulator: {
    sendNormal: (data) => fetchJson('/api/simulator/send-normal', { method: 'POST', body: JSON.stringify(data || {}) }),
    sendDuplicate: (deviceId) => fetchJson('/api/simulator/send-duplicate', { method: 'POST', body: JSON.stringify({ deviceId }) }),
    sendOutOfOrder: (deviceId) => fetchJson('/api/simulator/send-out-of-order', { method: 'POST', body: JSON.stringify({ deviceId }) }),
    sendMalformed: () => fetchJson('/api/simulator/send-malformed', { method: 'POST' }),
    sendBurst: (count = 15, deviceId) => fetchJson('/api/simulator/send-burst', { method: 'POST', body: JSON.stringify({ count, deviceId }) }),
    sendOverheat: (temperature = 91.5, deviceId) => fetchJson('/api/simulator/send-overheat', { method: 'POST', body: JSON.stringify({ temperature, deviceId }) }),
    sendLowBattery: (battery = 8.5, deviceId) => fetchJson('/api/simulator/send-low-battery', { method: 'POST', body: JSON.stringify({ battery, deviceId }) }),
    sendFault: (deviceId) => fetchJson('/api/simulator/send-fault', { method: 'POST', body: JSON.stringify({ deviceId }) }),
    disconnectDevice: (deviceId) => fetchJson('/api/simulator/disconnect-device', { method: 'POST', body: JSON.stringify({ deviceId }) })
  }
};

/**
 * Resilient WebSocket Connection Manager with auto-reconnect backoff
 */
export class LiveSocket {
  constructor(onStatusChange, onMessage) {
    this.onStatusChange = onStatusChange;
    this.onMessage = onMessage;
    this.socket = null;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 15000;
    this.isManualClosed = false;
  }

  connect() {
    this.isManualClosed = false;
    this.onStatusChange('CONNECTING');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    try {
      this.socket = new WebSocket(wsUrl);

      this.socket.onopen = () => {
        this.reconnectDelay = 1000;
        this.onStatusChange('CONNECTED');
      };

      this.socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          this.onMessage(payload);
        } catch {
          // ignore non-json
        }
      };

      this.socket.onclose = () => {
        if (!this.isManualClosed) {
          this.onStatusChange('DISCONNECTED');
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = () => {
        this.socket.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.onStatusChange('RECONNECTING');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  disconnect() {
    this.isManualClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) this.socket.close();
  }
}
