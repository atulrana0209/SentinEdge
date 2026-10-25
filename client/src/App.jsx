import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import StatsCards from './components/StatsCards';
import DeviceFleetView from './components/DeviceFleetView';
import LiveEventStreamView from './components/LiveEventStreamView';
import IncidentsView from './components/IncidentsView';
import RulesEngineView from './components/RulesEngineView';
import SystemHealthView from './components/SystemHealthView';
import SimulatorControlStation from './components/SimulatorControlStation';
import { api, LiveSocket } from './services/api';
import { WifiOff, RefreshCw } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [connectionState, setConnectionState] = useState('CONNECTING');

  // Operational State
  const [devices, setDevices] = useState([]);
  const [events, setEvents] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [rules, setRules] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [isStreamPaused, setIsStreamPaused] = useState(false);

  // References for live stream updates
  const isPausedRef = useRef(isStreamPaused);
  isPausedRef.current = isStreamPaused;

  const loadInitialData = async () => {
    try {
      const [devRes, incRes, ruleRes, metRes, evtRes] = await Promise.all([
        api.getDevices().catch(() => ({ devices: [] })),
        api.getIncidents().catch(() => ({ incidents: [] })),
        api.getRules().catch(() => ({ rules: [] })),
        api.getMetrics().catch(() => null),
        api.getEvents({ limit: 40 }).catch(() => ({ events: [] }))
      ]);

      setDevices(devRes.devices || []);
      setIncidents(incRes.incidents || []);
      setRules(ruleRes.rules || []);
      if (metRes) setMetrics(metRes);
      setEvents(evtRes.events || []);
    } catch (err) {
      console.error('[MissionOps] Initial fetch error:', err);
    }
  };

  useEffect(() => {
    loadInitialData();

    // Setup Resilient WebSocket Client
    const liveSocket = new LiveSocket(
      (status) => {
        setConnectionState(status);
        if (status === 'CONNECTED') {
          // Re-sync latest state upon reconnection
          loadInitialData();
        }
      },
      (msg) => {
        handleWebSocketMessage(msg);
      }
    );

    liveSocket.connect();

    // Background metrics polling (every 8s) for stats counters
    const pollInterval = setInterval(() => {
      api.getMetrics().then(res => {
        if (res) setMetrics(res);
      }).catch(() => {});
    }, 8000);

    return () => {
      liveSocket.disconnect();
      clearInterval(pollInterval);
    };
  }, []);

  const handleWebSocketMessage = (msg) => {
    const { type, data } = msg;

    if (type === 'event:new') {
      const { event, device } = data;
      // Prepend to live stream if not paused
      if (!isPausedRef.current) {
        setEvents(prev => [event, ...prev.slice(0, 99)]);
      }

      // Update device state in fleet roster
      setDevices(prev => {
        const idx = prev.findIndex(d => d.id === event.deviceId || d.id === event.device_id);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            status: 'ONLINE',
            last_seen_at: event.timestamp || new Date().toISOString(),
            last_sequence_number: Math.max(updated[idx].last_sequence_number || 0, event.sequenceNumber || 0),
            total_events: (updated[idx].total_events || 0) + 1
          };
          return updated;
        } else {
          return [{
            id: event.deviceId,
            name: device?.name || `Device ${event.deviceId}`,
            location: 'Site Alpha',
            status: 'ONLINE',
            last_seen_at: event.timestamp,
            last_sequence_number: event.sequenceNumber || 1,
            total_events: 1
          }, ...prev];
        }
      });
    }

    else if (type === 'incident:created') {
      setIncidents(prev => [data, ...prev]);
    }

    else if (type === 'incident:updated' || type === 'incident:acknowledged' || type === 'incident:resolved') {
      setIncidents(prev => prev.map(inc => inc.id === data.id ? { ...inc, ...data } : inc));
    }

    else if (type === 'device:status_change') {
      setDevices(prev => prev.map(d => d.id === data.deviceId ? { ...d, status: data.currentStatus } : d));
    }
  };

  const openIncidentsCount = incidents.filter(i => i.status === 'OPEN').length;

  return (
    <div>
      {/* Reconnection Alert Banner if connection lost */}
      {connectionState !== 'CONNECTED' && (
        <div className="reconnect-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <WifiOff size={18} />
            <span>
              Real-time stream connection interrupted.
              {connectionState === 'RECONNECTING'
                ? ' Attempting automatic reconnection...'
                : ' Operations interface remains active with cached state.'}
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={loadInitialData}
            style={{ padding: '3px 10px', fontSize: '0.75rem' }}
          >
            <RefreshCw size={12} /> Force Reconnect
          </button>
        </div>
      )}

      {/* Main Mission Control Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectionState={connectionState}
        openIncidentsCount={openIncidentsCount}
      />

      <main className="app-container">
        {/* Top Operational Stats */}
        <StatsCards metrics={metrics} />

        {/* Tab Views */}
        {activeTab === 'overview' && (
          <DeviceFleetView devices={devices} onRefresh={loadInitialData} />
        )}

        {activeTab === 'events' && (
          <LiveEventStreamView
            events={events}
            isPaused={isStreamPaused}
            setIsPaused={setIsStreamPaused}
            onClear={() => setEvents([])}
          />
        )}

        {activeTab === 'incidents' && (
          <IncidentsView incidents={incidents} onRefresh={loadInitialData} />
        )}

        {activeTab === 'rules' && (
          <RulesEngineView rules={rules} onRefresh={loadInitialData} />
        )}

        {activeTab === 'health' && (
          <SystemHealthView metrics={metrics} onRefresh={loadInitialData} />
        )}

        {activeTab === 'simulator' && (
          <SimulatorControlStation devices={devices} onTriggerSuccess={loadInitialData} />
        )}
      </main>
    </div>
  );
}
