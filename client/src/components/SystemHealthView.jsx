import React, { useState, useEffect } from 'react';
import {
  Server,
  Activity,
  Layers,
  ShieldAlert,
  Zap,
  RotateCcw,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Database
} from 'lucide-react';
import { api } from '../services/api';

export default function SystemHealthView({ metrics, onRefresh }) {
  const [dlqItems, setDlqItems] = useState([]);
  const [isLoadingDlq, setIsLoadingDlq] = useState(false);
  const [isTogglingCircuit, setIsTogglingCircuit] = useState(false);

  const loadDlq = async () => {
    setIsLoadingDlq(true);
    try {
      const res = await api.getDlq();
      setDlqItems(res.items || []);
    } catch (e) {
      console.error('Error fetching DLQ:', e);
    } finally {
      setIsLoadingDlq(false);
    }
  };

  useEffect(() => {
    loadDlq();
  }, []);

  const handleRetry = async (id) => {
    try {
      const res = await api.retryDlq(id);
      if (res.success) {
        alert('Event successfully reprocessed from DLQ!');
        loadDlq();
        onRefresh();
      } else {
        alert('Retry failed: ' + res.error);
      }
    } catch (e) {
      alert('Retry error: ' + e.message);
    }
  };

  const handleDiscard = async (id) => {
    try {
      await api.discardDlq(id);
      loadDlq();
      onRefresh();
    } catch (e) {
      alert('Discard error: ' + e.message);
    }
  };

  const handleToggleCircuitBreaker = async () => {
    const currentMode = metrics?.notificationCircuitBreaker?.simulatedFailureMode || false;
    setIsTogglingCircuit(true);
    try {
      await api.toggleCircuitBreaker(!currentMode);
      onRefresh();
    } catch (e) {
      alert('Error toggling circuit breaker mode: ' + e.message);
    } finally {
      setIsTogglingCircuit(false);
    }
  };

  const cb = metrics?.notificationCircuitBreaker || { circuitState: 'CLOSED' };
  const queue = metrics?.queue || {};
  const dedup = metrics?.events?.cacheStats || {};

  return (
    <div>
      <div className="glass-panel" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
            System Telemetry & Reliability Diagnostics
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Observability health checks, ingestion queue backpressure, circuit breaker state, and Dead Letter Queue
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20, marginBottom: 24 }}>
        {/* Core Node & Storage Health */}
        <div className="glass-panel" style={{ padding: 22 }}>
          <h3 style={{ fontSize: '1rem', color: '#fff', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Server size={18} color="var(--accent-cyan)" /> Core Runtime Health
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>System Status</span>
              <span className="badge badge-online">
                <span className="status-dot online" /> HEALTHY (UP)
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Uptime</span>
              <span className="mono" style={{ color: '#fff' }}>{metrics?.uptimeSeconds || 0} seconds</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Database Engine</span>
              <span className="badge badge-online">
                <Database size={12} style={{ marginRight: 4 }} /> SQLite 3 (WAL Mode)
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>WebSocket Subscribers</span>
              <span className="mono" style={{ color: 'var(--accent-cyan)' }}>
                {metrics?.websockets?.activeConnections || 0} active sockets
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Deduplication Cache</span>
              <span className="mono" style={{ color: '#fff' }}>
                {dedup.cachedEntries || 0} hashes in LRU Map ({dedup.totalDuplicatesDetected || 0} intercepted)
              </span>
            </div>
          </div>
        </div>

        {/* External Notification Circuit Breaker */}
        <div className="glass-panel" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: '1rem', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Zap size={18} color={cb.circuitState === 'CLOSED' ? '#10b981' : '#f43f5e'} />
                External Notification Circuit Breaker
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: 2 }}>
                Protects platform from cascade failures when downstream webhook or pager is down
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.875rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Circuit State</span>
              <span className={`badge ${
                cb.circuitState === 'CLOSED' ? 'badge-resolved' :
                cb.circuitState === 'HALF_OPEN' ? 'badge-warning' : 'badge-critical'
              }`}>
                {cb.circuitState}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Consecutive Failures</span>
              <span className="mono" style={{ color: cb.failureCount > 0 ? '#fbbf24' : '#fff' }}>
                {cb.failureCount} / {cb.failureThreshold} (trip threshold)
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Buffered During Outage</span>
              <span className="mono" style={{ color: cb.pendingBufferedCount > 0 ? '#fda4af' : '#fff' }}>
                {cb.pendingBufferedCount || 0} queued alerts
              </span>
            </div>

            <div style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>
                    Simulate Downstream Outage
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Forces external notifications to fail for resilience testing
                  </div>
                </div>
                <button
                  className={`btn btn-sm ${cb.simulatedFailureMode ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={handleToggleCircuitBreaker}
                  disabled={isTogglingCircuit}
                >
                  {cb.simulatedFailureMode ? 'Outage Active (Reset)' : 'Simulate Outage'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dead Letter Queue (DLQ) Inspector */}
      <div className="glass-panel" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShieldAlert size={18} color="var(--accent-violet)" />
              Dead Letter Queue (DLQ) & Quarantine
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Quarantined malformed payloads and processing failure events with manual retry & discard capabilities
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadDlq}>
            <RotateCcw size={14} /> Refresh DLQ
          </button>
        </div>

        {dlqItems.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            No quarantined items in the Dead Letter Queue. All ingested payloads have valid schema.
          </div>
        ) : (
          <table className="custom-table" style={{ fontSize: '0.8rem' }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>DLQ ID</th>
                <th>Failure Reason</th>
                <th>Error Details</th>
                <th>Received At</th>
                <th>Retries</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {dlqItems.map(item => (
                <tr key={item.id}>
                  <td>
                    <span className={`badge ${
                      item.status === 'PENDING' ? 'badge-critical' :
                      item.status === 'RETRIED' ? 'badge-resolved' : 'badge-warning'
                    }`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="mono" style={{ color: 'var(--accent-cyan)' }}>
                    {item.id}
                  </td>
                  <td style={{ fontWeight: 600 }}>{item.reason}</td>
                  <td style={{ color: '#fda4af', maxWidth: 280, wordBreak: 'break-word' }}>
                    {item.error_details || 'Schema validation failure'}
                  </td>
                  <td className="mono" style={{ color: 'var(--text-dim)' }}>
                    {new Date(item.received_at).toLocaleTimeString()}
                  </td>
                  <td className="mono">{item.retries}</td>
                  <td style={{ textAlign: 'right' }}>
                    {item.status === 'PENDING' && (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ marginRight: 6 }}
                          onClick={() => handleRetry(item.id)}
                        >
                          Retry
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDiscard(item.id)}
                        >
                          Discard
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
