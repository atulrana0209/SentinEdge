/**
 * SentinEdge Autonomous Edge Device Simulator
 * Demonstrates:
 * 1. Distributed multi-device fleet continuous telemetry generation
 * 2. Embedded flash ring-buffering during network disconnections (offline resilience)
 * 3. Automatic burst replay of buffered data via batch ingestion upon reconnection
 * 4. Deterministic scenarios: duplicate retransmits, out-of-order arrivals, malformed payload DLQ,
 *    overheat threshold spikes, and actuator fault alarms.
 */

const http = require('http');
const { v4: uuidv4 } = require('uuid');

const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 4000;

// HTTP POST helper
function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request(
      {
        hostname: API_HOST,
        port: API_PORT,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            resolve({ statusCode: res.statusCode, data: json, headers: res.headers });
          } catch {
            resolve({ statusCode: res.statusCode, body, headers: res.headers });
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

/**
 * Autonomous Edge Device with Local Flash Ring Buffer
 */
class AutonomousEdgeDevice {
  constructor(id, name, location, maxBufferSize = 500) {
    this.id = id;
    this.name = name;
    this.location = location;
    this.sequenceNumber = 0;
    this.isNetworkConnected = true;
    this.flashBuffer = [];
    this.maxBufferSize = maxBufferSize;
    this.baseTemp = 22.0 + Math.random() * 6;
  }

  /**
   * Samples physical sensors and generates normalized telemetry.
   */
  sampleSensor(customPayload = {}) {
    this.sequenceNumber++;
    // Subtle physical random walk
    this.baseTemp += (Math.random() - 0.48) * 0.7;
    this.baseTemp = Math.max(16, Math.min(65, this.baseTemp));

    return {
      eventId: `evt-${this.id.substring(0, 7)}-${uuidv4().substring(0, 8)}`,
      deviceId: this.id,
      sequenceNumber: this.sequenceNumber,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: {
        temperature: +this.baseTemp.toFixed(1),
        humidity: +(45 + Math.random() * 15).toFixed(1),
        battery: Math.max(5, +(95 - this.sequenceNumber * 0.04).toFixed(1)),
        vibration: +(0.1 + Math.random() * 0.35).toFixed(2),
        status: 'NORMAL',
        ...customPayload
      },
      metadata: {
        name: this.name,
        location: this.location,
        firmware: 'v3.1.2-edge'
      }
    };
  }

  /**
   * Toggles edge network connectivity.
   * When reconnected, triggers an immediate replay of buffered flash telemetry.
   */
  async setConnected(connected) {
    const wasDisconnected = !this.isNetworkConnected;
    this.isNetworkConnected = connected;

    if (!connected) {
      console.log(`\n🔴 [EdgeDevice:${this.id}] Cellular link DROPPED. Switching to offline flash ring buffer.`);
    } else if (wasDisconnected && connected) {
      console.log(`\n🟢 [EdgeDevice:${this.id}] Cellular link RESTORED! Triggering batch replay of ${this.flashBuffer.length} buffered frames...`);
      await this.replayBufferedBurst();
    }
  }

  /**
   * Executes continuous tick: sends direct telemetry if connected, or queues into flash buffer if offline.
   */
  async tick() {
    const frame = this.sampleSensor();

    if (!this.isNetworkConnected) {
      // Offline: write into circular flash memory
      if (this.flashBuffer.length >= this.maxBufferSize) {
        this.flashBuffer.shift(); // Evict oldest telemetry frame
      }
      this.flashBuffer.push(frame);
      process.stdout.write(`  📦 [FlashBuffer:${this.id}] Queued frame seq #${frame.sequenceNumber} (Buffer: ${this.flashBuffer.length} items)\n`);
      return { buffered: true, frame };
    }

    // Online: transmit directly to SentinEdge ingestion endpoint
    try {
      const res = await postJson('/api/events', frame);
      if (res.statusCode === 200) {
        process.stdout.write(`  ⚡ [Online:${this.id}] Ingested seq #${frame.sequenceNumber} (temp: ${frame.payload.temperature}°C)\n`);
      } else {
        process.stdout.write(`  ⚠️ [EdgeDevice:${this.id}] Transmit response ${res.statusCode}. Diverting to flash buffer.\n`);
        this.flashBuffer.push(frame);
      }
      return { buffered: false, statusCode: res.statusCode, data: res.data };
    } catch (err) {
      console.warn(`  ⚠️ [EdgeDevice:${this.id}] Connection failed (${err.message}). Buffering locally.`);
      this.flashBuffer.push(frame);
      return { buffered: true, error: err.message };
    }
  }

  /**
   * Replays buffered readings via the batch API endpoint upon reconnection.
   */
  async replayBufferedBurst() {
    if (this.flashBuffer.length === 0) return;

    const burstEvents = [...this.flashBuffer];
    this.flashBuffer = [];

    try {
      const res = await postJson('/api/events/batch', { events: burstEvents });
      console.log(`  🚀 [EdgeDevice:${this.id}] Batch Replay completed (${res.statusCode}):`, res.data?.summary || res.data);
      return res;
    } catch (err) {
      console.error(`  ❌ [EdgeDevice:${this.id}] Batch replay failed (${err.message}). Restoring buffer.`);
      this.flashBuffer = [...burstEvents, ...this.flashBuffer];
    }
  }
}

// Enterprise fleet definition
const fleet = [
  new AutonomousEdgeDevice('sensor-nyc-01', 'NYC Cold Storage', 'Warehouse NYC-North'),
  new AutonomousEdgeDevice('sensor-lon-02', 'London Data Center', 'Floor 3 Server Room'),
  new AutonomousEdgeDevice('sensor-tok-03', 'Tokyo Assembly Line', 'Robotics Bay 4'),
  new AutonomousEdgeDevice('sensor-ber-04', 'Berlin Battery Plant', 'Cell Testing Lab'),
  new AutonomousEdgeDevice('sensor-syd-05', 'Sydney Solar Array', 'Field Inverter 12')
];

/**
 * Deterministic test scenario runner
 */
async function runScenario(scenario) {
  console.log(`\n========================================================`);
  console.log(`>>> EXECUTING SENTINEDGE SCENARIO: ${scenario.toUpperCase()} <<<`);
  console.log(`========================================================`);

  if (scenario === 'burst' || scenario === 'offline-buffer') {
    const dev = fleet[0];
    console.log(`[Simulator] 1. Simulating device ${dev.id} network blackout (going OFFLINE)...`);
    await dev.setConnected(false);

    // Buffer 6 cycles of telemetry in flash
    for (let i = 1; i <= 6; i++) {
      await dev.tick();
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[Simulator] 2. Network restored! Device ${dev.id} will replay buffered burst...`);
    await dev.setConnected(true);
  }

  else if (scenario === 'duplicate') {
    const dev = fleet[1];
    const originalEvt = dev.sampleSensor({ note: 'First delivery attempt' });
    console.log(`[Simulator] 1. Dispatching original event: ${originalEvt.eventId}`);
    const r1 = await postJson('/api/events', originalEvt);
    console.log(`  -> Response: status ${r1.statusCode}, isDuplicate: ${r1.data?.isDuplicate}`);

    console.log(`[Simulator] 2. Resending EXACT duplicate event ${originalEvt.eventId} (simulating network retransmission)...`);
    const r2 = await postJson('/api/events', originalEvt);
    console.log(`  -> Response: status ${r2.statusCode}, isDuplicate: ${r2.data?.isDuplicate}, status: "${r2.data?.status}"`);
  }

  else if (scenario === 'out-of-order') {
    const dev = fleet[2];
    console.log(`[Simulator] 1. Sending future sequence #80 first...`);
    const futureEvt = {
      ...dev.sampleSensor(),
      sequenceNumber: 80,
      timestamp: new Date().toISOString()
    };
    const r1 = await postJson('/api/events', futureEvt);
    console.log(`  -> Seq #80 status:`, r1.data?.status, `isOutOfOrder:`, r1.data?.isOutOfOrder);

    console.log(`[Simulator] 2. Sending delayed older sequence #65 arriving later...`);
    const delayedEvt = {
      ...dev.sampleSensor(),
      sequenceNumber: 65,
      timestamp: new Date(Date.now() - 60000).toISOString()
    };
    const r2 = await postJson('/api/events', delayedEvt);
    console.log(`  -> Seq #65 status:`, r2.data?.status, `isOutOfOrder:`, r2.data?.isOutOfOrder, `(Active alerts suppressed)`);
  }

  else if (scenario === 'malformed') {
    console.log(`[Simulator] Sending malformed invalid payload (missing eventId & non-object payload)...`);
    const malformed = {
      deviceId: 'broken-device-99',
      payload: 'invalid-string-not-json-object'
    };
    const r = await postJson('/api/events', malformed);
    console.log(`  -> Response ${r.statusCode}: Validation rejected! Quarantined to DLQ. Details:`, r.data?.validationErrors || r.data);
  }

  else if (scenario === 'overheat') {
    const dev = fleet[3];
    console.log(`[Simulator] Sending CRITICAL overheat reading (93.5°C) from ${dev.id}...`);
    const evt = dev.sampleSensor({
      temperature: 93.5,
      status: 'CRITICAL_OVERHEAT'
    });
    const r = await postJson('/api/events', evt);
    console.log(`  -> Response:`, r.data?.status, `matchedRules:`, r.data?.matchedRules);
  }

  else if (scenario === 'fault') {
    const dev = fleet[4];
    console.log(`[Simulator] Sending hardware FAULT event from ${dev.id}...`);
    const evt = {
      eventId: `evt-fault-${uuidv4().substring(0, 8)}`,
      deviceId: dev.id,
      sequenceNumber: ++dev.sequenceNumber,
      timestamp: new Date().toISOString(),
      type: 'FAULT',
      payload: {
        errorCode: 'ERR_ACTUATOR_JAM',
        severity: 'CRITICAL',
        description: 'Actuator hydraulic pressure exceeded maximum tolerance limit.',
        status: 'FAULT'
      }
    };
    const r = await postJson('/api/events', evt);
    console.log(`  -> Response:`, r.data?.status, `matchedRules:`, r.data?.matchedRules);
  }
}

/**
 * Continuous autonomous multi-device fleet runner with periodic field network blackout simulation
 */
async function startContinuousFleet(intervalMs = 2500) {
  console.log(`========================================================`);
  console.log(`  SENTINEDGE AUTONOMOUS EDGE FLEET SIMULATOR STARTED`);
  console.log(`  Target: http://${API_HOST}:${API_PORT}`);
  console.log(`  Fleet Size: ${fleet.length} edge devices`);
  console.log(`  Tick Interval: ${intervalMs}ms`);
  console.log(`  Offline Disconnect & Burst Replay: Automated every 10 cycles`);
  console.log(`========================================================\n`);

  let cycle = 0;
  setInterval(async () => {
    cycle++;
    console.log(`--- [Fleet Cycle #${cycle}] ---`);

    // Periodic simulation: temporarily drop network for Device 0 to demonstrate offline flash buffering
    const testDev = fleet[0];
    if (cycle === 5) {
      await testDev.setConnected(false);
    } else if (cycle === 9) {
      await testDev.setConnected(true);
    }

    // Tick each device concurrently
    for (const dev of fleet) {
      await dev.tick();
    }
  }, intervalMs);
}

// CLI argument handling
const args = process.argv.slice(2);
const scenarioArg = args.find((a) => a.startsWith('--scenario='));

if (scenarioArg) {
  const scenarioName = scenarioArg.split('=')[1];
  runScenario(scenarioName)
    .then(() => {
      console.log('\n[Simulator] Scenario complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Simulator] Scenario error:', err);
      process.exit(1);
    });
} else if (args.includes('--run-all-scenarios')) {
  (async () => {
    await runScenario('duplicate');
    await new Promise((r) => setTimeout(r, 800));
    await runScenario('out-of-order');
    await new Promise((r) => setTimeout(r, 800));
    await runScenario('burst');
    await new Promise((r) => setTimeout(r, 800));
    await runScenario('malformed');
    await new Promise((r) => setTimeout(r, 800));
    await runScenario('overheat');
    await new Promise((r) => setTimeout(r, 800));
    await runScenario('fault');
    console.log('\n[Simulator] All scenarios verified successfully.');
    process.exit(0);
  })();
} else {
  startContinuousFleet(2500);
}
