const createApp = require('./app');

const PORT = process.env.PORT || 4000;
const { server, db, watchdog, wsManager } = createApp();

server.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`  OPERATIONS PLATFORM BACKEND RUNNING ON PORT ${PORT}`);
  console.log(`  - REST API:   http://localhost:${PORT}/api/health`);
  console.log(`  - WebSocket:  ws://localhost:${PORT}/ws`);
  console.log(`  - SQLite WAL: Persistent ACID Database active`);
  console.log(`====================================================`);
});

// Graceful shutdown handling
const shutdown = () => {
  console.log('\n[Server] Shutting down gracefully...');
  watchdog.stop();
  wsManager.close();
  server.close(() => {
    try {
      db.close();
      console.log('[Server] Database closed. Shutdown complete.');
    } catch (e) {
      console.error('[Server] Error closing database:', e);
    }
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
