/**
 * Lightweight Device Simulator
 * Demonstrates:
 * 1. Continuous fleet event generation
 * 2. Temporary disconnection and offline buffering
 * 3. Reconnection and replay of buffered events
 * 4. Duplicate event delivery
 * 5. Out-of-order event delivery
 * 6. Malformed / invalid payload delivery
 */

const http = require('http');
const { v4: uuidv4 } = require('uuid');

const API_HOST = process.env.API_HOST || 'localhost';
const API_PORT = process.env.API_PORT || 4000;

// Device state representations
class SimulatedDevice {
  constructor(id, name, location) {
    this.id = id;
    this.name = name;
    this.location = location;
    this.sequenceNumber = 1;
    this.isOffline = false;
    this.offlineBuffer = [];
    this.baseTemp = 22.0 + Math.random() * 8;
  }

  generateTelemetry(custom = {}) {
    this.sequenceNumber++;
    // Subtle random walk for metrics
    this.baseTemp += (Math.random() - 0.48) * 0.8;
    this.baseTemp = Math.max(15, Math.min(65, this.baseTemp));

    return {
      eventId: `evt-${uuidv4().substring(0, 8)}`,
      deviceId: this.id,
      sequenceNumber: this.sequenceNumber,
      timestamp: new Date().toISOString(),
      type: 'telemetry',
      payload: {
        temperature: +this.baseTemp.toFixed(1),
        humidity: +(45 + Math.random() * 15).toFixed(1),
        battery: +(85 - (this.sequenceNumber * 0.05)).toFixed(1),
        vibration: +(0.1 + Math.random() * 0.4).toFixed(2),
        status: 'NORMAL',
        ...custom
      },
      metadata: {
        name: this.name,
        location: this.location,
        firmware: 'v2.4.1'
      }
    };
  }
}

// HTTP helper
function postJson(path, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const req = http.request({
      hostname: API_HOST,
      port: API_PORT,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ statusCode: res.statusCode, data: json });
        } catch {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

// Fleet definition
const fleet = [
  new SimulatedDevice('sensor-nyc-01', 'NYC Cold Storage', 'Warehouse NYC-North'),
  new SimulatedDevice('sensor-lon-02', 'London Data Center', 'Floor 3 Server Room'),
  new SimulatedDevice('sensor-tok-03', 'Tokyo Assembly Line', 'Robotics Bay 4'),
  new SimulatedDevice('sensor-ber-04', 'Berlin Battery Plant', 'Cell Testing Lab'),
  new SimulatedDevice('sensor-syd-05', 'Sydney Solar Array', 'Field Inverter 12')
];

async function runScenario(scenario) {
  console.log(`\n>>> Executing Scenario: ${scenario.toUpperCase()} <<<`);

  if (scenario === 'burst' || scenario === 'offline-buffer') {
    const dev = fleet[0];
    console.log(`[Simulator] Simulating device ${dev.id} going OFFLINE for 6 cycles...`);
    dev.isOffline = true;

    // Generate 6 buffered events while offline
    for (let i = 1; i <= 6; i++) {
      const evt = dev.generateTelemetry({ note: `Buffered event #${i} while disconnected` });
      dev.offlineBuffer.push(evt);
      console.log(`  [Offline Buffer] Queued event seq #${evt.sequenceNumber} into local flash memory.`);
      await new Promise(r => setTimeout(r, 400));
    }

    console.log(`[Simulator] Device ${dev.id} RECONNECTED! Replaying burst of ${dev.offlineBuffer.length} buffered events via batch ingestion...`);
    dev.isOffline = false;

    const burstEvents = [...dev.offlineBuffer];
    dev.offlineBuffer = [];

    const res = await postJson('/api/events/batch', { events: burstEvents });
    console.log(`[Simulator] Burst replay response (${res.statusCode}):`, res.data?.summary || res.data);
  }

  else if (scenario === 'duplicate') {
    const dev = fleet[1];
    const originalEvt = dev.generateTelemetry({ note: 'First delivery attempt' });
    console.log(`[Simulator] 1. Sending original event: ${originalEvt.eventId}`);
    const r1 = await postJson('/api/events', originalEvt);
    console.log(`  -> Status: ${r1.statusCode}, duplicate: ${r1.data?.isDuplicate}`);

    console.log(`[Simulator] 2. Resending EXACT duplicate event ${originalEvt.eventId} (simulating network retransmit)...`);
    const r2 = await postJson('/api/events', originalEvt);
    console.log(`  -> Status: ${r2.statusCode}, duplicate: ${r2.data?.isDuplicate}, message: "${r2.data?.message}"`);
  }

  else if (scenario === 'out-of-order') {
    const dev = fleet[2];
    console.log(`[Simulator] 1. Emitting future sequence #75 first...`);
    const futureEvt = {
      ...dev.generateTelemetry(),
      sequenceNumber: 75,
      timestamp: new Date().toISOString()
    };
    const r1 = await postJson('/api/events', futureEvt);
    console.log(`  -> Seq #75 ingested:`, r1.data?.status);

    console.log(`[Simulator] 2. Emitting delayed older sequence #60 arriving later...`);
    const delayedEvt = {
      ...dev.generateTelemetry(),
      sequenceNumber: 60,
      timestamp: new Date(Date.now() - 45000).toISOString()
    };
    const r2 = await postJson('/api/events', delayedEvt);
    console.log(`  -> Seq #60 ingested: isOutOfOrder = ${r2.data?.isOutOfOrder}`);
  }

  else if (scenario === 'malformed') {
    console.log(`[Simulator] Sending invalid malformed payload (missing eventId & type)...`);
    const malformed = {
      deviceId: 'broken-device-99',
      payload: 'invalid-string-not-json-object'
    };
    const r = await postJson('/api/events', malformed);
    console.log(`  -> Response ${r.statusCode}: Validation rejected! Quarantined to DLQ. Details:`, r.data?.validationErrors || r.data);
  }

  else if (scenario === 'overheat') {
    const dev = fleet[3];
    console.log(`[Simulator] Sending CRITICAL overheat reading (92.4°C) from ${dev.id}...`);
    const evt = dev.generateTelemetry({
      temperature: 92.4,
      status: 'CRITICAL_OVERHEAT'
    });
    const r = await postJson('/api/events', evt);
    console.log(`  -> Response:`, r.data?.matchedRules);
  }

  else if (scenario === 'fault') {
    const dev = fleet[4];
    console.log(`[Simulator] Sending hardware FAULT event from ${dev.id}...`);
    const evt = {
      eventId: `evt-fault-${uuidv4().substring(0, 8)}`,
      deviceId: dev.id,
      sequenceNumber: dev.sequenceNumber++,
      timestamp: new Date().toISOString(),
      type: 'FAULT',
      payload: {
        errorCode: 'MOTOR_OVERLOAD_E04',
        severity: 'CRITICAL',
        description: 'Drive motor drawing 300% rated current.',
        status: 'FAULT'
      }
    };
    const r = await postJson('/api/events', evt);
    console.log(`  -> Response:`, r.data?.matchedRules);
  }
}

// Continuous simulator runner
async function startContinuousFleet(intervalMs = 3000) {
  console.log(`========================================================`);
  console.log(`  REAL-TIME DEVICE SIMULATOR STARTED`);
  console.log(`  Target: http://${API_HOST}:${API_PORT}`);
  console.log(`  Fleet Size: ${fleet.length} devices`);
  console.log(`  Tick Interval: ${intervalMs}ms`);
  console.log(`========================================================`);

  let cycle = 0;
  setInterval(async () => {
    cycle++;
    // Pick an active device
    const dev = fleet[cycle % fleet.length];
    if (dev.isOffline) return;

    try {
      const evt = dev.generateTelemetry();
      const res = await postJson('/api/events', evt);
      if (res.statusCode === 200) {
        process.stdout.write(`[Tick #${cycle}] Ingested from ${dev.id} (temp: ${evt.payload.temperature}°C, seq: ${evt.sequenceNumber})\n`);
      } else {
        process.stdout.write(`[Tick #${cycle}] Delivery returned status ${res.statusCode}\n`);
      }
    } catch (err) {
      console.error(`[Simulator] Connection to platform failed (${err.message}). Is server running?`);
    }
  }, intervalMs);
}

// CLI argument handling
const args = process.argv.slice(2);
const scenarioArg = args.find(a => a.startsWith('--scenario='));

if (scenarioArg) {
  const scenarioName = scenarioArg.split('=')[1];
  runScenario(scenarioName).then(() => {
    console.log('[Simulator] Scenario complete.');
    process.exit(0);
  }).catch(err => {
    console.error('[Simulator] Scenario error:', err);
    process.exit(1);
  });
} else if (args.includes('--run-all-scenarios')) {
  (async () => {
    await runScenario('duplicate');
    await new Promise(r => setTimeout(r, 1000));
    await runScenario('out-of-order');
    await new Promise(r => setTimeout(r, 1000));
    await runScenario('burst');
    await new Promise(r => setTimeout(r, 1000));
    await runScenario('malformed');
    await new Promise(r => setTimeout(r, 1000));
    await runScenario('overheat');
    await new Promise(r => setTimeout(r, 1000));
    await runScenario('fault');
    console.log('\n[Simulator] All scenarios executed successfully.');
    process.exit(0);
  })();
} else {
  startContinuousFleet(3000);
}
