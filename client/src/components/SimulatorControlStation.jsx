import React, { useState } from 'react';
import {
  Play,
  RotateCw,
  Flame,
  BatteryLow,
  AlertOctagon,
  WifiOff,
  Layers,
  Bug,
  Copy,
  Terminal,
  Activity
} from 'lucide-react';
import { api } from '../services/api';

export default function SimulatorControlStation({ devices, onTriggerSuccess }) {
  const [selectedDevice, setSelectedDevice] = useState('sensor-nyc-01');
  const [logMessages, setLogMessages] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoSimulating, setIsAutoSimulating] = useState(false);
  const [autoTimer, setAutoTimer] = useState(null);

  const addLog = (msg, type = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogMessages(prev => [{ time, msg, type }, ...prev.slice(0, 50)]);
  };

  const handleAction = async (actionFn, description) => {
    setIsSubmitting(true);
    addLog(`Initiating: ${description}...`, 'pending');
    try {
      const res = await actionFn();
      addLog(`✓ ${description} succeeded! Outcome: ${JSON.stringify(res.result || res.summary || res.message || 'OK')}`, 'success');
      if (onTriggerSuccess) onTriggerSuccess();
    } catch (err) {
      addLog(`✗ ${description} failed: ${err.message}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleAutoFleet = () => {
    if (isAutoSimulating) {
      clearInterval(autoTimer);
      setAutoTimer(null);
      setIsAutoSimulating(false);
      addLog('Continuous fleet simulation stopped.', 'info');
    } else {
      setIsAutoSimulating(true);
      addLog('Continuous fleet simulation started (1 tick every 2s)...', 'info');
      const timer = setInterval(async () => {
        try {
          const targetDev = devices.length > 0
            ? devices[Math.floor(Math.random() * devices.length)].id
            : 'sensor-nyc-01';
          await api.simulator.sendNormal({ deviceId: targetDev });
          if (onTriggerSuccess) onTriggerSuccess();
        } catch (e) {
          console.error(e);
        }
      }, 2000);
      setAutoTimer(timer);
    }
  };

  return (
    <div>
      <div className="glass-panel" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              Hardware Fleet Simulation Station
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Interactive test bench to validate out-of-order delivery, deduplication, offline buffering, and incident generation
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Target Device:</span>
            <input
              type="text"
              className="form-input"
              style={{ width: 170 }}
              value={selectedDevice}
              onChange={e => setSelectedDevice(e.target.value)}
              placeholder="e.g. sensor-nyc-01"
            />
            <button
              className={`btn btn-sm ${isAutoSimulating ? 'btn-danger' : 'btn-primary'}`}
              onClick={toggleAutoFleet}
            >
              <Activity size={14} />
              {isAutoSimulating ? 'Stop Auto Fleet' : 'Start Auto Fleet'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
        {/* Card 1: Normal Telemetry */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <Play size={16} color="var(--accent-emerald)" />
            1. Normal Telemetry Event
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Dispatches a valid JSON telemetry event with temperature, battery, and vibration. Auto-provisions device.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.sendNormal({ deviceId: selectedDevice }), 'Normal Event')}
          >
            Emit Telemetry
          </button>
        </div>

        {/* Card 2: Duplicate Event */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <Copy size={16} color="var(--accent-cyan)" />
            2. Duplicate Event Retransmit
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Sends an event and immediately re-sends the exact same eventId to demonstrate deduplication.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.sendDuplicate(selectedDevice), 'Duplicate Event Delivery')}
          >
            Inject Duplicate
          </button>
        </div>

        {/* Card 3: Out of Order */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <RotateCw size={16} color="var(--accent-amber)" />
            3. Out-of-Order Sequence
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Sends sequence #75 first, then emits delayed sequence #45 to test monotonic state protection.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.sendOutOfOrder(selectedDevice), 'Out-of-Order Sequence')}
          >
            Inject Out-of-Order
          </button>
        </div>

        {/* Card 4: Malformed Payload */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <Bug size={16} color="var(--accent-violet)" />
            4. Malformed Payload (DLQ)
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Sends invalid types & missing fields. Rejected with 400 and quarantined into the Dead Letter Queue.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.sendMalformed(), 'Malformed Payload Quarantine')}
          >
            Inject Malformed
          </button>
        </div>

        {/* Card 5: Burst / Reconnected Data Replay */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <Layers size={16} color="#38bdf8" />
            5. Reconnection Burst Replay
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Simulates a device reconnecting after being offline and replaying 15 buffered readings in batch.
          </p>
          <button
            className="btn btn-primary btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.sendBurst(15, selectedDevice), 'Burst Replay (15 Events)')}
          >
            Replay Burst (15 Events)
          </button>
        </div>

        {/* Card 6: Overheat Spike */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <Flame size={16} color="var(--accent-rose)" />
            6. Critical Overheat Spike (&gt;80°C)
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Emits 92.4°C temperature reading. Triggers High Temperature Alert incident & dedup grouping.
          </p>
          <button
            className="btn btn-danger btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.sendOverheat(92.4, selectedDevice), 'Critical Overheat Spike')}
          >
            Trigger Overheat (92.4°C)
          </button>
        </div>

        {/* Card 7: Critical Fault */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <AlertOctagon size={16} color="#fb7185" />
            7. Critical Hardware Fault
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Emits FAULT event (Motor Overload). Triggers Critical Hardware Fault detection policy.
          </p>
          <button
            className="btn btn-danger btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.sendFault(selectedDevice), 'Hardware Fault Event')}
          >
            Trigger FAULT Event
          </button>
        </div>

        {/* Card 8: Silence Watchdog Disconnect */}
        <div className="glass-panel" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: '#fff', fontWeight: 600 }}>
            <WifiOff size={16} color="var(--accent-amber)" />
            8. Simulate Device Silence
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.775rem', marginBottom: 14 }}>
            Rolls back last_seen_at by 45s. Background watchdog marks device OFFLINE and raises silence incident.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: '100%' }}
            disabled={isSubmitting}
            onClick={() => handleAction(() => api.simulator.disconnectDevice(selectedDevice), 'Simulate Silence Timeout')}
          >
            Simulate 45s Silence
          </button>
        </div>
      </div>

      {/* Simulator Execution Console Output */}
      <div className="glass-panel" style={{ padding: 20 }}>
        <h3 style={{ fontSize: '0.95rem', color: '#fff', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={16} color="var(--accent-cyan)" />
          Simulator Event Console
        </h3>
        <div style={{
          background: '#07090e',
          padding: 16,
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8rem',
          maxHeight: 220,
          overflowY: 'auto',
          border: '1px solid var(--border-subtle)'
        }}>
          {logMessages.length === 0 ? (
            <div style={{ color: 'var(--text-dim)' }}>
              Click any simulator action above to inspect execution results and protocol responses in real time.
            </div>
          ) : (
            logMessages.map((log, idx) => (
              <div key={idx} style={{
                marginBottom: 6,
                color: log.type === 'error' ? '#fda4af' : log.type === 'success' ? '#6ee7b7' : '#94a3b8'
              }}>
                <span style={{ color: 'var(--text-dim)', marginRight: 8 }}>[{log.time}]</span>
                {log.msg}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
