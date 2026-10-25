import React from 'react';
import { Cpu, Radio, AlertOctagon, Layers, ShieldCheck, Zap } from 'lucide-react';

export default function StatsCards({ metrics }) {
  const devices = metrics?.devices || { total: 0, online: 0, offline: 0 };
  const events = metrics?.events || { totalIngested: 0, duplicatesInDb: 0, outOfOrderInDb: 0 };
  const incidents = metrics?.incidents || { total: 0, open: 0, acknowledged: 0, resolved: 0, criticalActive: 0 };
  const dlq = metrics?.dlq || { pendingCount: 0 };
  const queue = metrics?.queue || { queueDepth: 0, avgProcessingLatencyMs: 0 };
  const cb = metrics?.notificationCircuitBreaker || { circuitState: 'CLOSED' };

  const onlineRatio = devices.total > 0 ? Math.round((devices.online / devices.total) * 100) : 0;
  const isCircuitClosed = cb.circuitState === 'CLOSED';
  const activeIncidentsCount = (incidents.open || 0) + (incidents.acknowledged || 0);

  return (
    <div className="stats-grid">
      {/* 1. Fleet Health */}
      <div className="stat-card-compact emerald">
        <div className="stat-compact-header">
          <span className="stat-compact-title">Fleet Health</span>
          <Cpu size={15} color="#059669" />
        </div>
        <div className="stat-compact-value">
          <span style={{ color: '#059669' }}>{devices.online}</span>
          <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)', fontWeight: 500 }}> / {devices.total}</span>
        </div>
        <div className="stat-compact-subtext">
          <span style={{ color: onlineRatio >= 80 ? '#059669' : '#e11d48', fontWeight: 600 }}>
            {onlineRatio}% Online
          </span>
          <span>• {devices.offline} Offline</span>
        </div>
      </div>

      {/* 2. Total Ingested Telemetry */}
      <div className="stat-card-compact cyan">
        <div className="stat-compact-header">
          <span className="stat-compact-title">Total Ingested</span>
          <Radio size={15} color="#0284c7" />
        </div>
        <div className="stat-compact-value" style={{ color: '#0f172a' }}>
          {(events.totalIngested || 0).toLocaleString()}
        </div>
        <div className="stat-compact-subtext">
          <span>{events.duplicatesInDb || 0} Dups Filtered</span>
          <span>• {events.outOfOrderInDb || 0} Replays</span>
        </div>
      </div>

      {/* 3. Active Incident Triage */}
      <div className="stat-card-compact rose">
        <div className="stat-compact-header">
          <span className="stat-compact-title">Active Incidents</span>
          <AlertOctagon size={15} color="#e11d48" />
        </div>
        <div className="stat-compact-value" style={{ color: activeIncidentsCount > 0 ? '#e11d48' : '#0f172a' }}>
          {activeIncidentsCount}
        </div>
        <div className="stat-compact-subtext">
          <span style={{ color: incidents.criticalActive > 0 ? '#e11d48' : 'var(--text-muted)', fontWeight: 600 }}>
            {incidents.criticalActive || 0} Critical
          </span>
          <span>• {incidents.resolved || 0} Resolved</span>
        </div>
      </div>

      {/* 4. Ingestion Buffer & Backpressure */}
      <div className="stat-card-compact amber">
        <div className="stat-compact-header">
          <span className="stat-compact-title">Ingestion Queue</span>
          <Layers size={15} color="#d97706" />
        </div>
        <div className="stat-compact-value" style={{ color: queue.queueDepth > 1000 ? '#d97706' : '#0f172a' }}>
          {queue.queueDepth}
        </div>
        <div className="stat-compact-subtext">
          <span>Latency: {queue.avgProcessingLatencyMs || 0}ms</span>
          <span>• Cap: {queue.maxCapacity || 5000}</span>
        </div>
      </div>

      {/* 5. Dead Letter Queue */}
      <div className="stat-card-compact purple">
        <div className="stat-compact-header">
          <span className="stat-compact-title">DLQ Quarantine</span>
          <ShieldCheck size={15} color="#7c3aed" />
        </div>
        <div className="stat-compact-value" style={{ color: dlq.pendingCount > 0 ? '#7c3aed' : '#0f172a' }}>
          {dlq.pendingCount}
        </div>
        <div className="stat-compact-subtext">
          <span>Malformed / Failed Events</span>
        </div>
      </div>

      {/* 6. Notification Circuit Breaker */}
      <div className={`stat-card-compact ${isCircuitClosed ? 'emerald' : 'rose'}`}>
        <div className="stat-compact-header">
          <span className="stat-compact-title">Circuit Breaker</span>
          <Zap size={15} color={isCircuitClosed ? '#059669' : '#e11d48'} />
        </div>
        <div className="stat-compact-value" style={{
          fontSize: '1.25rem',
          color: isCircuitClosed ? '#059669' : cb.circuitState === 'HALF_OPEN' ? '#d97706' : '#e11d48'
        }}>
          {cb.circuitState}
        </div>
        <div className="stat-compact-subtext">
          <span>{cb.pendingBufferedCount || 0} Buffered Alerts</span>
        </div>
      </div>
    </div>
  );
}
