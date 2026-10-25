import React, { useState } from 'react';
import { Play, Pause, Trash2, Search, Code, X, Activity, AlertCircle, Clock, Check } from 'lucide-react';

export default function LiveEventStreamView({ events, isPaused, setIsPaused, onClear }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [inspectEvent, setInspectEvent] = useState(null);
  const [copied, setCopied] = useState(false);

  const filteredEvents = events.filter(e => {
    const devId = (e.deviceId || e.device_id || '').toLowerCase();
    const evtType = (e.eventType || e.event_type || '').toLowerCase();
    const matchesSearch = devId.includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'ALL' || evtType === typeFilter.toLowerCase();
    return matchesSearch && matchesType;
  });

  const handleCopyJson = (data) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="panel waterfall-container">
      {/* Waterfall Control Toolbar */}
      <div className="panel-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Activity size={16} color="#0284c7" />
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Live Telemetry Waterfall
          </h2>
          <span className={`badge ${!isPaused ? 'badge-emerald' : 'badge-amber'}`}>
            <span className={`pulse-dot ${!isPaused ? 'online' : 'warning'}`} style={{ width: 6, height: 6 }} />
            {!isPaused ? 'LIVE STREAMING' : 'STREAM PAUSED'}
          </span>
          <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            ({events.length} frames buffered)
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 8, top: 8 }} />
            <input
              type="text"
              placeholder="Filter by device ID..."
              className="form-input"
              style={{ paddingLeft: 28, width: 180, height: 28 }}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Type Filter */}
          <select
            className="form-select"
            style={{ width: 120, height: 28 }}
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
          >
            <option value="ALL">All Events</option>
            <option value="TELEMETRY">Telemetry</option>
            <option value="HEARTBEAT">Heartbeat</option>
            <option value="ALERT">Alert</option>
            <option value="FAULT">Fault</option>
          </select>

          {/* Freeze / Resume Button */}
          <button
            className={`btn ${isPaused ? 'btn-primary' : 'btn-secondary'}`}
            style={{ height: 28, padding: '0 10px' }}
            onClick={() => setIsPaused(!isPaused)}
          >
            {isPaused ? <Play size={12} /> : <Pause size={12} />}
            {isPaused ? 'Resume' : 'Freeze'}
          </button>

          {/* Clear Buffer Button */}
          <button
            className="btn btn-secondary"
            style={{ height: 28, padding: '0 8px' }}
            onClick={onClear}
            title="Clear buffer from UI memory"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Waterfall Scrollable Table Area */}
      <div className="waterfall-table-wrapper">
        {filteredEvents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
            <Activity size={32} color="#cbd5e1" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 500 }}>
              Waiting for incoming WebSocket telemetry frames...
            </p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
              Run the autonomous edge simulator or dispatch frames to view live events.
            </p>
          </div>
        ) : (
          <table className="waterfall-table">
            <thead>
              <tr className="waterfall-header-row">
                <th className="waterfall-th" style={{ width: 110 }}>Timestamp</th>
                <th className="waterfall-th" style={{ width: 140 }}>Device Identifier</th>
                <th className="waterfall-th" style={{ width: 70 }}>Seq #</th>
                <th className="waterfall-th" style={{ width: 90 }}>Event Type</th>
                <th className="waterfall-th">Telemetry Metrics / Payload Data</th>
                <th className="waterfall-th" style={{ width: 130 }}>Ingestion Tags</th>
                <th className="waterfall-th" style={{ width: 60, textAlign: 'center' }}>Raw</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map(evt => {
                const devId = evt.deviceId || evt.device_id || 'unknown';
                const seq = evt.sequenceNumber ?? evt.sequence_number ?? 0;
                const type = (evt.eventType || evt.event_type || 'telemetry').toUpperCase();
                const payload = evt.payload || {};
                const timestamp = evt.timestamp || evt.received_at || new Date().toISOString();
                const isOutOfOrder = evt.is_out_of_order === 1 || evt.isOutOfOrder;
                const isDuplicate = evt.is_duplicate === 1 || evt.isDuplicate;
                const isFault = type === 'FAULT' || payload.status === 'FAULT';

                let rowClass = 'normal';
                if (isFault) rowClass = 'fault';
                else if (isOutOfOrder) rowClass = 'out-of-order';
                else if (isDuplicate) rowClass = 'duplicate';

                const formattedTime = new Date(timestamp).toLocaleTimeString('en-US', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                });

                return (
                  <tr
                    key={evt.id || Math.random()}
                    className={`waterfall-row ${rowClass}`}
                    onClick={() => setInspectEvent(evt)}
                  >
                    {/* Timestamp */}
                    <td className="waterfall-td mono" style={{ color: 'var(--text-muted)' }}>
                      {formattedTime}
                    </td>

                    {/* Device Identifier */}
                    <td className="waterfall-td mono" style={{ color: '#0284c7', fontWeight: 600 }}>
                      {devId}
                    </td>

                    {/* Sequence Number */}
                    <td className="waterfall-td mono" style={{ color: 'var(--text-secondary)' }}>
                      #{seq}
                    </td>

                    {/* Event Type Badge */}
                    <td className="waterfall-td">
                      <span className={`badge ${
                        type === 'FAULT' ? 'badge-rose' :
                        type === 'ALERT' ? 'badge-amber' :
                        type === 'HEARTBEAT' ? 'badge-purple' : 'badge-muted'
                      }`}>
                        {type}
                      </span>
                    </td>

                    {/* Metrics / Payload */}
                    <td className="waterfall-td">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {payload.temperature !== undefined && (
                          <span className="metric-chip">
                            T: <strong style={{ color: payload.temperature > 80 ? '#e11d48' : '#059669' }}>
                              {payload.temperature}°C
                            </strong>
                          </span>
                        )}
                        {payload.battery !== undefined && (
                          <span className="metric-chip">
                            Bat: <strong style={{ color: payload.battery < 15 ? '#d97706' : '#475569' }}>
                              {payload.battery}%
                            </strong>
                          </span>
                        )}
                        {payload.vibration !== undefined && (
                          <span className="metric-chip" style={{ color: '#475569' }}>
                            Vib: {payload.vibration}g
                          </span>
                        )}
                        {payload.errorCode && (
                          <span className="badge badge-rose">
                            <AlertCircle size={10} /> {payload.errorCode}
                          </span>
                        )}
                        {payload.note && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            "{payload.note}"
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Ingestion Flags */}
                    <td className="waterfall-td">
                      {isOutOfOrder && (
                        <span className="badge badge-amber" title="Arrived with out-of-order sequence">
                          <Clock size={10} /> Out-of-Order
                        </span>
                      )}
                      {isDuplicate && (
                        <span className="badge badge-emerald" title="Network duplicate deduplicated idempotently">
                          Dedup
                        </span>
                      )}
                      {!isOutOfOrder && !isDuplicate && (
                        <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
                          Monotonic OK
                        </span>
                      )}
                    </td>

                    {/* Raw Inspect Action */}
                    <td className="waterfall-td" style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '2px 6px', fontSize: '0.7rem' }}
                        onClick={(e) => { e.stopPropagation(); setInspectEvent(evt); }}
                        title="View raw JSON payload"
                      >
                        <Code size={11} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* JSON Inspection Modal */}
      {inspectEvent && (
        <div className="modal-overlay" onClick={() => setInspectEvent(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ fontSize: '0.95rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Code size={16} color="#0284c7" />
                Raw Telemetry Frame: {inspectEvent.id || inspectEvent.eventId}
              </h3>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 6px' }}
                onClick={() => setInspectEvent(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
                <span className="badge badge-cyan">Node: {inspectEvent.deviceId || inspectEvent.device_id}</span>
                <span className="badge badge-amber">Seq #{inspectEvent.sequenceNumber ?? inspectEvent.sequence_number}</span>
                <span className="badge badge-muted">Type: {inspectEvent.eventType || inspectEvent.event_type}</span>
              </div>
              <pre style={{
                background: '#f8fafc',
                padding: 14,
                borderRadius: 'var(--radius-sm)',
                color: '#0f172a',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                overflowX: 'auto',
                border: '1px solid var(--border-subtle)',
                maxHeight: 320
              }}>
                {JSON.stringify(inspectEvent, null, 2)}
              </pre>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-primary"
                onClick={() => handleCopyJson(inspectEvent)}
              >
                {copied ? <Check size={13} /> : <Code size={13} />}
                {copied ? 'Copied to Clipboard!' : 'Copy Frame JSON'}
              </button>
              <button className="btn btn-secondary" onClick={() => setInspectEvent(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
