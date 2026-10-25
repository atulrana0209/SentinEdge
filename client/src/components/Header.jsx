import React from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Radio,
  Sliders,
  ShieldAlert,
  Server,
  Play
} from 'lucide-react';

export default function Header({ activeTab, setActiveTab, connectionState, openIncidentsCount }) {
  return (
    <header className="app-header">
      <div className="brand-section">
        <div className="brand-logo">
          <Activity size={20} color="#07090e" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="brand-title">
            MissionOps
            <span className="brand-badge">Real-Time</span>
          </h1>
        </div>
      </div>

      <nav className="nav-tabs">
        <button
          className={`nav-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Cpu size={16} />
          Fleet Overview
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          <Radio size={16} />
          Live Event Stream
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
        >
          <AlertTriangle size={16} />
          Incidents
          {openIncidentsCount > 0 && (
            <span className="badge badge-critical" style={{ marginLeft: 4, padding: '1px 6px' }}>
              {openIncidentsCount}
            </span>
          )}
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'rules' ? 'active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          <Sliders size={16} />
          Rule Engine
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'health' ? 'active' : ''}`}
          onClick={() => setActiveTab('health')}
        >
          <Server size={16} />
          Health & DLQ
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'simulator' ? 'active' : ''}`}
          onClick={() => setActiveTab('simulator')}
          style={{ border: '1px solid rgba(6, 182, 212, 0.4)' }}
        >
          <Play size={16} color="#06b6d4" />
          Device Simulator
        </button>
      </nav>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className={`connection-pill ${
          connectionState === 'CONNECTED' ? 'connected' :
          connectionState === 'RECONNECTING' ? 'reconnecting' : 'disconnected'
        }`}>
          <span className={`status-dot ${
            connectionState === 'CONNECTED' ? 'online' :
            connectionState === 'RECONNECTING' ? 'degraded' : 'offline'
          }`} />
          {connectionState === 'CONNECTED' ? 'STREAM: LIVE' :
           connectionState === 'RECONNECTING' ? 'RECONNECTING...' : 'DISCONNECTED'}
        </div>
      </div>
    </header>
  );
}
