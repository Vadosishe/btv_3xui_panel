'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Database,
  RefreshCw,
  Server,
  Key,
  Layers,
  Search,
  Copy,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Shield,
  Activity,
  Download
} from 'lucide-react';

export default function DebugPage() {
  const [activeTab, setActiveTab] = useState<'sync' | 'db' | 'xui' | 'logs'>('sync');
  
  // Statuses
  const [xuiStatus, setXuiStatus] = useState<any>(null);
  const [dbStatus, setDbStatus] = useState<any>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  
  // States for sync
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<string[]>([]);
  const [syncResults, setSyncResults] = useState<any>(null);
  
  // States for DB query
  const [selectedTable, setSelectedTable] = useState('client');
  const [dbQueryLogs, setDbQueryLogs] = useState<any>(null);
  const [dbLimit, setDbLimit] = useState(25);
  const [dbSkip, setDbSkip] = useState(0);
  const [dbWhereInput, setDbWhereInput] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryError, setQueryError] = useState('');

  // States for XUI raw
  const [inbounds, setInbounds] = useState<any[]>([]);
  const [xuiSearch, setXuiSearch] = useState('');
  const [expandedInbounds, setExpandedInbounds] = useState<Record<number, boolean>>({});
  const [isFetchingXui, setIsFetchingXui] = useState(false);
  const [xuiError, setXuiError] = useState('');

  // States for Audit Logs
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);

  // Auto-scroll ref for terminal
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchStatus();
    fetchApiKey();
  }, []);

  useEffect(() => {
    if (activeTab === 'xui') {
      fetchXuiInbounds();
    } else if (activeTab === 'logs') {
      fetchAuditLogs();
    }
  }, [activeTab]);

  useEffect(() => {
    if (terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [syncLogs]);

  const fetchStatus = async () => {
    try {
      // Fetch 3XUI Status
      const xuiRes = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'xui_status' })
      });
      if (xuiRes.ok) {
        const data = await xuiRes.json();
        setXuiStatus(data);
      }

      // Fetch DB counts
      const dbRes = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'db_inspect' })
      });
      if (dbRes.ok) {
        const data = await dbRes.json();
        setDbStatus(data.counts);
      }
    } catch (e) {
      console.error('Failed to load debug status', e);
    }
  };

  const fetchApiKey = async () => {
    try {
      const res = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_api_key' })
      });
      if (res.ok) {
        const data = await res.json();
        setApiKey(data.apiKey);
      }
    } catch (e) {
      console.error('Failed to load API key', e);
    }
  };

  const [isDownloadingDump, setIsDownloadingDump] = useState(false);

  const downloadDiagnosticDump = async () => {
    if (isDownloadingDump) return;
    setIsDownloadingDump(true);
    try {
      const res = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'diagnostic_dump' })
      });
      if (res.ok) {
        const data = await res.json();
        const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
          JSON.stringify(data, null, 2)
        )}`;
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', jsonString);
        downloadAnchor.setAttribute('download', `vpn_panel_diag_dump_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
      } else {
        alert('Не удалось собрать отладочный дамп');
      }
    } catch (e: any) {
      alert(`Ошибка скачивания дампа: ${e.message}`);
    } finally {
      setIsDownloadingDump(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(apiKey);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // Run full verbose synchronization
  const triggerVerboseSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncResults(null);
    setSyncLogs(['[START] Connecting to diagnostic agent...', 'Triggering verbose synchronizer...']);
    
    try {
      const res = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_sync' })
      });
      const data = await res.json();
      
      if (data.logs) {
        setSyncLogs(data.logs);
      } else {
        setSyncLogs(prev => [...prev, '[ERROR] No logs returned from endpoint.']);
      }

      if (res.ok && data.success) {
        setSyncResults(data.results);
        // Refresh statuses
        fetchStatus();
      } else {
        setSyncLogs(prev => [...prev, `[FATAL] Error occurred: ${data.error || 'Unknown error'}`]);
      }
    } catch (err: any) {
      setSyncLogs(prev => [...prev, `[FATAL] Connection error: ${err.message}`]);
    } finally {
      setIsSyncing(false);
    }
  };

  // Query PostgreSQL database
  const executeDbQuery = async () => {
    setIsQuerying(true);
    setQueryError('');
    setDbQueryLogs(null);
    
    let whereObj = undefined;
    if (dbWhereInput.trim()) {
      try {
        whereObj = JSON.parse(dbWhereInput);
      } catch (e: any) {
        setQueryError(`Ошибка парсинга JSON для WHERE: ${e.message}`);
        setIsQuerying(false);
        return;
      }
    }

    try {
      const res = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'db_query',
          table: selectedTable,
          where: whereObj,
          take: Number(dbLimit),
          skip: Number(dbSkip)
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDbQueryLogs(data.records);
      } else {
        setQueryError(data.error || 'Ошибка выполнения запроса');
      }
    } catch (err: any) {
      setQueryError(`Ошибка подключения: ${err.message}`);
    } finally {
      setIsQuerying(false);
    }
  };

  // Fetch 3XUI inbounds list
  const fetchXuiInbounds = async () => {
    setIsFetchingXui(true);
    setXuiError('');
    try {
      const res = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'xui_inspect' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setInbounds(data.inbounds || []);
      } else {
        setXuiError(data.error || 'Не удалось получить inbounds');
      }
    } catch (e: any) {
      setXuiError(`Ошибка подключения: ${e.message}`);
    } finally {
      setIsFetchingXui(false);
    }
  };

  // Fetch Audit Logs
  const fetchAuditLogs = async () => {
    setIsFetchingLogs(true);
    try {
      const res = await fetch('/api/admin/debug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'system_logs', limit: 100 })
      });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs || []);
      }
    } catch (e) {
      console.error('Failed to load audit logs', e);
    } finally {
      setIsFetchingLogs(false);
    }
  };

  const toggleInbound = (id: number) => {
    setExpandedInbounds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Filter inbounds based on search query
  const filteredInbounds = inbounds.filter(inb => {
    if (!xuiSearch) return true;
    const query = xuiSearch.toLowerCase();
    
    // Check remark/protocol
    if (inb.remark?.toLowerCase().includes(query)) return true;
    if (inb.protocol?.toLowerCase().includes(query)) return true;

    // Check settings clients
    let settings: any = {};
    try {
      settings = typeof inb.settings === 'string' ? JSON.parse(inb.settings) : inb.settings || {};
    } catch(e) {}
    const clients = settings.clients || [];
    if (clients.some((c: any) => c.email?.toLowerCase().includes(query) || c.id?.toLowerCase().includes(query))) return true;

    // Check client stats
    const stats = inb.clientStats || [];
    if (stats.some((s: any) => s.email?.toLowerCase().includes(query))) return true;

    return false;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', color: '#f3f4f6' }}>
      
      {/* Dynamic Styling */}
      <style jsx>{`
        .debug-title {
          font-size: 24px;
          font-weight: 800;
          color: #fff;
          margin-bottom: 5px;
        }
        .debug-subtitle {
          font-size: 14px;
          color: var(--text-muted);
          margin-bottom: 20px;
        }
        .grid-status {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
          gap: 20px;
        }
        .card-stat {
          background: rgba(31, 41, 55, 0.4);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
          overflow: hidden;
        }
        .card-stat::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 3px;
          background: linear-gradient(90deg, #06b6d4, #a855f7);
          opacity: 0.8;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }
        .card-title {
          font-size: 12px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #9ca3af;
        }
        .status-indicator {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
          font-weight: 700;
        }
        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
        }
        .status-dot.online {
          background-color: #10b981;
          box-shadow: 0 0 8px #10b981;
        }
        .status-dot.offline {
          background-color: #ef4444;
          box-shadow: 0 0 8px #ef4444;
        }
        .code-snippet {
          font-family: monospace;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 11px;
          color: #a7f3d0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 10px;
          overflow-x: auto;
        }
        .copy-btn {
          background: none;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border-radius: 4px;
          transition: all 0.2s;
        }
        .copy-btn:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.08);
        }
        .tabs-header {
          display: flex;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          gap: 5px;
          margin-top: 15px;
        }
        .tab-btn {
          background: none;
          border: none;
          padding: 12px 20px;
          color: #9ca3af;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tab-btn:hover {
          color: #fff;
          background: rgba(255, 255, 255, 0.02);
        }
        .tab-btn.active {
          color: #06b6d4;
          border-bottom-color: #06b6d4;
          background: rgba(6, 182, 212, 0.04);
        }
        .tab-content {
          background: rgba(31, 41, 55, 0.25);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-top: none;
          border-radius: 0 0 12px 12px;
          padding: 25px;
          min-height: 400px;
        }
        .terminal {
          font-family: monospace;
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 15px;
          max-height: 450px;
          overflow-y: auto;
          font-size: 12px;
          line-height: 1.6;
          display: flex;
          flex-direction: column;
          gap: 4px;
          color: #34d399;
          margin-top: 20px;
        }
        .terminal-line {
          white-space: pre-wrap;
          word-break: break-all;
        }
        .terminal-line.error {
          color: #f87171;
        }
        .terminal-line.success {
          color: #60a5fa;
          font-weight: bold;
        }
        .terminal-line.info {
          color: #9ca3af;
        }
        .btn-action {
          background: linear-gradient(135deg, #06b6d4, #0891b2);
          color: #fff;
          border: none;
          padding: 10px 20px;
          border-radius: 8px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.2s;
        }
        .btn-action:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(6, 182, 212, 0.3);
        }
        .btn-action:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .table-select {
          background: #1f2937;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
          padding: 10px;
          border-radius: 8px;
          outline: none;
          font-size: 14px;
          cursor: pointer;
          width: 100%;
        }
        .db-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 20px;
        }
        .db-input {
          background: #1f2937;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
          padding: 10px;
          border-radius: 8px;
          outline: none;
          font-size: 14px;
          width: 100%;
        }
        .db-textarea {
          background: #1f2937;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #fff;
          padding: 10px;
          border-radius: 8px;
          outline: none;
          font-size: 12px;
          font-family: monospace;
          width: 100%;
          min-height: 80px;
          resize: vertical;
        }
        .json-viewer {
          font-family: monospace;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 15px;
          font-size: 12px;
          color: #f3f4f6;
          overflow-x: auto;
          max-height: 500px;
        }
        .xui-search-box {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }
        .inbounds-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .inbound-item {
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          background: rgba(31, 41, 55, 0.2);
          overflow: hidden;
          transition: all 0.2s;
        }
        .inbound-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 18px;
          cursor: pointer;
          user-select: none;
        }
        .inbound-header:hover {
          background: rgba(255, 255, 255, 0.02);
        }
        .inbound-body {
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          padding: 18px;
          background: rgba(0, 0, 0, 0.25);
        }
        .badge {
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }
        .badge.cyan {
          background: rgba(6, 182, 212, 0.15);
          color: #22d3ee;
          border: 1px solid rgba(6, 182, 212, 0.3);
        }
        .badge.purple {
          background: rgba(168, 85, 247, 0.15);
          color: #c084fc;
          border: 1px solid rgba(168, 85, 247, 0.3);
        }
        .badge.green {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(16, 185, 129, 0.3);
        }
        .badge.red {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .logs-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .logs-table th {
          text-align: left;
          padding: 10px 15px;
          border-bottom: 2px solid rgba(255, 255, 255, 0.08);
          color: #9ca3af;
          font-weight: 600;
        }
        .logs-table td {
          padding: 12px 15px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .logs-table tr:hover {
          background: rgba(255, 255, 255, 0.01);
        }
      `}</style>

      {/* Title */}
      <div>
        <h2 className="debug-title">Диагностика и отладка</h2>
        <p className="debug-subtitle">
          Панель интерактивного мониторинга базы данных PostgreSQL и Xray (3X-UI) API.
        </p>
      </div>

      {/* Top Cards Grid */}
      <div className="grid-status">
        
        {/* Card: 3XUI Server Status */}
        <div className="card-stat">
          <div>
            <div className="card-header">
              <span className="card-title">Связь с панелью 3XUI</span>
              <Server size={18} style={{ color: '#06b6d4' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div className="status-indicator">
                <span className={`status-dot ${xuiStatus?.pingSuccess ? 'online' : 'offline'}`} />
                <span>{xuiStatus?.pingSuccess ? 'СВЯЗЬ УСТАНОВЛЕНА' : 'ОТКЛЮЧЕНО / ОШИБКА'}</span>
              </div>
              <span style={{ fontSize: '11px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                URL: {xuiStatus?.xuiConfiguredUrl || 'Загрузка...'}
              </span>
              {xuiStatus?.pingError && (
                <div style={{ color: '#ef4444', fontSize: '11px', background: 'rgba(239, 68, 68, 0.08)', padding: '6px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.15)' }}>
                  Error: {xuiStatus.pingError}
                </div>
              )}
            </div>
          </div>
          <div style={{ marginTop: '15px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af' }}>
            <span>Инбаундов (входящих):</span>
            <span style={{ fontWeight: 'bold', color: '#fff' }}>{xuiStatus?.inboundCount ?? '-'}</span>
          </div>
        </div>

        {/* Card: PostgreSQL DB Status */}
        <div className="card-stat">
          <div>
            <div className="card-header">
              <span className="card-title">База данных PostgreSQL</span>
              <Database size={18} style={{ color: '#a855f7' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 15px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9ca3af' }}>Клиенты:</span>
                <span style={{ fontWeight: 'bold' }}>{dbStatus?.client ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9ca3af' }}>Компании:</span>
                <span style={{ fontWeight: 'bold' }}>{dbStatus?.company ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9ca3af' }}>Шаблоны:</span>
                <span style={{ fontWeight: 'bold' }}>{dbStatus?.template ?? 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9ca3af' }}>Заявки:</span>
                <span style={{ fontWeight: 'bold' }}>{dbStatus?.vpnRequest ?? 0}</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: '15px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#9ca3af' }}>
            <span>Всего записей аудита:</span>
            <span style={{ fontWeight: 'bold', color: '#fff' }}>{dbStatus?.auditLog ?? 0}</span>
          </div>
        </div>

        {/* Card: AI Agent and CLI Access */}
        <div className="card-stat">
          <div>
            <div className="card-header">
              <span className="card-title">Доступ AI / curl</span>
              <Key size={18} style={{ color: '#10b981' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px', color: '#9ca3af' }}>Ключ API диагностики:</span>
                <button className="copy-btn" onClick={() => setShowApiKey(!showApiKey)} title="Показать/скрыть">
                  {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '3px' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  readOnly
                  value={apiKey || 'Загрузка...'}
                  style={{
                    background: 'rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    color: '#10b981',
                    flexGrow: 1,
                    outline: 'none'
                  }}
                />
                <button className="copy-btn" onClick={copyToClipboard} disabled={!apiKey} title="Копировать">
                  {isCopied ? <CheckCircle size={15} style={{ color: '#10b981' }} /> : <Copy size={15} />}
                </button>
              </div>

              {/* Кнопка скачивания диагностического дампа */}
              <button
                onClick={downloadDiagnosticDump}
                disabled={isDownloadingDump}
                style={{
                  marginTop: '10px',
                  background: 'rgba(6, 182, 212, 0.1)',
                  border: '1px solid rgba(6, 182, 212, 0.25)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: '#06b6d4',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isDownloadingDump ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  transition: 'all 0.2s'
                }}
              >
                <Download size={14} className={isDownloadingDump ? 'spinner' : ''} style={{ animation: isDownloadingDump ? 'spin 1s linear infinite' : 'none' }} />
                <span>{isDownloadingDump ? 'Сбор дампа...' : 'Скачать отладочный дамп (JSON)'}</span>
              </button>
            </div>
          </div>
          <div className="code-snippet">
            <span>curl -H "x-api-key: {apiKey ? (showApiKey ? apiKey : '•••') : 'API_KEY'}" -X POST -d '&#123;"action":"diagnostic_dump"&#125;' /api/admin/debug</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div className="tabs-header">
          <button
            className={`tab-btn ${activeTab === 'sync' ? 'active' : ''}`}
            onClick={() => setActiveTab('sync')}
          >
            <Activity size={16} />
            <span>Синхронизация трафика</span>
          </button>
          
          <button
            className={`tab-btn ${activeTab === 'db' ? 'active' : ''}`}
            onClick={() => setActiveTab('db')}
          >
            <Database size={16} />
            <span>Инспектор Базы Данных</span>
          </button>

          <button
            className={`tab-btn ${activeTab === 'xui' ? 'active' : ''}`}
            onClick={() => setActiveTab('xui')}
          >
            <Layers size={16} />
            <span>Сырые данные 3XUI</span>
          </button>

          <button
            className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            <Terminal size={16} />
            <span>Логи аудита</span>
          </button>
        </div>

        <div className="tab-content">
          
          {/* TAB: Sync Diagnostics */}
          {activeTab === 'sync' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '5px' }}>Вербальный логгер синхронизации</h3>
                  <p style={{ fontSize: '13px', color: '#9ca3af' }}>
                    Запускает пошаговую синхронизацию клиентов из 3XUI в БД Postgres с выводом подробных отладочных шагов в режиме реального времени.
                  </p>
                </div>
                <button
                  className="btn-action"
                  onClick={triggerVerboseSync}
                  disabled={isSyncing}
                >
                  <RefreshCw size={16} className={isSyncing ? 'spinner' : ''} style={{ animation: isSyncing ? 'spin 1s linear infinite' : 'none' }} />
                  <span>{isSyncing ? 'Синхронизация...' : 'Запустить диагностику sync'}</span>
                </button>
              </div>

              {/* Status Results Box */}
              {syncResults && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginBottom: '15px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', padding: '15px', borderRadius: '8px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>Обновлено клиентов</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#34d399' }}>{syncResults.syncCount}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>Импортировано новых</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#60a5fa' }}>{syncResults.importCount}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>Деактивировано в БД</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b' }}>{syncResults.deactivateCount}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', color: '#9ca3af' }}>Ошибок обработки</div>
                    <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f87171' }}>{syncResults.failedCount}</div>
                  </div>
                </div>
              )}

              {/* Console window */}
              <div className="terminal">
                {syncLogs.length === 0 ? (
                  <div className="terminal-line info">Нажмите "Запустить диагностику sync", чтобы начать опрос серверов.</div>
                ) : (
                  syncLogs.map((line, idx) => {
                    let className = 'terminal-line';
                    if (line.includes('[ERROR]')) className += ' error';
                    else if (line.includes('[FATAL]')) className += ' error';
                    else if (line.includes('[SUCCESS]')) className += ' success';
                    else if (line.includes('[START]')) className += ' info';
                    
                    return (
                      <div key={idx} className={className}>
                        {line}
                      </div>
                    );
                  })
                )}
                <div ref={terminalEndRef} />
              </div>
            </div>
          )}

          {/* TAB: Database Explorer */}
          {activeTab === 'db' && (
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '5px' }}>Выполнение SQL/Prisma запросов (Только чтение)</h3>
              <p style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '20px' }}>
                Безопасный интерфейс для инспектирования записей в таблицах базы данных VPN-панели.
              </p>

              <div className="db-form-grid">
                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>Выбор таблицы</label>
                  <select
                    className="table-select"
                    value={selectedTable}
                    onChange={(e) => setSelectedTable(e.target.value)}
                  >
                    <option value="client">Client (Клиенты / Сотрудники)</option>
                    <option value="company">Company (B2B Компании)</option>
                    <option value="template">Template (Шаблоны / Тарифы)</option>
                    <option value="auditLog">AuditLog (Логи Действий)</option>
                    <option value="vpnRequest">VpnRequest (Заявки клиентов)</option>
                    <option value="appSetting">AppSetting (Настройки URL/Токены)</option>
                    <option value="admin">Admin (Администраторы)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>Лимит записей (Take)</label>
                  <input
                    type="number"
                    className="db-input"
                    value={dbLimit}
                    onChange={(e) => setDbLimit(Number(e.target.value))}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>Пропуск записей (Skip)</label>
                  <input
                    type="number"
                    className="db-input"
                    value={dbSkip}
                    onChange={(e) => setDbSkip(Number(e.target.value))}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', color: '#9ca3af', marginBottom: '6px' }}>Фильтр WHERE (JSON, Опционально)</label>
                <textarea
                  className="db-textarea"
                  placeholder='Например: { "email": "test@btw.vpn" } или { "isActive": true }'
                  value={dbWhereInput}
                  onChange={(e) => setDbWhereInput(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '20px' }}>
                <button
                  className="btn-action"
                  onClick={executeDbQuery}
                  disabled={isQuerying}
                >
                  <Database size={16} />
                  <span>{isQuerying ? 'Выполнение запроса...' : 'Запросить данные'}</span>
                </button>
                {queryError && (
                  <div style={{ color: '#ef4444', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertCircle size={16} />
                    <span>{queryError}</span>
                  </div>
                )}
              </div>

              {dbQueryLogs && (
                <div>
                  <h4 style={{ fontSize: '13px', fontWeight: 600, color: '#9ca3af', marginBottom: '8px' }}>Результат ({dbQueryLogs.length} записей):</h4>
                  <pre className="json-viewer">
                    {JSON.stringify(dbQueryLogs, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB: 3XUI Inbounds Explorer */}
          {activeTab === 'xui' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '5px' }}>Структура инбаундов и клиентов 3XUI</h3>
                  <p style={{ fontSize: '13px', color: '#9ca3af' }}>
                    Отображает сырой ответ сервера 3XUI по входящим подключениям (inbounds), включая списки клиентов в настройках (`settings.clients`) и статистику (`clientStats`).
                  </p>
                </div>
                <button
                  className="btn-action"
                  onClick={fetchXuiInbounds}
                  disabled={isFetchingXui}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                >
                  <RefreshCw size={14} className={isFetchingXui ? 'spinner' : ''} style={{ animation: isFetchingXui ? 'spin 1s linear infinite' : 'none' }} />
                  <span>Обновить данные</span>
                </button>
              </div>

              <div className="xui-search-box">
                <input
                  type="text"
                  className="db-input"
                  placeholder="Поиск по remark, email клиента, UUID..."
                  value={xuiSearch}
                  onChange={(e) => setXuiSearch(e.target.value)}
                  style={{ flexGrow: 1 }}
                />
              </div>

              {xuiError && (
                <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.08)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.15)', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={18} />
                  <span>{xuiError}</span>
                </div>
              )}

              {isFetchingXui ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '50px', color: '#9ca3af' }}>
                  <RefreshCw className="spinner" style={{ animation: 'spin 1s linear infinite', marginRight: '8px' }} />
                  <span>Загрузка данных с сервера 3XUI...</span>
                </div>
              ) : (
                <div className="inbounds-list">
                  {filteredInbounds.length === 0 ? (
                    <div style={{ padding: '30px', textAlign: 'center', color: '#9ca3af', border: '1px dashed rgba(255,255,255,0.06)', borderRadius: '8px' }}>
                      Ничего не найдено
                    </div>
                  ) : (
                    filteredInbounds.map((inb) => {
                      let settings: any = {};
                      try {
                        settings = typeof inb.settings === 'string' ? JSON.parse(inb.settings) : inb.settings || {};
                      } catch(e) {}

                      const clientsCount = settings.clients?.length || 0;
                      const statsCount = inb.clientStats?.length || 0;
                      const isExpanded = expandedInbounds[inb.id] || false;

                      return (
                        <div key={inb.id} className="inbound-item">
                          <div className="inbound-header" onClick={() => toggleInbound(inb.id)}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                              <span style={{ fontWeight: 700, color: '#fff' }}>[{inb.id}] {inb.remark || 'Без Remark'}</span>
                              <span className="badge cyan">{inb.protocol}</span>
                              <span style={{ fontSize: '13px', color: '#9ca3af' }}>Порт: {inb.port}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                              <span className="badge purple">{clientsCount} в настройках</span>
                              <span className="badge green">{statsCount} с трафиком</span>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="inbound-body">
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '15px' }}>
                                <div>
                                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#a855f7', marginBottom: '10px' }}>Клиенты в настройках (settings.clients)</h4>
                                  <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                    {settings.clients?.length > 0 ? (
                                      settings.clients.map((c: any, i: number) => (
                                        <div key={i} style={{ fontSize: '12px', padding: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ color: '#fff', fontWeight: 600 }}>{c.email}</span>
                                          <span style={{ color: '#9ca3af', fontFamily: 'monospace' }}>{(c.id || c.password || '').slice(0, 15)}...</span>
                                        </div>
                                      ))
                                    ) : (
                                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>Клиенты отсутствуют</span>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#10b981', marginBottom: '10px' }}>Статистика трафика (clientStats)</h4>
                                  <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: '10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                    {inb.clientStats?.length > 0 ? (
                                      inb.clientStats.map((s: any, i: number) => (
                                        <div key={i} style={{ fontSize: '12px', padding: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', justifyContent: 'space-between' }}>
                                          <span style={{ color: '#fff', fontWeight: 600 }}>{s.email}</span>
                                          <span style={{ color: '#34d399' }}>{Math.round((s.up + s.down) / (1024 * 1024))} МБ</span>
                                        </div>
                                      ))
                                    ) : (
                                      <span style={{ fontSize: '12px', color: '#9ca3af' }}>Статистика отсутствует</span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div>
                                <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#9ca3af', marginBottom: '8px' }}>Сырой JSON инбаунда:</h4>
                                <pre className="json-viewer" style={{ fontSize: '11px', maxHeight: '250px' }}>
                                  {JSON.stringify(inb, null, 2)}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB: Audit Logs */}
          {activeTab === 'logs' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#fff', marginBottom: '5px' }}>Логи аудита действий</h3>
                  <p style={{ fontSize: '13px', color: '#9ca3af' }}>
                    Последние 100 событий безопасности и действий администраторов в системе.
                  </p>
                </div>
                <button
                  className="btn-action"
                  onClick={fetchAuditLogs}
                  disabled={isFetchingLogs}
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                >
                  <RefreshCw size={14} className={isFetchingLogs ? 'spinner' : ''} style={{ animation: isFetchingLogs ? 'spin 1s linear infinite' : 'none' }} />
                  <span>Обновить логи</span>
                </button>
              </div>

              {isFetchingLogs ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '50px', color: '#9ca3af' }}>
                  <RefreshCw className="spinner" style={{ animation: 'spin 1s linear infinite', marginRight: '8px' }} />
                  <span>Чтение логов...</span>
                </div>
              ) : (
                <div style={{ overflowX: 'auto', background: 'rgba(0,0,0,0.15)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <table className="logs-table">
                    <thead>
                      <tr>
                        <th style={{ width: '180px' }}>Время</th>
                        <th style={{ width: '150px' }}>Действие</th>
                        <th>Детализация</th>
                        <th style={{ width: '220px' }}>Администратор</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={4} style={{ textAlign: 'center', color: '#9ca3af', padding: '30px' }}>Логи отсутствуют</td>
                        </tr>
                      ) : (
                        auditLogs.map((log) => {
                          let actionColor = '#9ca3af';
                          if (log.action === 'SYNC_TRAFFIC') actionColor = '#06b6d4';
                          else if (log.action?.includes('CREATE')) actionColor = '#10b981';
                          else if (log.action?.includes('DELETE')) actionColor = '#ef4444';
                          else if (log.action?.includes('UPDATE') || log.action?.includes('DISABLE')) actionColor = '#f59e0b';

                          return (
                            <tr key={log.id}>
                              <td style={{ color: '#9ca3af', fontFamily: 'monospace' }}>
                                {new Date(log.createdAt).toLocaleString('ru-RU')}
                              </td>
                              <td>
                                <span className="badge" style={{ background: 'rgba(255,255,255,0.04)', color: actionColor, border: `1px solid ${actionColor}44` }}>
                                  {log.action}
                                </span>
                              </td>
                              <td style={{ color: '#e5e7eb', wordBreak: 'break-word' }}>{log.details}</td>
                              <td style={{ color: '#9ca3af' }}>
                                {log.admin ? (
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontWeight: 600, color: '#e5e7eb' }}>{log.admin.name || 'Admin'}</span>
                                    <span style={{ fontSize: '11px' }}>{log.admin.email}</span>
                                  </div>
                                ) : (
                                  <span style={{ fontStyle: 'italic', color: '#6b7280' }}>Система (Авто)</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
      
    </div>
  );
}
