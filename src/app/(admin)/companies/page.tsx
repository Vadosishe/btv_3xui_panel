'use client';

import React, { useState, useEffect } from 'react';
import {
  Building2,
  Plus,
  Trash2,
  Edit2,
  Search,
  Users,
  HardDrive,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader,
  Download,
} from 'lucide-react';

interface Company {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { clients: number };
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Групповой экспорт и уведомления
  const [exportingCompanyId, setExportingCompanyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 2500);
  };

  const handleExportCompanyZIP = async (companyId: string, companyName: string) => {
    setExportingCompanyId(companyId);
    try {
      const res = await fetch('/api/admin/clients/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });

      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `btv-vpn-${companyName.replace(/\s+/g, '_')}-configs.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
        showToast(`Архив компании "${companyName}" успешно скачан!`);
      } else {
        const errData = await res.json();
        showToast(errData.error || 'Ошибка при экспорте архива', 'error');
      }
    } catch (e) {
      showToast('Ошибка сети. Проверьте соединение.', 'error');
    } finally {
      setExportingCompanyId(null);
    }
  };

  // Форма добавления/редактирования
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Подгрузка списка компаний
  const loadCompanies = async () => {
    try {
      const res = await fetch('/api/admin/companies');
      if (res.ok) {
        const data = await res.json();
        setCompanies(data.companies || []);
      }
    } catch (e) {
      console.error('Failed to load companies:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const openAddModal = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setIsActive(true);
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (company: Company) => {
    setEditingId(company.id);
    setName(company.name);
    setDescription(company.description || '');
    setIsActive(company.isActive);
    setError(null);
    setIsModalOpen(true);
  };

  // Сохранить изменения (Создать / Редактировать)
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError(null);

    const url = editingId ? `/api/admin/companies/${editingId}` : '/api/admin/companies';
    const method = editingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, isActive }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setIsModalOpen(false);
        loadCompanies();
      } else {
        setError(data.error || 'Ошибка при сохранении');
      }
    } catch (err) {
      setError('Ошибка сети. Проверьте соединение.');
    } finally {
      setIsSaving(false);
    }
  };

  // Удаление компании с подтверждением
  const handleDelete = async (id: string, companyName: string) => {
    const confirmed = window.confirm(
      `Вы действительно хотите удалить компанию "${companyName}"?\nВнимание! Это действие удалит ВСЕХ сотрудников этой компании и их VPN ключи с серверов 3XUI!`
    );
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/admin/companies/${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadCompanies();
      } else {
        const data = await res.json();
        alert(data.error || 'Ошибка при удалении');
      }
    } catch (e) {
      alert('Ошибка подключения к серверу.');
    }
  };

  // Фильтр списка
  const filteredCompanies = companies.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="companies-container">
      
      {/* --- СТИЛИ СТРАНИЦЫ --- */}
      <style jsx>{`
        .companies-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .action-bar {
          display: flex;
          justify-content: space-between;
          gap: 15px;
          align-items: center;
        }

        @media (max-width: 600px) {
          .action-bar {
            flex-direction: column;
            align-items: stretch;
          }
        }

        .search-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          flex-grow: 1;
          max-width: 400px;
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
          background: var(--bg-card-hover);
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

        /* Список карточек компаний */
        .company-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
        }

        .company-card {
          padding: 24px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 200px;
        }

        .company-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 12px;
        }

        .company-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .company-desc {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
          margin-bottom: 20px;
          flex-grow: 1;
        }

        .company-stats {
          display: flex;
          gap: 20px;
          border-top: 1px solid var(--border-color);
          padding-top: 15px;
          margin-bottom: 20px;
        }

        .stat-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .stat-val {
          font-weight: 700;
          color: var(--accent-cyan);
        }

        .company-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .status-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          padding: 4px 10px;
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

        .card-actions {
          display: flex;
          gap: 10px;
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

        .action-delete:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.2);
        }

        .action-download:hover {
          color: #06b6d4;
          background: rgba(6, 182, 212, 0.1);
          border-color: rgba(6, 182, 212, 0.2);
        }

        /* Toast notifications */
        .toast-notification {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: #10b981;
          color: #fff;
          padding: 12px 24px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 700;
          box-shadow: 0 10px 25px rgba(16, 185, 129, 0.2);
          z-index: 110;
          animation: slideInToast 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .toast-notification.error {
          background: #ef4444;
          box-shadow: 0 10px 25px rgba(239, 68, 68, 0.2);
        }

        @keyframes slideInToast {
          from { transform: translateY(50px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }

        /* Модальное окно */
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
          background: #0f1219;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 20px;
          max-width: 480px;
          width: 100%;
          padding: 30px;
          box-shadow: 0 15px 40px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 18px;
          font-weight: 700;
          color: #fff;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-label {
          font-size: 12px;
          font-weight: 600;
          color: #9ca3af;
          text-transform: uppercase;
        }

        .form-input {
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 12px;
          color: #fff;
          font-size: 14px;
        }

        .form-input:focus {
          border-color: #06b6d4;
        }

        .form-checkbox {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-size: 13px;
        }

        .btn-save {
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          color: #white;
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
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          color: #9ca3af;
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          text-align: center;
          cursor: pointer;
        }

        .btn-cancel:hover {
          color: #fff;
          background: rgba(255,255,255,0.08);
        }

        .alert-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 10px;
          color: #f87171;
          padding: 10px 15px;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Панель поиска и добавления */}
      <div className="action-bar">
        <div className="search-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Поиск по названию компании..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <button className="btn-add" onClick={openAddModal}>
          <Plus size={16} />
          <span>Добавить компанию</span>
        </button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: '#9ca3af' }}>
          <Loader className="spinner" size={24} style={{ color: '#06b6d4' }} />
          <span style={{ marginLeft: '10px' }}>Загрузка компаний...</span>
        </div>
      ) : filteredCompanies.length > 0 ? (
        <div className="company-grid">
          {filteredCompanies.map((company) => (
            <div key={company.id} className="company-card glass-panel">
              <div className="company-header">
                <div className="company-title">{company.name}</div>
                <div className={`status-pill ${company.isActive ? 'pill-active' : 'pill-inactive'}`}>
                  {company.isActive ? <CheckCircle size={12} /> : <XCircle size={12} />}
                  <span>{company.isActive ? 'Активна' : 'Приостановлена'}</span>
                </div>
              </div>

              <div className="company-desc">
                {company.description || 'Описание отсутствует.'}
              </div>

              <div className="company-stats">
                <div className="stat-item">
                  <Users size={14} style={{ color: '#a855f7' }} />
                  <span>Сотрудников: <strong className="stat-val">{company._count?.clients || 0}</strong></span>
                </div>
              </div>

              <div className="company-footer">
                <div style={{ fontSize: '10px', color: '#6b7280' }}>
                  Создана: {new Date(company.createdAt).toLocaleDateString('ru-RU')}
                </div>

                <div className="card-actions">
                  <button 
                    className="action-icon action-download" 
                    onClick={() => handleExportCompanyZIP(company.id, company.name)} 
                    disabled={exportingCompanyId === company.id || (company._count?.clients || 0) === 0}
                    title="Скачать все конфиги сотрудников архивом ZIP"
                    style={{
                      opacity: (company._count?.clients || 0) === 0 ? 0.4 : 1,
                      cursor: (company._count?.clients || 0) === 0 ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {exportingCompanyId === company.id ? (
                      <Loader size={14} className="spinner" style={{ color: '#06b6d4' }} />
                    ) : (
                      <Download size={14} />
                    )}
                  </button>
                  <button className="action-icon" onClick={() => openEditModal(company)} title="Редактировать">
                    <Edit2 size={14} />
                  </button>
                  <button className="action-icon action-delete" onClick={() => handleDelete(company.id, company.name)} title="Удалить">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="no-data" style={{ padding: '60px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>
          Компании не найдены. Создайте первую компанию кнопкой выше!
        </div>
      )}

      {/* --- МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ / РЕДАКТИРОВАНИЯ --- */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span>{editingId ? 'Редактировать компанию' : 'Добавить новую компанию'}</span>
            </div>

            {error && (
              <div className="alert-error">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="form-group">
                <label className="form-label">Название компании</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Например: Zapus Group"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Описание</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: '80px', resize: 'vertical' }}
                  placeholder="Краткое описание сотрудничества или контакты..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {editingId && (
                <label className="form-checkbox">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span>Компания активна (разрешить доступ сотрудникам)</span>
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

      {/* Красивое всплывающее уведомление (Toast) */}
      {toast && (
        <div className={`toast-notification ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
