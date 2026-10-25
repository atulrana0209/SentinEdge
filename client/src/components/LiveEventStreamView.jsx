import React, { useState } from 'react';
import { Play, Pause, Trash2, Search, Code, CheckCircle, AlertTriangle, X } from 'lucide-react';

export default function LiveEventStreamView({ events, isPaused, setIsPaused, onClear }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [inspectEvent, setInspectEvent] = useState(null);

  const filteredEvents = events.filter(e => {
    const devId = (e.deviceId || e.device_id || '').toLowerCase();
    const evtType = (e.eventType || e.event_type || '').toLowerCase();
    const matchesSearch = devId.includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'ALL' || evtType === typeFilter.toLowerCase();
    return matchesSearch && matchesType;
  });

  return (
    <div>
      <div className="glass-panel" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              Live Telemetry Stream
              {!isPaused ? (
                <span className="badge badge-online">
                  <span className="status-dot online" /> STREAMING
                </span>
              ) : (
                <span className="badge badge-warning">
                  PAUSED
                </span>
              )}
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Real-time WebSocket event ingestion pipeline ({events.length} buffered in memory)
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: 11 }} />
              <input
                type="text"
                placeholder="Filter by device ID..."
                className="form-input"
                style={{ paddingLeft: 34, width: 220 }}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="form-select"
              style={{ width: 140 }}
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="ALL">All Types</option>
              <option value="TELEMETRY">Telemetry</option>
              <option value="HEARTBEAT">Heartbeat</option>
              <option value="ALERT">Alert</option>
              <option value="FAULT">Fault</option>
            </select>

            <button
              className={`btn ${isPaused ? 'btn-primary' : 'btn-secondary'} btn-sm`}
              onClick={() => setIsPaused(!isPaused)}
            >
              {isPaused ? <Play size={14} /> : <Pause size={14} />}
              {isPaused ? 'Resume' : 'Freeze'}
            </button>

            <button className="btn btn-secondary btn-sm" onClick={onClear}>
              <Trash2 size={14} /> Clear
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: 16 }}>
        {filteredEvents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: '1rem', marginBottom: 8 }}>Waiting for incoming telemetry events...</p>
            <p style={{ fontSize: '0.8rem' }}>
              Open the <strong>Device Simulator</strong> tab to inject events or burst replays.
            </p>
          </div>
        ) : (
          <div>
            {filteredEvents.map(evt => {
              const devId = evt.deviceId || evt.device_id;
              const seq = evt.sequenceNumber ?? evt.sequence_number ?? 0;
              const type = evt.eventType || evt.event_type || 'telemetry';
              const payload = evt.payload || {};
              const timestamp = evt.timestamp || evt.received_at;

              return (
                <div
                  key={evt.id || Math.random()}
                  className="event-item"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setInspectEvent(evt)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className="mono" style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                      {devId}
                    </span>
                    <span className="mono" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                      #{seq}
                    </span>
                    <span className="badge" style={{
                      background: type.toUpperCase() === 'FAULT' ? 'rgba(244, 63, 94, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                      color: type.toUpperCase() === 'FAULT' ? '#fda4af' : 'var(--text-secondary)'
                    }}>
                      {type}
                    </span>

                    {/* Quick Metric Chips */}
                    <div style={{ display: 'flex', gap: 10, fontSize: '0.8rem', color: '#fff' }}>
                      {payload.temperature !== undefined && (
                        <span>
                          Temp: <strong style={{ color: payload.temperature > 80 ? '#fb7185' : 'inherit' }}>
                            {payload.temperature}°C
                          </strong>
                        </span>
                      )}
                      {payload.battery !== undefined && (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Bat: <strong style={{ color: payload.battery < 15 ? '#fbbf24' : 'inherit' }}>{payload.battery}%</strong>
                        </span>
                      )}
                      {payload.vibration !== undefined && (
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Vib: {payload.vibration}g
                        </span>
                      )}
                      {payload.errorCode && (
                        <span style={{ color: '#fb7185' }}>
                          Err: <strong>{payload.errorCode}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {evt.is_out_of_order === 1 || evt.isOutOfOrder ? (
                      <span className="badge badge-warning" title="Event arrived with out-of-order sequence">
                        Out-of-Order
                      </span>
                    ) : null}

                    {evt.is_duplicate === 1 || evt.isDuplicate ? (
                      <span className="badge badge-resolved" title="Duplicate event received and deduplicated">
                        Deduplicated
                      </span>
                    ) : null}

                    <span className="mono" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                      {new Date(timestamp).toLocaleTimeString()}
                    </span>

                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '3px 8px' }}
                      onClick={(e) => { e.stopPropagation(); setInspectEvent(evt); }}
                    >
                      <Code size={12} /> JSON
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* JSON Payload Inspection Modal */}
      {inspectEvent && (
        <div className="modal-overlay" onClick={() => setInspectEvent(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Code size={18} color="var(--accent-cyan)" />
                Raw Event Payload: {inspectEvent.id}
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setInspectEvent(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 12, display: 'flex', gap: 10 }}>
                <span className="badge badge-online">Device: {inspectEvent.deviceId || inspectEvent.device_id}</span>
                <span className="badge badge-warning">Seq: #{inspectEvent.sequenceNumber ?? inspectEvent.sequence_number}</span>
                <span className="badge">Type: {inspectEvent.eventType || inspectEvent.event_type}</span>
              </div>
              <pre style={{
                background: '#07090e',
                padding: 16,
                borderRadius: 'var(--radius-md)',
                color: '#38bdf8',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                overflowX: 'auto',
                border: '1px solid var(--border-subtle)'
              }}>
                {JSON.stringify(inspectEvent, null, 2)}
              </pre>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(inspectEvent, null, 2));
                  alert('Copied event JSON to clipboard!');
                }}
              >
                Copy JSON
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setInspectEvent(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
