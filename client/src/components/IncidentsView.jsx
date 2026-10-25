import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  ShieldAlert,
  UserCheck,
  X,
  Repeat
} from 'lucide-react';
import { api } from '../services/api';

export default function IncidentsView({ incidents, onRefresh }) {
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  // Action state
  const [actionType, setActionType] = useState(null); // 'ACK' | 'RESOLVE'
  const [operatorName, setOperatorName] = useState('Senior Operations Engineer');
  const [resolutionNotes, setResolutionNotes] = useState('Root cause investigated and resolved.');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  const filteredIncidents = incidents.filter(inc => {
    const matchesStatus = statusFilter === 'ALL' || inc.status === statusFilter;
    const matchesSeverity = severityFilter === 'ALL' || inc.severity === severityFilter;
    return matchesStatus && matchesSeverity;
  });

  const handleInspect = async (incident) => {
    setSelectedIncident(incident);
    setIsLoadingDetails(true);
    try {
      const res = await api.getIncidentById(incident.id);
      setSelectedIncident(res.incident);
      setTimeline(res.incident.timeline || []);
    } catch (e) {
      console.error('Error fetching incident timeline:', e);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const submitAcknowledge = async () => {
    if (!selectedIncident) return;
    setIsSubmittingAction(true);
    try {
      const res = await api.acknowledgeIncident(selectedIncident.id, operatorName);
      setSelectedIncident(res.incident);
      setActionType(null);
      onRefresh();
    } catch (e) {
      alert('Error acknowledging incident: ' + e.message);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const submitResolve = async () => {
    if (!selectedIncident) return;
    setIsSubmittingAction(true);
    try {
      const res = await api.resolveIncident(selectedIncident.id, resolutionNotes);
      setSelectedIncident(res.incident);
      setActionType(null);
      onRefresh();
    } catch (e) {
      alert('Error resolving incident: ' + e.message);
    } finally {
      setIsSubmittingAction(false);
    }
  };

  return (
    <div>
      <div className="glass-panel" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
              Incident Command Center
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Dynamic incident triage with automated alert fatigue protection & deduplication
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <select
              className="form-select"
              style={{ width: 150 }}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
            </select>

            <select
              className="form-select"
              style={{ width: 150 }}
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value)}
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Severity</th>
              <th>Incident Details</th>
              <th>Device Target</th>
              <th>Occurrences</th>
              <th>First Triggered</th>
              <th>Last Seen</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredIncidents.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-muted)' }}>
                  No incidents matching current criteria. All systems nominal.
                </td>
              </tr>
            ) : (
              filteredIncidents.map(inc => (
                <tr key={inc.id}>
                  <td>
                    <span className={`badge ${
                      inc.status === 'OPEN' ? 'badge-open' :
                      inc.status === 'ACKNOWLEDGED' ? 'badge-acknowledged' : 'badge-resolved'
                    }`}>
                      {inc.status}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${inc.severity === 'CRITICAL' ? 'badge-critical' : 'badge-warning'}`}>
                      {inc.severity}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: '#fff' }}>{inc.title}</div>
                    <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
                      {inc.summary}
                    </div>
                  </td>
                  <td>
                    <div className="mono" style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>
                      {inc.device_id}
                    </div>
                  </td>
                  <td>
                    <span className="badge" style={{
                      background: inc.occurrence_count > 1 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                      color: inc.occurrence_count > 1 ? '#fbbf24' : 'var(--text-secondary)'
                    }}>
                      <Repeat size={11} style={{ marginRight: 3 }} />
                      {inc.occurrence_count}x grouped
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {new Date(inc.first_seen_at).toLocaleTimeString()}
                  </td>
                  <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {new Date(inc.last_seen_at).toLocaleTimeString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleInspect(inc)}>
                      <Eye size={14} /> Inspect
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Incident Details & Timeline Modal */}
      {selectedIncident && (
        <div className="modal-overlay" onClick={() => { setSelectedIncident(null); setActionType(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span className={`badge ${selectedIncident.severity === 'CRITICAL' ? 'badge-critical' : 'badge-warning'}`}>
                    {selectedIncident.severity}
                  </span>
                  <span className={`badge ${
                    selectedIncident.status === 'OPEN' ? 'badge-open' :
                    selectedIncident.status === 'ACKNOWLEDGED' ? 'badge-acknowledged' : 'badge-resolved'
                  }`}>
                    {selectedIncident.status}
                  </span>
                  <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {selectedIncident.id}
                  </span>
                </div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff' }}>{selectedIncident.title}</h3>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { setSelectedIncident(null); setActionType(null); }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              {/* Summary metadata card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginBottom: 20
              }}>
                <div style={{ marginBottom: 8, color: '#f1f5f9' }}>{selectedIncident.summary}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, fontSize: '0.8rem' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Device Target: </span>
                    <strong className="mono" style={{ color: 'var(--accent-cyan)' }}>{selectedIncident.device_id}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Repeated Triggers: </span>
                    <strong style={{ color: '#fbbf24' }}>{selectedIncident.occurrence_count} events grouped</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>First Reported: </span>
                    <span className="mono">{new Date(selectedIncident.first_seen_at).toLocaleTimeString()}</span>
                  </div>
                </div>

                {selectedIncident.acknowledged_by && (
                  <div style={{ marginTop: 10, fontSize: '0.8rem', color: '#6ee7b7' }}>
                    Acknowledged by <strong>{selectedIncident.acknowledged_by}</strong> at {new Date(selectedIncident.acknowledged_at).toLocaleTimeString()}
                  </div>
                )}
                {selectedIncident.resolution_notes && (
                  <div style={{ marginTop: 6, fontSize: '0.8rem', color: '#34d399' }}>
                    Resolution Notes: <em>{selectedIncident.resolution_notes}</em>
                  </div>
                )}
              </div>

              {/* Action Form (Acknowledge or Resolve) */}
              {actionType === 'ACK' && (
                <div style={{
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 20
                }}>
                  <h4 style={{ color: '#fbbf24', fontSize: '0.9rem', marginBottom: 10 }}>Acknowledge Incident</h4>
                  <div className="form-group">
                    <label className="form-label">Operator Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={operatorName}
                      onChange={e => setOperatorName(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setActionType(null)}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={submitAcknowledge} disabled={isSubmittingAction}>
                      Confirm Acknowledged
                    </button>
                  </div>
                </div>
              )}

              {actionType === 'RESOLVE' && (
                <div style={{
                  background: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 20
                }}>
                  <h4 style={{ color: '#34d399', fontSize: '0.9rem', marginBottom: 10 }}>Resolve Incident</h4>
                  <div className="form-group">
                    <label className="form-label">Resolution Notes</label>
                    <textarea
                      rows="2"
                      className="form-textarea"
                      value={resolutionNotes}
                      onChange={e => setResolutionNotes(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => setActionType(null)}>Cancel</button>
                    <button className="btn btn-success btn-sm" onClick={submitResolve} disabled={isSubmittingAction}>
                      Confirm Resolved
                    </button>
                  </div>
                </div>
              )}

              {/* Event Timeline */}
              <div>
                <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 12 }}>
                  Incident Audit Timeline & Matching Events ({timeline.length})
                </h4>
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {timeline.map((entry, idx) => (
                    <div key={idx} style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '8px 12px',
                      borderLeft: '2px solid var(--accent-cyan)',
                      background: 'rgba(255, 255, 255, 0.02)',
                      marginBottom: 6,
                      fontSize: '0.8rem'
                    }}>
                      <div className="mono" style={{ color: 'var(--text-dim)', minWidth: 70 }}>
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </div>
                      <div style={{ color: '#f8fafc' }}>
                        {entry.details}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div>
                {selectedIncident.status === 'OPEN' && !actionType && (
                  <button className="btn btn-primary btn-sm" onClick={() => setActionType('ACK')}>
                    <UserCheck size={14} /> Acknowledge
                  </button>
                )}
                {selectedIncident.status !== 'RESOLVED' && !actionType && (
                  <button className="btn btn-success btn-sm" onClick={() => setActionType('RESOLVE')} style={{ marginLeft: 8 }}>
                    <CheckCircle2 size={14} /> Resolve
                  </button>
                )}
              </div>

              <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedIncident(null); setActionType(null); }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
