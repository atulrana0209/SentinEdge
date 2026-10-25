const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');

// Database
const db = require('./db/database');

// Engine & Services
const wsManager = require('./ws/wsServer');
const RuleEngine = require('./engine/ruleEngine');
const DeviceWatchdog = require('./engine/watchdog');
const IngestionQueue = require('./queue/ingestionQueue');
const DeviceService = require('./services/deviceService');
const EventService = require('./services/eventService');
const IncidentService = require('./services/incidentService');
const RuleService = require('./services/ruleService');
const DlqService = require('./services/dlqService');

// Routers
const createEventsRouter = require('./routes/events');
const createDevicesRouter = require('./routes/devices');
const createIncidentsRouter = require('./routes/incidents');
const createRulesRouter = require('./routes/rules');
const createDlqRouter = require('./routes/dlq');
const createHealthRouter = require('./routes/health');
const createSimulatorRouter = require('./routes/simulator');

function createApp() {
  const app = express();
  const server = http.createServer(app);

  // Attach WebSockets to HTTP server
  wsManager.attach(server);
  const broadcaster = (type, data) => wsManager.broadcast(type, data);

  // Wire up services with broadcaster
  const ruleEngine = new RuleEngine(db, broadcaster);
  const deviceService = new DeviceService(db, broadcaster);
  const eventService = new EventService(db, deviceService, ruleEngine, broadcaster);
  const ingestionQueue = new IngestionQueue(db, eventService, ruleEngine);
  ingestionQueue.setBroadcaster(broadcaster);

  const incidentService = new IncidentService(db, broadcaster);
  const ruleService = new RuleService(db, broadcaster);
  const dlqService = new DlqService(db, eventService, broadcaster);

  // Initialize and start watchdog
  const watchdog = new DeviceWatchdog(db, ruleEngine, 5000);
  watchdog.setBroadcaster(broadcaster);
  watchdog.start();

  // Middleware
  app.use(cors());
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));

  // Request logger
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/health')) {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        if (res.statusCode >= 400 || req.method !== 'GET') {
          console.log(`[HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
        }
      });
    }
    next();
  });

  // Mount API Routers
  app.use('/api/events', createEventsRouter(eventService, ingestionQueue));
  app.use('/api/devices', createDevicesRouter(deviceService));
  app.use('/api/incidents', createIncidentsRouter(incidentService));
  app.use('/api/rules', createRulesRouter(ruleService));
  app.use('/api/dlq', createDlqRouter(dlqService));
  app.use('/api', createHealthRouter(db, ingestionQueue, wsManager));
  app.use('/api/simulator', createSimulatorRouter(eventService, ingestionQueue, db));

  // Serve static client build if it exists (for standalone production distribution)
  const clientDist = path.join(__dirname, '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      return next();
    }
    const indexPath = path.join(clientDist, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(200).send(`
          <!DOCTYPE html>
          <html>
            <head><title>Real-Time Operations Platform API</title></head>
            <body style="font-family: sans-serif; background: #0f172a; color: #f8fafc; padding: 40px;">
              <h2>🚀 Real-Time Operations Platform API Server is Running</h2>
              <p>API endpoints are active at <code>/api</code>. WebSockets are active at <code>/ws</code>.</p>
              <p>For the live frontend dashboard, run <code>npm run dev:client</code> or build the client with <code>npm run build:client</code>.</p>
            </body>
          </html>
        `);
      }
    });
  });

  return {
    app,
    server,
    db,
    wsManager,
    watchdog,
    deviceService,
    eventService,
    ruleEngine,
    incidentService,
    ruleService,
    dlqService,
    ingestionQueue
  };
}

module.exports = createApp;
