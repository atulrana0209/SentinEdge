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

  // References for live stream updates and reconnection gap-filling
  const isPausedRef = useRef(isStreamPaused);
  isPausedRef.current = isStreamPaused;

  const loadInitialData = async () => {
    try {
      const [devRes, incRes, ruleRes, metRes, evtRes] = await Promise.all([
        api.getDevices().catch(() => ({ devices: [] })),
        api.getIncidents().catch(() => ({ incidents: [] })),
        api.getRules().catch(() => ({ rules: [] })),
        api.getMetrics().catch(() => null),
        api.getEvents({ limit: 50 }).catch(() => ({ events: [] }))
      ]);

      setDevices(devRes.devices || []);
      setIncidents(incRes.incidents || []);
      setRules(ruleRes.rules || []);
      if (metRes) setMetrics(metRes);
      setEvents(evtRes.events || []);
    } catch (err) {
      console.error('[SentinEdge] Initial fetch error:', err);
    }
  };

  /**
   * Resilient Gap-Free Cursor Reconnection
   * When WebSocket reconnects, fetches missed events since disconnect
   * and merges them into current client state without wiping buffer.
   */
  const resyncAfterReconnect = async () => {
    try {
      // 1. Refresh live fleet, active incidents, and platform health counters
      const [devRes, incRes, metRes, evtRes] = await Promise.all([
        api.getDevices().catch(() => ({ devices: [] })),
        api.getIncidents().catch(() => ({ incidents: [] })),
        api.getMetrics().catch(() => null),
        api.getEvents({ limit: 100 }).catch(() => ({ events: [] }))
      ]);

      if (devRes.devices) setDevices(devRes.devices);
      if (incRes.incidents) setIncidents(incRes.incidents);
      if (metRes) setMetrics(metRes);

      // 2. Patch missing event gap into the local client buffer
      const recent = evtRes.events || [];
      setEvents(prevEvents => {
        const existingIds = new Set(prevEvents.map(e => e.id || e.eventId));
        const missingEvents = recent.filter(e => !existingIds.has(e.id || e.eventId));

        if (missingEvents.length === 0) return prevEvents;

        // Merge missing events and sort descending by received timestamp
        const merged = [...missingEvents, ...prevEvents].sort((a, b) => {
          const timeA = new Date(a.receivedAt || a.received_at || a.timestamp).getTime();
          const timeB = new Date(b.receivedAt || b.received_at || b.timestamp).getTime();
          return timeB - timeA;
        });

        // Cap client memory buffer at 100 items for smooth render performance
        return merged.slice(0, 100);
      });
    } catch (err) {
      console.error('[SentinEdge] Gap resync error:', err);
    }
  };

  useEffect(() => {
    loadInitialData();

    // Setup Resilient WebSocket Client with Gap-Free Reconnection
    const liveSocket = new LiveSocket(
      (status) => {
        setConnectionState(status);
        if (status === 'CONNECTED') {
          // Reconnect hook: perform gap-free state reconciliation
          resyncAfterReconnect();
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
          const currentDevice = prev[idx];

          // STATE REGRESSION GUARD:
          // Do not regress last_seen_at if the event is out-of-order or has an older timestamp!
          const currentLastSeenMs = currentDevice.last_seen_at ? new Date(currentDevice.last_seen_at).getTime() : 0;
          const eventTimeMs = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
          const shouldAdvanceTimestamp = !event.isOutOfOrder && (eventTimeMs >= currentLastSeenMs);

          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            status: 'ONLINE',
            last_seen_at: shouldAdvanceTimestamp ? (event.timestamp || new Date().toISOString()) : currentDevice.last_seen_at,
            last_sequence_number: Math.max(currentDevice.last_sequence_number || 0, event.sequenceNumber || 0),
            total_events: (currentDevice.total_events || 0) + 1
          };
          return updated;
        } else {
          return [{
            id: event.deviceId,
            name: device?.name || `Device ${event.deviceId}`,
            location: 'Site Alpha',
            status: 'ONLINE',
            last_seen_at: event.timestamp || new Date().toISOString(),
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
      setIncidents(prev => prev.map(inc => (inc.id === data.id ? { ...inc, ...data } : inc)));
    }

    else if (type === 'device:status_change') {
      setDevices(prev => prev.map(d => (d.id === data.deviceId ? { ...d, status: data.currentStatus } : d)));
    }
  };

  const openIncidentsCount = incidents.filter(i => i.status === 'OPEN').length;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-app)' }}>
      {/* Reconnection Alert Banner if connection lost */}
      {connectionState !== 'CONNECTED' && (
        <div className="reconnect-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <WifiOff size={16} />
            <span>
              Real-time stream connection interrupted.
              {connectionState === 'RECONNECTING'
                ? ' Attempting automatic reconnection & telemetry gap resync...'
                : ' Operations cockpit active in offline cached mode.'}
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={resyncAfterReconnect}
          >
            <RefreshCw size={12} /> Force Resync
          </button>
        </div>
      )}

      {/* Clean Sticky Header and Navigation */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connectionState={connectionState}
        openIncidentsCount={openIncidentsCount}
      />

      {/* Main Operations Cockpit Content Area */}
      <main className="app-container" style={{ flex: 1, width: '100%' }}>
        {/* Crisp Top Executive Metrics Cards */}
        <StatsCards metrics={metrics} />

        {/* Tab Content Views */}
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
