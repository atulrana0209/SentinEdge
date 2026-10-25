import React, { useState, useEffect } from 'react';
import { Plus, Sliders, ToggleLeft, ToggleRight, Trash2, Check, X, ShieldAlert, FileSearch } from 'lucide-react';
import { api } from '../services/api';

export default function RulesEngineView({ rules, onRefresh }) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [traces, setTraces] = useState([]);
  const [isLoadingTraces, setIsLoadingTraces] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ruleType, setRuleType] = useState('THRESHOLD');
  const [metricKey, setMetricKey] = useState('temperature');
  const [operator, setOperator] = useState('>');
  const [thresholdValue, setThresholdValue] = useState('80');
  const [eventTypeFilter, setEventTypeFilter] = useState('FAULT');
  const [timeoutSeconds, setTimeoutSeconds] = useState('30');
  const [severity, setSeverity] = useState('CRITICAL');
  const [deviceFilter, setDeviceFilter] = useState('');

  const loadTraces = async () => {
    setIsLoadingTraces(true);
    try {
      const res = await api.getEvaluationTraces(40);
      setTraces(res.traces || []);
    } catch (e) {
      console.error('Error loading traces:', e);
    } finally {
      setIsLoadingTraces(false);
    }
  };

  useEffect(() => {
    loadTraces();
  }, []);

  const handleToggle = async (rule) => {
    try {
      await api.toggleRule(rule.id, !rule.is_enabled);
      onRefresh();
    } catch (e) {
      alert('Error toggling rule: ' + e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    try {
      await api.deleteRule(id);
      onRefresh();
    } catch (e) {
      alert('Error deleting rule: ' + e.message);
    }
  };

  const handleCreateRule = async (e) => {
    e.preventDefault();
    if (!name.trim()) return alert('Please provide a rule name');

    try {
      const payload = {
        name,
        description,
        rule_type: ruleType,
        severity,
        device_filter: deviceFilter.trim() || null
      };

      if (ruleType === 'THRESHOLD') {
        payload.metric_key = metricKey;
        payload.operator = operator;
        payload.threshold_value = parseFloat(thresholdValue);
      } else if (ruleType === 'HEARTBEAT_TIMEOUT') {
        payload.timeout_seconds = parseInt(timeoutSeconds, 10);
      } else if (ruleType === 'EVENT_TYPE') {
        payload.event_type_filter = eventTypeFilter;
      }

      await api.createRule(payload);
      setShowCreateModal(false);
      setName('');
      setDescription('');
      onRefresh();
    } catch (err) {
      alert('Error creating rule: ' + err.message);
    }
  };

  return (
    <div>
      <div className="glass-panel" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              Real-Time Rule & Incident Policy Engine
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Define automated evaluation rules for thresholds, silence detection, and critical event triggers
            </p>
          </div>

          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} /> Define New Rule
          </button>
        </div>
      </div>

      {/* Rules Table */}
      <div className="glass-panel" style={{ overflow: 'hidden', marginBottom: 24 }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Rule Name</th>
              <th>Type</th>
              <th>Trigger Condition</th>
              <th>Severity</th>
              <th>Target Scope</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(rule => (
              <tr key={rule.id}>
                <td>
                  <span className={`badge ${rule.is_enabled ? 'badge-online' : 'badge-offline'}`}>
                    {rule.is_enabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </td>
                <td>
                  <div style={{ fontWeight: 600, color: '#fff' }}>{rule.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{rule.description}</div>
                </td>
                <td>
                  <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.05)' }}>
                    {rule.rule_type}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: '0.825rem', color: 'var(--accent-cyan)' }}>
                  {rule.rule_type === 'THRESHOLD' && (
                    <span>payload.{rule.metric_key} {rule.operator} {rule.threshold_value}</span>
                  )}
                  {rule.rule_type === 'HEARTBEAT_TIMEOUT' && (
                    <span>silence &gt; {rule.timeout_seconds}s</span>
                  )}
                  {rule.rule_type === 'EVENT_TYPE' && (
                    <span>type == '{rule.event_type_filter}'</span>
                  )}
                </td>
                <td>
                  <span className={`badge ${rule.severity === 'CRITICAL' ? 'badge-critical' : 'badge-warning'}`}>
                    {rule.severity}
                  </span>
                </td>
                <td style={{ color: 'var(--text-secondary)', fontSize: '0.825rem' }}>
                  {rule.device_filter ? rule.device_filter : 'All Devices'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn btn-secondary btn-sm"
                    style={{ marginRight: 6 }}
                    onClick={() => handleToggle(rule)}
                    title={rule.is_enabled ? 'Disable Rule' : 'Enable Rule'}
                  >
                    {rule.is_enabled ? <ToggleRight size={16} color="#34d399" /> : <ToggleLeft size={16} color="#94a3b8" />}
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => handleDelete(rule.id)}
                    title="Delete Rule"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Evaluation Trace Log (Why an incident was or was not created) */}
      <div className="glass-panel" style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileSearch size={18} color="var(--accent-cyan)" />
              Rule Evaluation Audit Trace
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Real-time audit record explaining precisely why rules matched or skipped incoming events
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={loadTraces}>
            Refresh Traces
          </button>
        </div>

        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {traces.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
              No evaluation traces recorded yet. Ingest telemetry to see real-time rule traces.
            </div>
          ) : (
            <table className="custom-table" style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Outcome</th>
                  <th>Device</th>
                  <th>Rule Name</th>
                  <th>Reason / Explanation</th>
                </tr>
              </thead>
              <tbody>
                {traces.map(t => (
                  <tr key={t.id}>
                    <td className="mono" style={{ color: 'var(--text-dim)' }}>
                      {new Date(t.evaluated_at).toLocaleTimeString()}
                    </td>
                    <td>
                      <span className={`badge ${t.matched === 1 ? 'badge-critical' : 'badge-online'}`} style={{ fontSize: '0.65rem' }}>
                        {t.matched === 1 ? 'MATCHED' : 'SKIPPED'}
                      </span>
                    </td>
                    <td className="mono" style={{ color: 'var(--accent-cyan)' }}>
                      {t.device_id}
                    </td>
                    <td style={{ fontWeight: 600 }}>{t.rule_name}</td>
                    <td style={{ color: t.matched === 1 ? '#fda4af' : 'var(--text-secondary)' }}>
                      {t.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Rule Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <form onSubmit={handleCreateRule}>
              <div className="modal-header">
                <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>Create Monitoring Rule</h3>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)}>
                  <X size={16} />
                </button>
              </div>

              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Rule Name</label>
                  <input
                    type="text"
                    required
                    className="form-input"
                    placeholder="e.g. Excessive Vibration Warning"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Description</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Operator guidance or runbook notes"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Rule Evaluation Type</label>
                    <select
                      className="form-select"
                      value={ruleType}
                      onChange={e => setRuleType(e.target.value)}
                    >
                      <option value="THRESHOLD">Metric Threshold Comparison</option>
                      <option value="HEARTBEAT_TIMEOUT">Silence / Heartbeat Timeout</option>
                      <option value="EVENT_TYPE">Event Type / Fault Match</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Incident Severity</label>
                    <select
                      className="form-select"
                      value={severity}
                      onChange={e => setSeverity(e.target.value)}
                    >
                      <option value="CRITICAL">Critical</option>
                      <option value="WARNING">Warning</option>
                      <option value="INFO">Info</option>
                    </select>
                  </div>
                </div>

                {/* Conditional Fields */}
                {ruleType === 'THRESHOLD' && (
                  <div style={{
                    padding: 14,
                    background: 'rgba(255, 255, 255, 0.02)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    marginBottom: 16
                  }}>
                    <label className="form-label">Condition: payload.[metric] [operator] [value]</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: 10 }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="metric key (e.g. vibration)"
                        value={metricKey}
                        onChange={e => setMetricKey(e.target.value)}
                      />
                      <select
                        className="form-select"
                        value={operator}
                        onChange={e => setOperator(e.target.value)}
                      >
                        <option value=">">&gt;</option>
                        <option value="<">&lt;</option>
                        <option value=">=">&gt;=</option>
                        <option value="<=">&lt;=</option>
                        <option value="==">==</option>
                      </select>
                      <input
                        type="number"
                        step="any"
                        className="form-input"
                        placeholder="threshold value"
                        value={thresholdValue}
                        onChange={e => setThresholdValue(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {ruleType === 'HEARTBEAT_TIMEOUT' && (
                  <div className="form-group">
                    <label className="form-label">Silence Duration Before Trigger (Seconds)</label>
                    <input
                      type="number"
                      className="form-input"
                      value={timeoutSeconds}
                      onChange={e => setTimeoutSeconds(e.target.value)}
                    />
                  </div>
                )}

                {ruleType === 'EVENT_TYPE' && (
                  <div className="form-group">
                    <label className="form-label">Target Event Type Filter</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. FAULT, CRITICAL, TAMPER"
                      value={eventTypeFilter}
                      onChange={e => setEventTypeFilter(e.target.value)}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">Device Scope (Optional: empty for all devices)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. sensor-nyc-01 or leave blank for all fleet"
                    value={deviceFilter}
                    onChange={e => setDeviceFilter(e.target.value)}
                  />
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Deploy Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
