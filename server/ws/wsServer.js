const WebSocket = require('ws');

/**
 * High-performance WebSocket manager for live operations dashboard streaming.
 * Implements ping-pong liveness detection and channel broadcasting.
 */
class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.heartbeatInterval = null;
  }

  attach(server) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      ws.isAlive = true;
      this.clients.add(ws);

      // Welcome handshake with system state
      ws.send(JSON.stringify({
        type: 'connection:established',
        timestamp: new Date().toISOString(),
        clientCount: this.clients.size,
        message: 'Connected to Real-Time Operations Platform WebSocket Stream'
      }));

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }
        } catch {
          // ignore client ping parsing issues
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[WebSocket] Client error:', err.message);
        this.clients.delete(ws);
      });
    });

    // Ping all clients every 15 seconds to detect stale/broken connections
    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.clients.delete(ws);
          return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, 15000);

    console.log('[WebSocket] Live event streaming attached on /ws');
  }

  broadcast(type, payload) {
    if (!this.wss || this.clients.size === 0) return;

    const message = JSON.stringify({
      type,
      data: payload,
      timestamp: new Date().toISOString()
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (err) {
          console.error('[WebSocket] Broadcast delivery error:', err.message);
        }
      }
    }
  }

  getClientCount() {
    return this.clients.size;
  }

  close() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.wss) this.wss.close();
  }
}

module.exports = new WebSocketManager();
