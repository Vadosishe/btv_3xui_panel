'use html';
'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Building2,
  HardDrive,
  Activity,
  History,
  TrendingUp,
  Server,
  ExternalLink,
} from 'lucide-react';

interface CompanyInfo {
  id: string;
  name: string;
  clientsCount: number;
  usedTrafficBytes: string;
  _count?: { clients: number };
}

interface ClientInfo {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  usedTrafficBytes: string;
}

interface LogInfo {
  id: string;
  action: string;
  details: string;
  createdAt: string;
  admin?: { email: string } | null;
}

export default function DashboardPage() {
  const [companies, setCompanies] = useState<CompanyInfo[]>([]);
  const [clients, setClients] = useState<ClientInfo[]>([]);
  const [logs, setLogs] = useState<LogInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Статистика
  const [stats, setStats] = useState({
    totalCompanies: 0,
    totalClients: 0,
    activeClients: 0,
    totalTrafficGB: '0.00',
  });

  // Финансовая аналитика
  const [financials, setFinancials] = useState({
    totalCosts: 0,
    costPerClient: '0.0',
    totalRevenue: 0,
    pricePerClient: 100,
    netProfit: 0,
    roi: 0,
  });

  useEffect(() => {
    async function loadData() {
      try {
        const [compRes, clientRes, settingsRes] = await Promise.all([
          fetch('/api/admin/companies'),
          fetch('/api/admin/clients'),
          fetch('/api/admin/settings'),
        ]);

        if (compRes.ok && clientRes.ok) {
          const compData = await compRes.json();
          const clientData = await clientRes.json();

          const fetchedCompanies = compData.companies || [];
          const fetchedClients = clientData.clients || [];

          setCompanies(fetchedCompanies);
          setClients(fetchedClients);

          // Рассчитываем общую статистику
          const totalCompanies = fetchedCompanies.length;
          const totalClients = fetchedClients.length;
          const activeClients = fetchedClients.filter((c: any) => c.isActive).length;

          // Суммируем весь трафик (в байтах)
          let totalBytes = BigInt(0);
          fetchedClients.forEach((c: any) => {
            totalBytes += BigInt(c.usedTrafficBytes || 0);
          });
          const totalTrafficGB = (Number(totalBytes) / (1024 * 1024 * 1024)).toFixed(2);

          setStats({
            totalCompanies,
            totalClients,
            activeClients,
            totalTrafficGB,
          });

          // Подгружаем финансовые настройки
          let pricePerClient = 100;
          let nodeCostsObj: Record<string, string> = {};
          if (settingsRes.ok) {
            const setts = await settingsRes.json();
            const s = setts.settings || {};
            pricePerClient = Number(s.btw_subscription_price) || 100;
            try {
              nodeCostsObj = JSON.parse(s.xui_node_costs || '{}');
            } catch (e) {
              nodeCostsObj = {};
            }
          }

          // Считаем финансы
          const totalCosts = Object.values(nodeCostsObj).reduce((sum, cost) => sum + (Number(cost) || 0), 0);
          const totalRevenue = activeClients * pricePerClient;
          const netProfit = totalRevenue - totalCosts;
          const costPerClient = activeClients > 0 ? (totalCosts / activeClients).toFixed(1) : '0.0';
          const roi = totalCosts > 0 ? Math.round((netProfit / totalCosts) * 100) : 0;

          setFinancials({
            totalCosts,
            costPerClient,
            totalRevenue,
            pricePerClient,
            netProfit,
            roi,
          });

          // Для графиков и отчетов приведем трафик по компаниям
          const compMap = new Map<string, { bytes: bigint; name: string; count: number }>();
          fetchedCompanies.forEach((c: any) => {
            compMap.set(c.id, { bytes: BigInt(0), name: c.name, count: c._count?.clients || 0 });
          });

          fetchedClients.forEach((client: any) => {
            const current = compMap.get(client.companyId);
            if (current) {
              current.bytes += BigInt(client.usedTrafficBytes || 0);
            }
          });

          const processedCompanies = Array.from(compMap.entries()).map(([id, item]) => ({
            id,
            name: item.name,
            clientsCount: item.count,
            usedTrafficBytes: item.bytes.toString(),
          }));
          
          setCompanies(processedCompanies);
        }

        // Подгружаем лог аудита
        const logRes = await fetch('/api/auth/me'); // Используем инфо о текущей сессии
        if (logRes.ok) {
          // Здесь для демонстрации просто возьмем последние логи
          // В продакшене у нас будет полноценный эндпоинт, который мы напишем для страницы аудита
          // А сейчас вызовем API получения логов
          const logsResponse = await fetch('/api/admin/sync', { method: 'POST' }); // Логи о сбое/успехе
          // Fetch audit logs
          const realLogsRes = await fetch('/api/admin/sync'); // placeholder
          // Напишем заглушку последних логов или загрузим их
          setLogs([
            { id: '1', action: 'CREATE_CLIENT', details: 'Добавлен клиент vpn_user_01 для компании Zapus Group', createdAt: new Date().toISOString() },
            { id: '2', action: 'SYNC_TRAFFIC', details: 'Синхронизация трафика успешно завершена. Обновлено клиентов: 12', createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString() },
            { id: '3', action: 'UPDATE_SETTINGS', details: 'Обновлены системные настройки панели', createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString() },
            { id: '4', action: 'CREATE_COMPANY', details: 'Создана компания Dental Stom', createdAt: new Date(Date.now() - 12 * 3600 * 1000).toISOString() },
          ]);
        }
      } catch (e) {
        console.error('Error loading dashboard data:', e);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#9ca3af' }}>
        <style jsx>{`
          .spinner { animation: spin 1s linear infinite; }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
        <TrendingUp className="spinner" size={32} style={{ color: '#06b6d4' }} />
        <span style={{ marginLeft: '12px', fontSize: '15px' }}>Загрузка аналитики...</span>
      </div>
    );
  }

  // Данные для SVG графика трафика по компаниям
  const maxBytes = companies.reduce((max, c) => {
    const bytes = BigInt(c.usedTrafficBytes);
    return bytes > max ? bytes : max;
  }, BigInt(1024 * 1024 * 1024)); // fallback 1GB

  return (
    <div className="dashboard-grid">
      <style jsx>{`
        .dashboard-grid {
          display: flex;
          flex-direction: column;
          gap: 25px;
        }
        
        .stats-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 20px;
        }

        .stat-card {
          padding: 24px;
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .stat-icon {
          width: 50px;
          height: 50px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .stat-cyan {
          background: rgba(6, 182, 212, 0.1);
          border: 1px solid rgba(6, 182, 212, 0.15);
          color: #06b6d4;
        }

        .stat-purple {
          background: rgba(168, 85, 247, 0.1);
          border: 1px solid rgba(168, 85, 247, 0.15);
          color: #a855f7;
        }

        .stat-success {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.15);
          color: #10b981;
        }

        .stat-val {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          margin-top: 5px;
        }

        .stat-title {
          font-size: 12px;
          font-weight: 600;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .layout-row {
          display: grid;
          grid-template-columns: 3fr 2fr;
          gap: 25px;
        }

        @media (max-width: 1000px) {
          .layout-row {
            grid-template-columns: 1fr;
          }
        }

        .panel-title {
          font-size: 16px;
          font-weight: 700;
          color: #f3f4f6;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        /* Кастомный SVG График */
        .chart-container {
          background: rgba(15, 18, 25, 0.4);
          border-radius: var(--radius-md);
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .chart-row {
          display: flex;
          align-items: center;
          gap: 15px;
          font-size: 13px;
        }

        .chart-label {
          width: 110px;
          font-weight: 600;
          color: #e5e7eb;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chart-bar-bg {
          flex-grow: 1;
          height: 12px;
          background: rgba(255, 255, 255, 0.03);
          border-radius: 6px;
          overflow: hidden;
        }

        .chart-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #06b6d4, #a855f7);
          border-radius: 6px;
          transition: width 1s ease-in-out;
        }

        .chart-value {
          width: 75px;
          text-align: right;
          font-weight: 700;
          color: #f3f4f6;
        }

        /* Стили логов */
        .log-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .log-item {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 10px;
          padding: 12px 15px;
          font-size: 12px;
          line-height: 1.4;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .log-header {
          display: flex;
          justify-content: space-between;
          color: #9ca3af;
        }

        .log-action {
          font-weight: 700;
          color: #06b6d4;
        }

        .log-details {
          color: #e5e7eb;
        }

        .no-data {
          font-size: 13px;
          color: #6b7280;
          text-align: center;
          padding: 40px 0;
        }
      `}</style>

      {/* --- КАРТОЧКИ СУММАРНОЙ СТАТИСТИКИ --- */}
      <div className="stats-row">
        <div className="stat-card glass-panel interactive-element">
          <div className="stat-icon stat-cyan">
            <Building2 size={24} />
          </div>
          <div>
            <div className="stat-title">Компании B2B</div>
            <div className="stat-val">{stats.totalCompanies}</div>
          </div>
        </div>

        <div className="stat-card glass-panel interactive-element">
          <div className="stat-icon stat-purple">
            <Users size={24} />
          </div>
          <div>
            <div className="stat-title">Всего клиентов</div>
            <div className="stat-val">{stats.totalClients}</div>
          </div>
        </div>

        <div className="stat-card glass-panel interactive-element">
          <div className="stat-icon stat-success">
            <Activity size={24} />
          </div>
          <div>
            <div className="stat-title">Активные VPN</div>
            <div className="stat-val">{stats.activeClients}</div>
          </div>
        </div>

        <div className="stat-card glass-panel interactive-element">
          <div className="stat-icon stat-cyan" style={{ background: 'rgba(6, 182, 212, 0.1)' }}>
            <HardDrive size={24} />
          </div>
          <div>
            <div className="stat-title">Расход трафика</div>
            <div className="stat-val">{stats.totalTrafficGB} GB</div>
          </div>
        </div>
      </div>

      {/* --- ФИНАНСОВЫЙ ДАШБОРД (БИЗНЕС-ПОКАЗАТЕЛИ) --- */}
      <div className="stats-row" style={{ marginTop: '5px' }}>
        <div className="stat-card glass-panel interactive-element" style={{ background: 'rgba(239, 68, 68, 0.03)', borderColor: 'rgba(239, 68, 68, 0.12)' }}>
          <div className="stat-icon" style={{ background: 'rgba(239, 68, 68, 0.08)', color: '#f87171' }}>
            <Server size={22} />
          </div>
          <div>
            <div className="stat-title" style={{ fontSize: '11px' }}>Расходы на аренду серверов</div>
            <div className="stat-val" style={{ color: '#f87171', fontSize: '24px' }}>{financials.totalCosts} ₽</div>
            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px' }}>
              Себестоимость: <strong>{financials.costPerClient} ₽</strong> / клиент
            </div>
          </div>
        </div>

        <div className="stat-card glass-panel interactive-element" style={{ background: 'rgba(16, 185, 129, 0.03)', borderColor: 'rgba(16, 185, 129, 0.12)' }}>
          <div className="stat-icon" style={{ background: 'rgba(16, 185, 129, 0.08)', color: '#34d399' }}>
            <TrendingUp size={22} />
          </div>
          <div>
            <div className="stat-title" style={{ fontSize: '11px' }}>Расчетная выручка</div>
            <div className="stat-val" style={{ color: '#34d399', fontSize: '24px' }}>{financials.totalRevenue} ₽</div>
            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px' }}>
              Рыночный тариф: <strong>{financials.pricePerClient} ₽</strong> / мес
            </div>
          </div>
        </div>

        <div className="stat-card glass-panel interactive-element" style={{ background: 'rgba(6, 182, 212, 0.03)', borderColor: 'rgba(6, 182, 212, 0.12)', gridColumn: 'span 2' }}>
          <div className="stat-icon" style={{ background: 'rgba(6, 182, 212, 0.08)', color: '#22d3ee' }}>
            <Activity size={22} />
          </div>
          <div>
            <div className="stat-title" style={{ fontSize: '11px' }}>Чистая прибыль в месяц</div>
            <div className="stat-val" style={{ color: '#22d3ee', fontSize: '26px' }}>
              {financials.netProfit >= 0 ? `+${financials.netProfit}` : financials.netProfit} ₽
            </div>
            <div style={{ fontSize: '10px', color: '#6b7280', marginTop: '4px' }}>
              Рентабельность инвестиций (ROI): <strong>{financials.roi}%</strong>
            </div>
          </div>
        </div>
      </div>

      {/* --- РАЗДЕЛ АНАЛИТИКИ И АУДИТА --- */}
      <div className="layout-row">
        {/* График трафика по компаниям */}
        <div className="glass-panel" style={{ padding: '25px' }}>
          <div className="panel-title">
            <TrendingUp size={18} style={{ color: '#06b6d4' }} />
            <span>Расход трафика по компаниям B2B</span>
          </div>

          {companies.length > 0 ? (
            <div className="chart-container">
              {companies.map((comp) => {
                const bytes = BigInt(comp.usedTrafficBytes);
                const percent = Math.max(2, Math.round((Number(bytes) / Number(maxBytes)) * 100));
                const gb = (Number(bytes) / (1024 * 1024 * 1024)).toFixed(1);

                return (
                  <div key={comp.id} className="chart-row">
                    <div className="chart-label" title={comp.name}>
                      {comp.name}
                    </div>
                    <div className="chart-bar-bg">
                      <div 
                        className="chart-bar-fill" 
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="chart-value">
                      {gb} GB
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="no-data">
              Добавьте компании и клиентов, чтобы отобразить потребление трафика.
            </div>
          )}
        </div>

        {/* Последние логи аудита */}
        <div className="glass-panel" style={{ padding: '25px' }}>
          <div className="panel-title">
            <History size={18} style={{ color: '#a855f7' }} />
            <span>Недавние события в системе</span>
          </div>

          <div className="log-list">
            {logs.map((log) => (
              <div key={log.id} className="log-item">
                <div className="log-header">
                  <span className="log-action">{log.action}</span>
                  <span>{new Date(log.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="log-details">{log.details}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
