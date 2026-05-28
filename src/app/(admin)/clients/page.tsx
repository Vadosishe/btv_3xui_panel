'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  Key,
  Search,
  Building2,
  Sliders,
  CheckCircle,
  XCircle,
  HardDrive,
  Clock,
  AlertTriangle,
  Loader,
  Copy,
  ExternalLink,
  QrCode,
  Grid,
  List,
} from 'lucide-react';

interface Company {
  id: string;
  name: string;
}

interface Template {
  id: string;
  name: string;
  trafficLimitGB: number;
  limitIp: number;
  durationDays: number;
}

interface Client {
  id: string;
  name: string;
  email: string;
  vpnUuid: string;
  subscriptionToken: string;
  isActive: boolean;
  trafficLimitGB: number | null;
  limitIp: number | null;
  expiresAt: string | null;
  flow: string | null;
  tgId: string | null;
  isOnline?: boolean;
  nodes?: string[];
  usedTrafficBytes: string;
  lastSyncedAt: string | null;
  companyId: string;
  templateId: string;
  company: { name: string };
  template: { name: string; trafficLimitGB: number; limitIp: number; durationDays: number; flow?: string };
  createdAt: string;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Состояние поиска и фильтрации
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterTemplate, setFilterTemplate] = useState('');
  const [filterStatus, setFilterStatus] = useState(''); // '', 'active', 'inactive'
  const [sortBy, setSortBy] = useState('name'); // 'name', 'traffic', 'expiry', 'status'
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Форма добавления/редактирования
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [templateId, setTemplateId] = useState('');
  
  // Кастомные переопределения
  const [hasCustomLimits, setHasCustomLimits] = useState(false);
  const [customTrafficLimitGB, setCustomTrafficLimitGB] = useState<number | ''>('');
  const [customLimitIp, setCustomLimitIp] = useState<number | ''>('');
  const [customExpiresAt, setCustomExpiresAt] = useState('');
  const [customFlow, setCustomFlow] = useState('');
  const [customTgId, setCustomTgId] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Модалка просмотра ключей
  const [isKeysModalOpen, setIsKeysModalOpen] = useState(false);
  const [selectedClientKeys, setSelectedClientKeys] = useState<{
    client: Client;
    subscriptionUrl: string;
    qrCodeDataUrl: string;
    configLinks: string[];
  } | null>(null);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);

  // Подгрузка данных
  const loadData = async () => {
    try {
      const [cliRes, compRes, tplRes] = await Promise.all([
        fetch('/api/admin/clients'),
        fetch('/api/admin/companies'),
        fetch('/api/admin/templates'),
      ]);

      if (cliRes.ok && compRes.ok && tplRes.ok) {
        const cliData = await cliRes.json();
        const compData = await compRes.json();
        const tplData = await tplRes.json();

        setClients(cliData.clients || []);
        // Показываем в выпадающих списках только активные компании
        setCompanies(compData.companies?.filter((c: any) => c.isActive) || []);
        setTemplates(tplData.templates || []);
      }
    } catch (e) {
      console.error('Failed to load data:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const savedViewMode = localStorage.getItem('clients_view_mode') as 'grid' | 'list' | null;
    if (savedViewMode) {
      setViewMode(savedViewMode);
    }
  }, []);

  const changeViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('clients_view_mode', mode);
  };

  const openAddModal = () => {
    setEditingId(null);
    setName('');
    setCompanyId(companies[0]?.id || '');
    setTemplateId(templates[0]?.id || '');
    setHasCustomLimits(false);
    setCustomTrafficLimitGB('');
    setCustomLimitIp('');
    setCustomExpiresAt('');
    setCustomFlow('');
    setCustomTgId('');
    setIsActive(true);
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setEditingId(client.id);
    setName(client.name);
    setCompanyId(client.companyId);
    setTemplateId(client.templateId);
    
    const isCustom = client.trafficLimitGB !== null || client.limitIp !== null || client.expiresAt !== null || client.flow !== null || client.tgId !== null;
    setHasCustomLimits(isCustom);
    setCustomTrafficLimitGB(client.trafficLimitGB !== null ? client.trafficLimitGB : '');
    setCustomLimitIp(client.limitIp !== null ? client.limitIp : '');
    setCustomExpiresAt(client.expiresAt ? client.expiresAt.substring(0, 10) : '');
    setCustomFlow(client.flow !== null ? client.flow : '');
    setCustomTgId(client.tgId !== null ? client.tgId : '');
    setIsActive(client.isActive);
    setError(null);
    setIsModalOpen(true);
  };

  // Просмотр VPN-ключей и QR-кода
  const openKeysModal = async (client: Client) => {
    setIsLoadingKeys(true);
    setIsKeysModalOpen(true);
    setSelectedClientKeys(null);
    try {
      const res = await fetch(`/api/admin/clients/${client.id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedClientKeys({
          client: client,
          subscriptionUrl: data.subscriptionUrl,
          qrCodeDataUrl: data.qrCodeDataUrl,
          configLinks: data.configLinks || [],
        });
      } else {
        alert('Не удалось загрузить VPN-конфигурации');
        setIsKeysModalOpen(false);
      }
    } catch (e) {
      alert('Ошибка при соединении с сервером');
      setIsKeysModalOpen(false);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // Сохранить изменения
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError(null);

    const url = editingId ? `/api/admin/clients/${editingId}` : '/api/admin/clients';
    const method = editingId ? 'PUT' : 'POST';

    const payload = {
      name,
      companyId,
      templateId,
      customTrafficLimitGB: hasCustomLimits && customTrafficLimitGB !== '' ? Number(customTrafficLimitGB) : null,
      customLimitIp: hasCustomLimits && customLimitIp !== '' ? Number(customLimitIp) : null,
      customExpiresAt: hasCustomLimits && customExpiresAt ? new Date(customExpiresAt).toISOString() : null,
      customFlow: hasCustomLimits && customFlow !== '' ? customFlow : null,
      customTgId: hasCustomLimits && customTgId !== '' ? customTgId : null,
      isActive,
    };

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setIsModalOpen(false);
        loadData();
      } else {
        setError(data.error || 'Ошибка при сохранении');
      }
    } catch (err) {
      setError('Ошибка сети. Проверьте соединение.');
    } finally {
      setIsSaving(false);
    }
  };

  // Удаление клиента
  const handleDelete = async (id: string, clientName: string) => {
    const confirmed = window.confirm(`Вы действительно хотите удалить клиента "${clientName}"?\nЭто удалит все его VPN подключения на серверах 3XUI!`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/admin/clients/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка при удалении');
      }
    } catch (e) {
      alert('Ошибка подключения к серверу.');
    }
  };

  // Копирование в буфер с fallback для HTTP
  const copyToClipboard = (text: string, msg: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => alert(msg))
        .catch(() => fallbackCopy(text, msg));
    } else {
      fallbackCopy(text, msg);
    }
  };

  const fallbackCopy = (text: string, msg: string) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.top = "0";
    textArea.style.left = "0";
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        alert(msg);
      } else {
        alert('Не удалось скопировать автоматически. Пожалуйста, скопируйте вручную.');
      }
    } catch (err) {
      alert('Ошибка при копировании. Пожалуйста, скопируйте вручную.');
    }
    document.body.removeChild(textArea);
  };

  // Фильтр и сортировка списка сотрудников
  const filteredClients = clients
    .filter(c => {
      const matchesSearch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            c.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesCompany = filterCompany === '' || c.companyId === filterCompany;
      const matchesTemplate = filterTemplate === '' || c.templateId === filterTemplate;
      
      const matchesStatus = filterStatus === '' || 
        (filterStatus === 'active' && c.isActive) || 
        (filterStatus === 'inactive' && !c.isActive);

      return matchesSearch && matchesCompany && matchesTemplate && matchesStatus;
    })
    .sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = a.name.localeCompare(b.name);
      } else if (sortBy === 'traffic') {
        const trafficA = BigInt(a.usedTrafficBytes || 0);
        const trafficB = BigInt(b.usedTrafficBytes || 0);
        comparison = trafficA < trafficB ? -1 : trafficA > trafficB ? 1 : 0;
      } else if (sortBy === 'expiry') {
        const dateA = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
        const dateB = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortBy === 'status') {
        comparison = (a.isActive ? 1 : 0) - (b.isActive ? 1 : 0);
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

  return (
    <div className="clients-container">
      
      {/* --- СТИЛИ СТРАНИЦЫ --- */}
      <style jsx>{`
        .clients-container {
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
          max-width: 800px;
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
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 10px 15px 10px 45px;
          color: var(--text-primary);
          font-size: 14px;
          transition: all 0.2s;
        }

        .search-input:focus {
          border-color: var(--accent-cyan);
        }

        .filter-select {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 10px 15px;
          color: var(--text-primary);
          font-size: 13px;
          min-width: 150px;
          cursor: pointer;
        }

        .btn-add {
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          color: #fff;
          border: none;
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: transform 0.2s;
          box-shadow: 0 4px 15px rgba(6, 182, 212, 0.2);
        }

        .btn-add:hover {
          transform: translateY(-1px);
        }

        /* Список карточек клиентов */
        .clients-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
          gap: 15px;
        }

        /* Табличный вид строк */
        .clients-table-wrapper {
          overflow-x: auto;
          background: var(--bg-card);
          border-radius: var(--radius-md);
          border: 1px solid var(--border-color);
        }

        .clients-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 13px;
        }

        .clients-table th, .clients-table td {
          padding: 14px 18px;
          border-bottom: 1px solid var(--border-color);
          white-space: nowrap;
        }

        .clients-table th {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          background: rgba(0, 0, 0, 0.15);
        }

        .clients-table tbody tr:hover {
          background: var(--bg-card-hover);
        }

        .table-client-name {
          font-weight: 700;
          color: var(--text-primary);
        }

        .table-client-email {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .table-node-badge {
          font-size: 9px; 
          background: rgba(6, 182, 212, 0.08); 
          border: 1px solid rgba(6, 182, 212, 0.15); 
          color: #22d3ee; 
          padding: 2px 5px; 
          border-radius: 4px; 
          font-weight: 600;
        }

        .table-traffic-text {
          font-weight: 700;
          color: var(--text-primary);
        }

        .table-expiry-text {
          color: var(--text-secondary);
        }

        .client-card {
          padding: 16px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 180px;
        }

        .client-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 10px;
        }

        .client-title {
          font-size: 15px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .client-email {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 2px;
        }

        .badges-row {
          display: flex;
          gap: 6px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }

        .badge {
          font-size: 10px;
          font-weight: 600;
          padding: 3px 6px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          gap: 4px;
          background: var(--border-color);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
        }

        .limits-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          background: var(--border-color);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 8px;
          margin-bottom: 12px;
        }

        .limit-box {
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .limit-val {
          font-size: 12px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .limit-lbl {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .client-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid var(--border-color);
          padding-top: 10px;
        }

        .status-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 20px;
        }

        .pill-active {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: #34d399;
        }

        .pill-inactive {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #f87171;
        }

        .online-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 10px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 20px;
          background: rgba(16, 185, 129, 0.08);
          border: 1px solid rgba(16, 185, 129, 0.2);
          color: #34d399;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .online-pulse {
          width: 6px;
          height: 6px;
          background-color: #10b981;
          border-radius: 50%;
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          animation: pulse 1.6s infinite;
        }

        @keyframes pulse {
          0% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7);
          }
          70% {
            transform: scale(1);
            box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
          }
          100% {
            transform: scale(0.95);
            box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
          }
        }

        .card-actions {
          display: flex;
          gap: 8px;
        }

        .action-icon {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          color: var(--text-muted);
          background: var(--border-color);
          transition: all 0.2s;
        }

        .action-icon:hover {
          color: var(--text-primary);
          background: var(--border-hover);
        }

        .action-keys:hover {
          color: #06b6d4;
          background: rgba(6, 182, 212, 0.1);
          border-color: rgba(6, 182, 212, 0.2);
        }

        .action-delete:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.2);
        }

        /* Модалка ввода */
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 20px;
        }

        .modal-card {
          background: var(--bg-sidebar);
          border: 1px solid var(--border-color);
          border-radius: 20px;
          max-width: 500px;
          width: 100%;
          padding: 30px;
          box-shadow: var(--shadow-md);
          display: flex;
          flex-direction: column;
          gap: 20px;
          max-height: 95vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
        }

        .form-input {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 12px;
          color: var(--text-primary);
          font-size: 14px;
        }

        .form-input:focus {
          border-color: var(--accent-cyan);
        }

        .form-checkbox {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .btn-save {
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          color: #fff;
          border: none;
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }

        .btn-cancel {
          background: var(--border-color);
          border: 1px solid var(--border-color);
          color: var(--text-muted);
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          text-align: center;
          cursor: pointer;
        }

        /* Модалка ключей */
        .keys-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
          text-align: center;
        }

        .qr-wrapper {
          background: #fff;
          padding: 15px;
          border-radius: 12px;
          box-shadow: 0 5px 25px rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sub-link-copy-box {
          display: flex;
          background: rgba(0,0,0,0.4);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 10px;
          padding: 8px 12px;
          width: 100%;
          align-items: center;
          justify-content: space-between;
          font-size: 12px;
          gap: 10px;
        }

        .sub-url-text {
          color: #38bdf8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-family: monospace;
          flex-grow: 1;
          text-align: left;
        }

        .btn-icon-copy {
          background: none;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          padding: 4px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .btn-icon-copy:hover {
          color: #fff;
          background: rgba(255,255,255,0.08);
        }

        .raw-configs-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          border-top: 1px solid var(--border-color);
          padding-top: 20px;
        }

        .raw-config-item {
          background: var(--border-color);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 8px 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
        }

        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Панель фильтров и поиска */}
      <div className="filter-bar">
        <div className="filters-left">
          <div className="search-wrapper">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Поиск сотрудника по имени / email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <select 
            className="filter-select" 
            value={filterCompany} 
            onChange={(e) => setFilterCompany(e.target.value)}
          >
            <option value="">Все компании</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <select 
            className="filter-select" 
            value={filterTemplate} 
            onChange={(e) => setFilterTemplate(e.target.value)}
          >
            <option value="">Все шаблоны</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>

          <select 
            className="filter-select" 
            value={filterStatus} 
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="inactive">Неактивные</option>
          </select>

          <select 
            className="filter-select" 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="name">Сортировка: Имя</option>
            <option value="traffic">Сортировка: Трафик</option>
            <option value="expiry">Сортировка: Срок действия</option>
            <option value="status">Сортировка: Статус</option>
          </select>

          <button 
            type="button"
            className="filter-select"
            onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
            style={{ 
              cursor: 'pointer', 
              textAlign: 'center', 
              background: 'var(--bg-card)', 
              border: '1px solid var(--border-color)', 
              borderRadius: '10px', 
              color: 'var(--text-primary)', 
              padding: '10px 12px',
              fontSize: '13px'
            }}
          >
            {sortOrder === 'asc' ? '▲ По возр.' : '▼ По убыв.'}
          </button>
        </div>
        
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Переключатель вида */}
          <div style={{ display: 'flex', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '2px' }}>
            <button
              type="button"
              onClick={() => changeViewMode('grid')}
              style={{
                background: viewMode === 'grid' ? 'var(--border-color)' : 'none',
                border: 'none',
                color: viewMode === 'grid' ? 'var(--text-primary)' : 'var(--text-secondary)',
                padding: '6px 10px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Сетка карточек"
            >
              <Grid size={16} />
            </button>
            <button
              type="button"
              onClick={() => changeViewMode('list')}
              style={{
                background: viewMode === 'list' ? 'var(--border-color)' : 'none',
                border: 'none',
                color: viewMode === 'list' ? 'var(--text-primary)' : 'var(--text-secondary)',
                padding: '6px 10px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Таблица / Строки"
            >
              <List size={16} />
            </button>
          </div>

          <button className="btn-add" onClick={openAddModal}>
            <Plus size={16} />
            <span>Выдать доступ</span>
          </button>
        </div>
      </div>

      {/* Список клиентов */}
      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: 'var(--text-muted)' }}>
          <Loader className="spinner" size={24} style={{ color: '#06b6d4' }} />
          <span style={{ marginLeft: '10px' }}>Загрузка VPN-клиентов...</span>
        </div>
      ) : filteredClients.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="clients-grid">
            {filteredClients.map((client) => {
              const usedGB = (Number(client.usedTrafficBytes) / (1024 * 1024 * 1024)).toFixed(2);
              const limitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
              const limitText = limitGB > 0 ? `${limitGB} GB` : 'Безлимит';
              const expiresText = client.expiresAt 
                ? new Date(client.expiresAt).toLocaleDateString('ru-RU')
                : 'Безлимит';
              const expDate = client.expiresAt ? new Date(client.expiresAt) : null;
              const isExpired = expDate ? expDate < new Date() : false;

              return (
                <div key={client.id} className="client-card glass-panel">
                  <div>
                    <div className="client-header">
                      <div>
                        <div className="client-title">{client.name}</div>
                        <div className="client-email">{client.email}</div>
                      </div>
                      
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {client.isOnline && (
                          <div className="online-badge">
                            <div className="online-pulse" />
                            <span>Онлайн</span>
                          </div>
                        )}
                        
                        <div className={`status-pill ${client.isActive && !isExpired ? 'pill-active' : 'pill-inactive'}`}>
                          {client.isActive && !isExpired ? <CheckCircle size={12} /> : <XCircle size={12} />}
                          <span>{isExpired ? 'Истек' : client.isActive ? 'Активен' : 'Отключен'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="badges-row">
                      <span className="badge">
                        <Building2 size={10} />
                        <span>{client.company.name}</span>
                      </span>
                      <span className="badge">
                        <Sliders size={10} />
                        <span>{client.template.name}</span>
                      </span>
                    </div>

                    {/* Сервера / Ноды (Из 3XUI) */}
                    {client.nodes && client.nodes.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px', alignItems: 'center' }}>
                        <span style={{ fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginRight: '2px' }}>Сервера:</span>
                        {client.nodes.map((node, i) => (
                          <span key={i} style={{ fontSize: '9px', background: 'rgba(6, 182, 212, 0.08)', border: '1px solid rgba(6, 182, 212, 0.15)', color: '#22d3ee', padding: '2px 5px', borderRadius: '4px', fontWeight: 600 }}>
                            {node}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Лимиты */}
                  <div className="limits-row">
                    <div className="limit-box">
                      <div className="limit-val">{usedGB} / {limitText}</div>
                      <div className="limit-lbl">Использовано ГБ</div>
                    </div>
                    <div className="limit-box">
                      <div className="limit-val">{expiresText}</div>
                      <div className="limit-lbl">Истекает</div>
                    </div>
                  </div>

                  <div className="client-footer">
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                      UUID: {client.vpnUuid.substring(0, 8)}...
                    </div>

                    <div className="card-actions">
                      <button className="action-icon action-keys" onClick={() => openKeysModal(client)} title="Показать QR-код и ключи VPN">
                        <Key size={14} />
                      </button>
                      <button className="action-icon" onClick={() => openEditModal(client)} title="Редактировать">
                        <Edit2 size={14} />
                      </button>
                      <button className="action-icon action-delete" onClick={() => handleDelete(client.id, client.name)} title="Удалить">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="clients-table-wrapper glass-panel">
            <table className="clients-table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th>B2B Компания</th>
                  <th>Шаблон</th>
                  <th>Сервера</th>
                  <th>Трафик (Использовано / Лимит)</th>
                  <th>Срок действия</th>
                  <th>Статус</th>
                  <th style={{ textAlign: 'right' }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((client) => {
                  const usedGB = (Number(client.usedTrafficBytes) / (1024 * 1024 * 1024)).toFixed(2);
                  const limitGB = client.trafficLimitGB !== null ? client.trafficLimitGB : client.template.trafficLimitGB;
                  const limitText = limitGB > 0 ? `${limitGB} GB` : 'Безлимит';
                  const expiresText = client.expiresAt 
                    ? new Date(client.expiresAt).toLocaleDateString('ru-RU')
                    : 'Безлимит';
                  const expDate = client.expiresAt ? new Date(client.expiresAt) : null;
                  const isExpired = expDate ? expDate < new Date() : false;

                  return (
                    <tr key={client.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span className="table-client-name">{client.name}</span>
                          <span className="table-client-email">{client.email}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge">
                          <Building2 size={10} />
                          <span>{client.company.name}</span>
                        </span>
                      </td>
                      <td>
                        <span className="badge">
                          <Sliders size={10} />
                          <span>{client.template.name}</span>
                        </span>
                      </td>
                      <td>
                        {client.nodes && client.nodes.length > 0 ? (
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {client.nodes.map((node, i) => (
                              <span key={i} className="table-node-badge">
                                {node}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>нет</span>
                        )}
                      </td>
                      <td>
                        <span className="table-traffic-text">{usedGB} / {limitText}</span>
                      </td>
                      <td>
                        <span className="table-expiry-text">{expiresText}</span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {client.isOnline && (
                            <div className="online-badge" style={{ padding: '2px 8px' }}>
                              <div className="online-pulse" />
                              <span>Онлайн</span>
                            </div>
                          )}
                          <div className={`status-pill ${client.isActive && !isExpired ? 'pill-active' : 'pill-inactive'}`}>
                            <span>{isExpired ? 'Истек' : client.isActive ? 'Активен' : 'Отключен'}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="card-actions" style={{ justifyContent: 'flex-end' }}>
                          <button className="action-icon action-keys" onClick={() => openKeysModal(client)} title="Показать QR-код и ключи VPN">
                            <Key size={14} />
                          </button>
                          <button className="action-icon" onClick={() => openEditModal(client)} title="Редактировать">
                            <Edit2 size={14} />
                          </button>
                          <button className="action-icon action-delete" onClick={() => handleDelete(client.id, client.name)} title="Удалить">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="no-data" style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
          Пользователи не найдены. Выдайте первый доступ кнопкой выше!
        </div>
      )}

      {/* --- МОДАЛЬНОЕ ОКНО СОЗДАНИЯ / РЕДАКТИРОВАНИЯ --- */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span>{editingId ? 'Редактировать VPN доступ' : 'Выдать новый VPN доступ'}</span>
            </div>

            {error && (
              <div className="alert-error">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              <div className="form-group">
                <label className="form-label">ФИО сотрудника</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Иван Иванов"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">B2B Компания</label>
                <select 
                  className="form-input"
                  style={{ cursor: 'pointer' }}
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  required
                >
                  <option value="" disabled>Выберите компанию</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Шаблон подключения</label>
                <select 
                  className="form-input"
                  style={{ cursor: 'pointer' }}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  required
                >
                  <option value="" disabled>Выберите шаблон</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              {/* Чекбокс переопределения лимитов */}
              <label className="form-checkbox">
                <input
                  type="checkbox"
                  checked={hasCustomLimits}
                  onChange={(e) => setHasCustomLimits(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <span>Установить кастомные лимиты (переопределить шаблон)</span>
              </label>

              {hasCustomLimits && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', background: 'var(--border-color)', padding: '15px', borderRadius: '10px' }}>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '10px' }}>Лимит трафика (GB)</label>
                    <input
                      type="number"
                      className="form-input"
                      min="0"
                      placeholder="0 - безлимит"
                      value={customTrafficLimitGB}
                      onChange={(e) => setCustomTrafficLimitGB(e.target.value !== '' ? Number(e.target.value) : '')}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ fontSize: '10px' }}>Лимит устройств (IP)</label>
                    <input
                      type="number"
                      className="form-input"
                      min="0"
                      placeholder="0 - безлимит"
                      value={customLimitIp}
                      onChange={(e) => setCustomLimitIp(e.target.value !== '' ? Number(e.target.value) : '')}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label" style={{ fontSize: '10px' }}>Дата окончания действия</label>
                    <input
                      type="date"
                      className="form-input"
                      value={customExpiresAt}
                      onChange={(e) => setCustomExpiresAt(e.target.value)}
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label" style={{ fontSize: '10px' }}>Параметр Flow (Reality VLESS)</label>
                    <select
                      className="form-input"
                      value={customFlow}
                      onChange={(e) => setCustomFlow(e.target.value)}
                      style={{ appearance: 'none', background: 'rgba(0,0,0,0.3) url("data:image/svg+xml;utf8,<svg fill=\'%23ffffff\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/><path d=\'M0 0h24v24H0z\' fill=\'none\'/></svg>") no-repeat right 12px center', cursor: 'pointer' }}
                    >
                      <option value="" style={{ background: '#111827', color: '#fff' }}>Использовать Flow из шаблона</option>
                      <option value="xtls-rprx-vision" style={{ background: '#111827', color: '#fff' }}>xtls-rprx-vision (Рекомендуется для Reality)</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="form-label" style={{ fontSize: '10px' }}>Telegram ID (для алертов 3XUI)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Например: 123456789"
                      value={customTgId}
                      onChange={(e) => setCustomTgId(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {editingId && (
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Разрешить подключение к VPN (isActive)</span>
                </label>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '10px' }}>
                <button type="submit" className="btn-save" disabled={isSaving}>
                  {isSaving ? <Loader size={16} className="spinner" /> : null}
                  <span>Сохранить</span>
                </button>
                <div className="btn-cancel" onClick={() => setIsModalOpen(false)}>Отмена</div>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* --- МОДАЛЬНОЕ ОКНО ПРОСМОТРА КЛЮЧЕЙ И QR-КОДА --- */}
      {isKeysModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '460px' }}>
            <div className="modal-header">
              <span>VPN Доступы клиента</span>
              <button 
                onClick={() => setIsKeysModalOpen(false)} 
                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            {isLoadingKeys ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px', gap: '15px', color: 'var(--text-muted)' }}>
                <Loader className="spinner" size={24} style={{ color: '#06b6d4' }} />
                <span>Генерация конфигураций и QR-кода...</span>
              </div>
            ) : selectedClientKeys ? (
              <div className="keys-box">
                
                {/* QR Code */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                  <div className="qr-wrapper">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={selectedClientKeys.qrCodeDataUrl} 
                      alt="Subscription QR Code" 
                      style={{ width: '180px', height: '180px' }} 
                    />
                  </div>
                  <span style={{ fontSize: '10px', color: '#6b7280', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <QrCode size={12} />
                    <span>Сканируйте в v2rayNG / Sing-box / Shadowrocket</span>
                  </span>
                </div>

                {/* Персональная Ссылка подписки */}
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="form-label" style={{ textAlign: 'left' }}>Умная ссылка подписки:</div>
                  <div className="sub-link-copy-box">
                    <span className="sub-url-text">{selectedClientKeys.subscriptionUrl}</span>
                    <button 
                      className="btn-icon-copy" 
                      onClick={() => copyToClipboard(selectedClientKeys.subscriptionUrl, 'Ссылка подписки скопирована!')}
                      title="Скопировать подписку"
                    >
                      <Copy size={14} />
                    </button>
                  </div>
                </div>

                {/* Ручные ключи */}
                {selectedClientKeys.configLinks.length > 0 ? (
                  <div className="raw-configs-list">
                    <div className="form-label" style={{ textAlign: 'left' }}>Ключи для ручного импорта:</div>
                    {selectedClientKeys.configLinks.map((link, idx) => {
                      const proto = link.split('://')[0].toUpperCase();
                      const nodeName = link.includes('#') ? decodeURIComponent(link.split('#')[1]).split('_')[0] : `Сервер ${idx + 1}`;
                      return (
                        <div key={idx} className="raw-config-item">
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{nodeName} ({proto})</span>
                          <span 
                            style={{ color: 'var(--accent-cyan)', cursor: 'pointer', fontWeight: 700 }}
                            onClick={() => copyToClipboard(link, 'Конфигурация скопирована!')}
                          >
                            Копировать
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="no-data" style={{ padding: '15px' }}>
                    У инбаундов этого шаблона не поддерживается автогенерация ссылок.
                  </div>
                )}

              </div>
            ) : null}
          </div>
        </div>
      )}

    </div>
  );
}
