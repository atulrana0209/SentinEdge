import React, { useState } from 'react';
import { Search, Filter, Eye, RefreshCw, X, Radio, AlertTriangle } from 'lucide-react';
import { api } from '../services/api';

export default function DeviceFleetView({ devices, onRefresh }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [deviceDetails, setDeviceDetails] = useState(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);

  const filteredDevices = devices.filter(dev => {
    const matchesSearch =
      dev.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dev.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dev.location.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || dev.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleInspect = async (device) => {
    setSelectedDevice(device);
    setIsLoadingDetails(true);
    try {
      const res = await api.getDeviceById(device.id);
      setDeviceDetails(res.device);
    } catch (e) {
      console.error('Error fetching device details:', e);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const formatTime = (ts) => {
    if (!ts) return 'Never';
    const date = new Date(ts);
    return date.toLocaleTimeString() + ' (' + date.toLocaleDateString() + ')';
  };

  return (
    <div>
      <div className="glass-panel" style={{ padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Fleet Operations Roster</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Monitoring {devices.length} registered hardware and edge sensor nodes
            </p>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ position: 'relative' }}>
              <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: 11 }} />
              <input
                type="text"
                placeholder="Search device, name, site..."
                className="form-input"
                style={{ paddingLeft: 34, width: 240 }}
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="form-select"
              style={{ width: 140 }}
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="ONLINE">Online</option>
              <option value="OFFLINE">Offline</option>
              <option value="DEGRADED">Degraded</option>
            </select>

            <button className="btn btn-secondary btn-sm" onClick={onRefresh}>
              <RefreshCw size={14} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <table className="custom-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Device Identifier</th>
              <th>Device Name</th>
              <th>Deployment Site</th>
              <th>Last Monitored Activity</th>
              <th>Seq #</th>
              <th>Total Events</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                  No devices matched current filters.
                </td>
              </tr>
            ) : (
              filteredDevices.map(dev => (
                <tr key={dev.id}>
                  <td>
                    <span className={`badge ${dev.status === 'ONLINE' ? 'badge-online' : 'badge-offline'}`}>
                      <span className={`status-dot ${dev.status.toLowerCase()}`} />
                      {dev.status}
                    </span>
                  </td>
                  <td className="mono" style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
                    {dev.id}
                  </td>
                  <td style={{ fontWeight: 600 }}>{dev.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{dev.location}</td>
                  <td className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {formatTime(dev.last_seen_at)}
                  </td>
                  <td className="mono" style={{ color: 'var(--accent-amber)' }}>
                    #{dev.last_sequence_number || 0}
                  </td>
                  <td className="mono" style={{ fontWeight: 600 }}>
                    {dev.total_events?.toLocaleString() || 0}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleInspect(dev)}>
                      <Eye size={14} /> Inspect
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Device Inspection Modal */}
      {selectedDevice && (
        <div className="modal-overlay" onClick={() => setSelectedDevice(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.2rem', color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Radio size={18} color="var(--accent-cyan)" />
                  Telemetry Inspector: {selectedDevice.id}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                  {selectedDevice.name} • {selectedDevice.location}
                </p>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setSelectedDevice(null)}
                style={{ padding: 6 }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              {isLoadingDetails ? (
                <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                  Loading device telemetry...
                </div>
              ) : (
                <>
                  {/* Status Banner */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    borderRadius: 'var(--radius-md)',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    marginBottom: 20
                  }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Current State</div>
                      <span className={`badge ${selectedDevice.status === 'ONLINE' ? 'badge-online' : 'badge-offline'}`} style={{ marginTop: 4 }}>
                        {selectedDevice.status}
                      </span>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Last Monitored</div>
                      <div className="mono" style={{ fontSize: '0.85rem', color: '#fff', marginTop: 4 }}>
                        {formatTime(selectedDevice.last_seen_at)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>High Sequence</div>
                      <div className="mono" style={{ fontSize: '0.85rem', color: 'var(--accent-amber)', marginTop: 4 }}>
                        #{selectedDevice.last_sequence_number}
                      </div>
                    </div>
                  </div>

                  {/* Active Incidents on Device */}
                  {deviceDetails?.activeIncidents?.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <h4 style={{ fontSize: '0.85rem', color: 'var(--accent-rose)', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertTriangle size={15} /> Active Incidents ({deviceDetails.activeIncidents.length})
                      </h4>
                      {deviceDetails.activeIncidents.map(inc => (
                        <div key={inc.id} style={{
                          padding: '10px 14px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(244, 63, 94, 0.1)',
                          border: '1px solid rgba(244, 63, 94, 0.3)',
                          marginBottom: 6,
                          fontSize: '0.85rem'
                        }}>
                          <div style={{ fontWeight: 600, color: '#fff' }}>{inc.title}</div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.775rem' }}>{inc.summary}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recent Ingested Events */}
                  <div>
                    <h4 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 10 }}>
                      Recent Telemetry Samples ({deviceDetails?.recentEvents?.length || 0})
                    </h4>
                    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                      {deviceDetails?.recentEvents?.map(evt => (
                        <div key={evt.id} className="event-item" style={{ fontSize: '0.8rem' }}>
                          <div>
                            <span className="mono" style={{ color: 'var(--accent-cyan)', marginRight: 8 }}>
                              #{evt.sequence_number}
                            </span>
                            <span style={{ color: '#fff' }}>
                              Temp: {evt.payload?.temperature ?? 'N/A'}°C
                            </span>
                            {evt.payload?.battery !== undefined && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                                • Bat: {evt.payload.battery}%
                              </span>
                            )}
                            {evt.payload?.vibration !== undefined && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                                • Vib: {evt.payload.vibration}g
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {evt.is_out_of_order === 1 && (
                              <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>Out-of-Order</span>
                            )}
                            <span className="mono" style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
                              {new Date(evt.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedDevice(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
