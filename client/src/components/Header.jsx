import React from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Radio,
  Sliders,
  Server,
  Play
} from 'lucide-react';

export default function Header({ activeTab, setActiveTab, connectionState, openIncidentsCount }) {
  const isConnected = connectionState === 'CONNECTED';
  const isReconnecting = connectionState === 'RECONNECTING';

  return (
    <header className="app-header">
      {/* Brand & Product Identity */}
      <div className="brand-section">
        <div className="brand-logo">
          <Activity size={17} color="#ffffff" strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="brand-title">
            SentinEdge
            <span className="brand-badge">Real-Time</span>
          </h1>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="nav-tabs">
        <button
          className={`nav-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <Cpu size={14} />
          Fleet Overview
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'events' ? 'active' : ''}`}
          onClick={() => setActiveTab('events')}
        >
          <Radio size={14} />
          Live Event Stream
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'incidents' ? 'active' : ''}`}
          onClick={() => setActiveTab('incidents')}
        >
          <AlertTriangle size={14} />
          Incidents
          {openIncidentsCount > 0 && (
            <span className="tab-incident-badge">
              {openIncidentsCount}
            </span>
          )}
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'rules' ? 'active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          <Sliders size={14} />
          Rule Engine
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'health' ? 'active' : ''}`}
          onClick={() => setActiveTab('health')}
        >
          <Server size={14} />
          Health & DLQ
        </button>

        <button
          className={`nav-tab-btn ${activeTab === 'simulator' ? 'active' : ''}`}
          onClick={() => setActiveTab('simulator')}
        >
          <Play size={14} color="#0284c7" />
          Device Simulator
        </button>
      </nav>

      {/* Connection & System Telemetry Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className={`status-pill ${
          isConnected ? 'connected' :
          isReconnecting ? 'reconnecting' : 'disconnected'
        }`}>
          <span className={`pulse-dot ${
            isConnected ? 'online' :
            isReconnecting ? 'warning' : 'offline'
          }`} />
          {isConnected ? 'STREAM: LIVE' :
           isReconnecting ? 'RECONNECTING...' : 'DISCONNECTED'}
        </div>
      </div>
    </header>
  );
}
