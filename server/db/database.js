const path = require('path');
const fs = require('fs');

let DatabaseConstructor;

try {
  const { DatabaseSync } = require('node:sqlite');
  DatabaseConstructor = DatabaseSync;
} catch (e) {
  try {
    DatabaseConstructor = require('better-sqlite3');
  } catch (err2) {
    throw new Error('Neither node:sqlite (Node 22+ with --experimental-sqlite) nor better-sqlite3 is available.');
  }
}

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'platform.db');

const db = new DatabaseConstructor(DB_PATH);

// Enable Write-Ahead Logging (WAL) and foreign keys for durability and concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  const schema = `
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'sensor',
      location TEXT NOT NULL DEFAULT 'Unknown',
      status TEXT NOT NULL DEFAULT 'OFFLINE',
      last_seen_at TEXT,
      last_sequence_number INTEGER DEFAULT 0,
      total_events INTEGER DEFAULT 0,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
    CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at);

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      sequence_number INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      is_duplicate INTEGER DEFAULT 0,
      is_out_of_order INTEGER DEFAULT 0,
      processed INTEGER DEFAULT 1,
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_device_id ON events(device_id);
    CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);

    CREATE TABLE IF NOT EXISTS rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      rule_type TEXT NOT NULL,
      device_filter TEXT,
      metric_key TEXT,
      operator TEXT,
      threshold_value REAL,
      event_type_filter TEXT,
      timeout_seconds INTEGER,
      severity TEXT NOT NULL DEFAULT 'WARNING',
      cooldown_seconds INTEGER DEFAULT 60,
      is_enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      rule_id TEXT,
      rule_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_name TEXT,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      trigger_payload TEXT,
      occurrence_count INTEGER DEFAULT 1,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      acknowledged_at TEXT,
      acknowledged_by TEXT,
      resolved_at TEXT,
      resolution_notes TEXT,
      FOREIGN KEY(rule_id) REFERENCES rules(id) ON DELETE SET NULL,
      FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
    CREATE INDEX IF NOT EXISTS idx_incidents_device ON incidents(device_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_rule ON incidents(rule_id);
    CREATE INDEX IF NOT EXISTS idx_incidents_created ON incidents(first_seen_at);

    CREATE TABLE IF NOT EXISTS incident_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL,
      event_id TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      details TEXT,
      FOREIGN KEY(incident_id) REFERENCES incidents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dlq_events (
      id TEXT PRIMARY KEY,
      raw_payload TEXT NOT NULL,
      reason TEXT NOT NULL,
      error_details TEXT,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      retries INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING'
    );

    CREATE TABLE IF NOT EXISTS evaluation_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT,
      device_id TEXT,
      rule_id TEXT,
      rule_name TEXT,
      matched INTEGER NOT NULL,
      reason TEXT NOT NULL,
      evaluated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_eval_traces_device ON evaluation_traces(device_id);
    CREATE INDEX IF NOT EXISTS idx_eval_traces_event ON evaluation_traces(event_id);
  `;

  db.exec(schema);

  const countRow = db.prepare('SELECT COUNT(*) as count FROM rules').get();
  const count = countRow ? countRow.count : 0;
  if (count === 0) {
    seedDefaultRules();
  }
}

function seedDefaultRules() {
  const insertRule = db.prepare(`
    INSERT INTO rules (id, name, description, rule_type, metric_key, operator, threshold_value, severity, cooldown_seconds, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertHeartbeatRule = db.prepare(`
    INSERT INTO rules (id, name, description, rule_type, timeout_seconds, severity, cooldown_seconds, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEventTypeRule = db.prepare(`
    INSERT INTO rules (id, name, description, rule_type, event_type_filter, severity, cooldown_seconds, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertRule.run(
    'rule-temp-overheat',
    'High Temperature Alert',
    'Triggers when device temperature exceeds 80°C',
    'THRESHOLD',
    'temperature',
    '>',
    80.0,
    'CRITICAL',
    30,
    1
  );

  insertRule.run(
    'rule-battery-low',
    'Critical Battery Warning',
    'Triggers when device battery drops below 15%',
    'THRESHOLD',
    'battery',
    '<',
    15.0,
    'WARNING',
    60,
    1
  );

  insertHeartbeatRule.run(
    'rule-heartbeat-loss',
    'Device Silence / Offline Watchdog',
    'Triggers when a device fails to report within 30 seconds',
    'HEARTBEAT_TIMEOUT',
    30,
    'CRITICAL',
    60,
    1
  );

  insertEventTypeRule.run(
    'rule-hardware-fault',
    'Critical Hardware Fault Detection',
    'Triggers when device emits a FAULT or EMERGENCY event',
    'EVENT_TYPE',
    'FAULT',
    'CRITICAL',
    15,
    1
  );

  console.log('[DB] Seeded default monitoring rules.');
}

initSchema();

module.exports = db;
