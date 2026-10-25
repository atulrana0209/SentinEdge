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

  return (
    <div className="stats-grid">
      {/* Device Fleet Card */}
      <div className="glass-panel stat-card emerald">
        <div className="stat-header">
          <span>Fleet Health</span>
          <Cpu size={16} color="#10b981" />
        </div>
        <div className="stat-value">
          {devices.online} <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>/ {devices.total}</span>
        </div>
        <div className="stat-subtext">
          <span style={{ color: onlineRatio >= 80 ? '#34d399' : '#f87171', fontWeight: 600 }}>
            {onlineRatio}% Online
          </span>
          <span>• {devices.offline} Offline</span>
        </div>
      </div>

      {/* Events Telemetry Card */}
      <div className="glass-panel stat-card">
        <div className="stat-header">
          <span>Total Ingested Events</span>
          <Radio size={16} color="#06b6d4" />
        </div>
        <div className="stat-value">{events.totalIngested.toLocaleString()}</div>
        <div className="stat-subtext">
          <span>{events.duplicatesInDb || 0} Dups Filtered</span>
          <span>• {events.outOfOrderInDb || 0} Out-of-Order</span>
        </div>
      </div>

      {/* Incidents Card */}
      <div className="glass-panel stat-card rose">
        <div className="stat-header">
          <span>Active Incidents</span>
          <AlertOctagon size={16} color="#f43f5e" />
        </div>
        <div className="stat-value" style={{ color: incidents.open > 0 ? '#fb7185' : '#fff' }}>
          {incidents.open + incidents.acknowledged}
        </div>
        <div className="stat-subtext">
          <span style={{ color: '#fda4af', fontWeight: 600 }}>{incidents.criticalActive} Critical</span>
          <span>• {incidents.resolved} Resolved</span>
        </div>
      </div>

      {/* Buffer Queue Card */}
      <div className="glass-panel stat-card amber">
        <div className="stat-header">
          <span>Ingestion Queue</span>
          <Layers size={16} color="#f59e0b" />
        </div>
        <div className="stat-value">{queue.queueDepth}</div>
        <div className="stat-subtext">
          <span>Avg Latency: {queue.avgProcessingLatencyMs || 0}ms</span>
          <span>• Cap: {queue.maxCapacity || 5000}</span>
        </div>
      </div>

      {/* DLQ / Quarantined Card */}
      <div className="glass-panel stat-card violet">
        <div className="stat-header">
          <span>Dead Letter Queue (DLQ)</span>
          <ShieldCheck size={16} color="#8b5cf6" />
        </div>
        <div className="stat-value" style={{ color: dlq.pendingCount > 0 ? '#c4b5fd' : '#fff' }}>
          {dlq.pendingCount}
        </div>
        <div className="stat-subtext">
          <span>Malformed / Failed Events</span>
        </div>
      </div>

      {/* Notification Circuit Breaker Card */}
      <div className="glass-panel stat-card">
        <div className="stat-header">
          <span>Notification Circuit</span>
          <Zap size={16} color={cb.circuitState === 'CLOSED' ? '#10b981' : '#f43f5e'} />
        </div>
        <div className="stat-value" style={{
          fontSize: '1.4rem',
          color: cb.circuitState === 'CLOSED' ? '#34d399' : cb.circuitState === 'HALF_OPEN' ? '#fbbf24' : '#f87171'
        }}>
          {cb.circuitState}
        </div>
        <div className="stat-subtext">
          <span>{cb.pendingBufferedCount || 0} Buffered Alerts</span>
        </div>
      </div>
    </div>
  );
}
