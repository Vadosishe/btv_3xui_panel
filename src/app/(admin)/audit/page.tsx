'use html';
'use client';

import React, { useState, useEffect } from 'react';
import {
  History,
  Shield,
  Search,
  Filter,
  User,
  Clock,
  Loader,
} from 'lucide-react';

interface AuditLog {
  id: string;
  action: string;
  details: string;
  createdAt: string;
  adminId: string | null;
  admin: { name: string | null; email: string } | null;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterAction, setFilterAction] = useState('');

  useEffect(() => {
    async function loadLogs() {
      try {
        const res = await fetch('/api/admin/logs');
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs || []);
        }
      } catch (e) {
        console.error('Failed to load audit logs:', e);
      } finally {
        setIsLoading(false);
      }
    }

    loadLogs();
  }, []);

  // Доступные действия для фильтрации
  const uniqueActions = Array.from(new Set(logs.map(l => l.action)));

  // Фильтр
  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.details.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (log.admin?.email.toLowerCase().includes(searchQuery.toLowerCase()) || '') ||
                          (log.admin?.name?.toLowerCase().includes(searchQuery.toLowerCase()) || '');
    
    const matchesAction = filterAction === '' || log.action === filterAction;
    return matchesSearch && matchesAction;
  });

  // Получить красивую окраску для бейджа действия
  const getActionBadgeClass = (action: string) => {
    switch (action) {
      case 'CREATE_CLIENT': return 'badge-create';
      case 'DELETE_CLIENT': return 'badge-delete';
      case 'UPDATE_CLIENT': return 'badge-update';
      case 'CREATE_COMPANY': return 'badge-create';
      case 'DELETE_COMPANY': return 'badge-delete';
      case 'UPDATE_COMPANY': return 'badge-update';
      case 'SYNC_TRAFFIC': return 'badge-sync';
      case 'EXPORT_BACKUP': return 'badge-backup';
      case 'AUTO_SEED_ADMIN': return 'badge-seed';
      default: return 'badge-default';
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'CREATE_CLIENT': return 'Создан клиент';
      case 'DELETE_CLIENT': return 'Удален клиент';
      case 'UPDATE_CLIENT': return 'Обновлен клиент';
      case 'CREATE_COMPANY': return 'Создана компания';
      case 'DELETE_COMPANY': return 'Удалена компания';
      case 'UPDATE_COMPANY': return 'Обновлена компания';
      case 'SYNC_TRAFFIC': return 'Синхронизация';
      case 'EXPORT_BACKUP': return 'Бэкап экспортирован';
      case 'UPDATE_SETTINGS': return 'Настройки сохранены';
      case 'ADMIN_LOGIN': return 'Вход в панель';
      case 'AUTO_SEED_ADMIN': return 'Авто-сидинг';
      default: return action;
    }
  };

  return (
    <div className="audit-container">
      
      {/* --- СТИЛИ СТРАНИЦЫ --- */}
      <style jsx>{`
        .audit-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .filter-bar {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          align-items: center;
          flex-wrap: wrap;
        }

        .filters-left {
          display: flex;
          gap: 12px;
          flex-grow: 1;
          max-width: 700px;
          flex-wrap: wrap;
        }

        .search-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          min-width: 240px;
          flex-grow: 1;
        }

        .search-icon {
          position: absolute;
          left: 15px;
          color: #6b7280;
        }

        .search-input {
          width: 100%;
          background: rgba(15, 18, 25, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          padding: 10px 15px 10px 45px;
          color: #fff;
          font-size: 14px;
          transition: all 0.2s;
        }

        .search-input:focus {
          border-color: #06b6d4;
        }

        .filter-select {
          background: rgba(15, 18, 25, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 10px;
          padding: 10px 15px;
          color: #e5e7eb;
          font-size: 13px;
          min-width: 180px;
          cursor: pointer;
        }

        /* Таблица логов */
        .logs-panel {
          padding: 24px;
        }

        .logs-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13px;
        }

        .logs-table th {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          color: #9ca3af;
          font-weight: 600;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.5px;
        }

        .logs-table td {
          padding: 16px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
          color: #e5e7eb;
          vertical-align: middle;
        }

        .logs-table tr:hover {
          background: rgba(255, 255, 255, 0.01);
        }

        /* Бейджи действий */
        .action-badge {
          display: inline-block;
          font-size: 10px;
          font-weight: 700;
          padding: 4px 8px;
          border-radius: 6px;
          text-transform: uppercase;
        }

        :global(.badge-create) {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: #34d399;
        }

        :global(.badge-delete) {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #f87171;
        }

        :global(.badge-update) {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.2);
          color: #fbbf24;
        }

        :global(.badge-sync) {
          background: rgba(6, 182, 212, 0.1);
          border: 1px solid rgba(6, 182, 212, 0.2);
          color: #22d3ee;
        }

        :global(.badge-backup) {
          background: rgba(168, 85, 247, 0.1);
          border: 1px solid rgba(168, 85, 247, 0.2);
          color: #c084fc;
        }

        :global(.badge-seed) {
          background: rgba(236, 72, 153, 0.1);
          border: 1px solid rgba(236, 72, 153, 0.2);
          color: #f472b6;
        }

        :global(.badge-default) {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          color: #9ca3af;
        }

        .admin-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .admin-avatar {
          width: 24px;
          height: 24px;
          background: rgba(255,255,255,0.06);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #9ca3af;
        }

        .admin-email {
          color: #6b7280;
          font-size: 11px;
          margin-top: 2px;
        }

        .log-date {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #9ca3af;
        }

        .no-logs {
          padding: 60px 0;
          text-align: center;
          color: #6b7280;
        }

        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Панель фильтрации */}
      <div className="filter-bar">
        <div className="filters-left">
          <div className="search-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Поиск по описанию или администратору..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select 
            className="filter-select" 
            value={filterAction} 
            onChange={(e) => setFilterAction(e.target.value)}
          >
            <option value="">Все типы действий</option>
            {uniqueActions.map(act => (
              <option key={act} value={act}>{getActionLabel(act)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Таблица логов */}
      <div className="logs-panel glass-panel">
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: '#9ca3af' }}>
            <Loader className="spinner" size={24} style={{ color: '#06b6d4' }} />
            <span style={{ marginLeft: '10px' }}>Загрузка логов аудита...</span>
          </div>
        ) : filteredLogs.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="logs-table">
              <thead>
                <tr>
                  <th style={{ width: '150px' }}>Действие</th>
                  <th>Детали события</th>
                  <th style={{ width: '220px' }}>Администратор</th>
                  <th style={{ width: '180px' }}>Дата и время</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const badgeClass = getActionBadgeClass(log.action);
                  return (
                    <tr key={log.id}>
                      <td>
                        <span className={`action-badge ${badgeClass}`}>
                          {getActionLabel(log.action)}
                        </span>
                      </td>
                      <td className="log-details" style={{ fontWeight: '500' }}>
                        {log.details}
                      </td>
                      <td>
                        <div className="admin-info">
                          <div className="admin-avatar">
                            <User size={12} />
                          </div>
                          <div>
                            <div style={{ fontWeight: '600' }}>{log.admin?.name || 'Система'}</div>
                            {log.admin && <div className="admin-email">{log.admin.email}</div>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="log-date">
                          <Clock size={12} />
                          <span>
                            {new Date(log.createdAt).toLocaleString('ru-RU', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit'
                            })}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="no-logs">
            Логи аудита пустые или ничего не найдено по фильтрам.
          </div>
        )}
      </div>

    </div>
  );
}
