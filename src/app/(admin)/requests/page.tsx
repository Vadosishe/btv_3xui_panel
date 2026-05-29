'use client';

import React, { useState, useEffect } from 'react';
import {
  Mail,
  User,
  Send,
  MessageSquare,
  Calendar,
  Globe,
  CheckCircle,
  XCircle,
  Trash2,
  Loader,
  Search,
  Inbox,
  Clock,
  Check,
  X as CloseIcon
} from 'lucide-react';

interface VpnRequest {
  id: string;
  email: string;
  telegram: string;
  telegramChatId: string;
  name: string;
  description: string;
  status: string; // PENDING | APPROVED | DENIED
  adminNote: string;
  source: string; // WEB | TELEGRAM
  clientId: string | null;
  createdAt: string;
}

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

export default function RequestsPage() {
  const [requests, setRequests] = useState<VpnRequest[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'DENIED'>('ALL');
  
  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  // Approve Modal State
  const [approveModal, setApproveModal] = useState<{
    open: boolean;
    requestId: string | null;
    companyId: string;
    templateId: string;
    clientName: string;
    adminNote: string;
  }>({
    open: false,
    requestId: null,
    companyId: '',
    templateId: '',
    clientName: '',
    adminNote: ''
  });

  // Deny Modal State
  const [denyModal, setDenyModal] = useState<{
    open: boolean;
    requestId: string | null;
    adminNote: string;
  }>({
    open: false,
    requestId: null,
    adminNote: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [resReq, resComp, resTemp] = await Promise.all([
        fetch('/api/admin/requests'),
        fetch('/api/admin/companies'),
        fetch('/api/admin/templates')
      ]);

      const reqData = await resReq.json();
      const compData = await resComp.json();
      const tempData = await resTemp.json();

      if (reqData.success) setRequests(reqData.requests);
      if (compData.success) setCompanies(compData.companies || []);
      if (tempData.success) setTemplates(tempData.templates || []);
    } catch (error) {
      console.error('Error loading data:', error);
      showToast('Ошибка при загрузке данных', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenApprove = (req: VpnRequest) => {
    setApproveModal({
      open: true,
      requestId: req.id,
      companyId: companies.length > 0 ? companies[0].id : '',
      templateId: templates.length > 0 ? templates[0].id : '',
      clientName: req.name || req.email.split('@')[0],
      adminNote: ''
    });
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approveModal.requestId || !approveModal.companyId || !approveModal.templateId) {
      showToast('Выберите компанию и шаблон', 'error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/requests/${approveModal.requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'APPROVED',
          companyId: approveModal.companyId,
          templateId: approveModal.templateId,
          clientName: approveModal.clientName,
          adminNote: approveModal.adminNote
        })
      });

      const data = await res.json();
      if (data.success) {
        showToast('Заявка успешно одобрена, клиент создан!');
        setApproveModal(prev => ({ ...prev, open: false }));
        loadData();
      } else {
        showToast(data.error || 'Ошибка при одобрении заявки', 'error');
      }
    } catch (error) {
      console.error('Error approving request:', error);
      showToast('Произошла ошибка', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenDeny = (req: VpnRequest) => {
    setDenyModal({
      open: true,
      requestId: req.id,
      adminNote: ''
    });
  };

  const handleDenySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!denyModal.requestId) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/requests/${denyModal.requestId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'DENIED',
          adminNote: denyModal.adminNote
        })
      });

      const data = await res.json();
      if (data.success) {
        showToast('Заявка отклонена');
        setDenyModal(prev => ({ ...prev, open: false }));
        loadData();
      } else {
        showToast(data.error || 'Ошибка при отклонении заявки', 'error');
      }
    } catch (error) {
      console.error('Error denying request:', error);
      showToast('Произошла ошибка', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить эту заявку?')) return;

    try {
      const res = await fetch(`/api/admin/requests/${id}`, {
        method: 'DELETE'
      });

      const data = await res.json();
      if (data.success) {
        showToast('Заявка удалена');
        loadData();
      } else {
        showToast(data.error || 'Ошибка при удалении заявки', 'error');
      }
    } catch (error) {
      console.error('Error deleting request:', error);
      showToast('Произошла ошибка', 'error');
    }
  };

  // Stats calculation
  const totalCount = requests.length;
  const pendingCount = requests.filter(r => r.status === 'PENDING').length;
  const approvedCount = requests.filter(r => r.status === 'APPROVED').length;
  const deniedCount = requests.filter(r => r.status === 'DENIED').length;

  // Filter requests
  const filteredRequests = requests.filter(req => {
    // Status Filter
    if (statusFilter !== 'ALL' && req.status !== statusFilter) return false;
    
    // Search query
    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      const matchEmail = req.email.toLowerCase().includes(query);
      const matchName = req.name?.toLowerCase().includes(query);
      const matchTelegram = req.telegram?.toLowerCase().includes(query);
      return matchEmail || matchName || matchTelegram;
    }
    
    return true;
  });

  return (
    <div className="requests-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Заявки на VPN</h1>
          <p className="page-subtitle">Управление запросами конфигураций от пользователей (через Web и Telegram-бот)</p>
        </div>

        {/* Статистические показатели */}
        <div className="stats-container">
          <div className="stat-card glass-panel">
            <div className="stat-num">{totalCount}</div>
            <div className="stat-lbl">Всего</div>
          </div>
          <div className="stat-card glass-panel pending">
            <div className="stat-num">{pendingCount}</div>
            <div className="stat-lbl">Ожидают</div>
          </div>
          <div className="stat-card glass-panel approved">
            <div className="stat-num">{approvedCount}</div>
            <div className="stat-lbl">Одобрены</div>
          </div>
          <div className="stat-card glass-panel denied">
            <div className="stat-num">{deniedCount}</div>
            <div className="stat-lbl">Отклонены</div>
          </div>
        </div>
      </div>

      {/* Фильтр-бар */}
      <div className="filter-bar">
        <div className="search-wrapper">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Поиск по email, имени, telegram..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="filter-buttons">
          <button
            className={`filter-btn ${statusFilter === 'ALL' ? 'active' : ''}`}
            onClick={() => setStatusFilter('ALL')}
          >
            Все ({totalCount})
          </button>
          <button
            className={`filter-btn pending ${statusFilter === 'PENDING' ? 'active' : ''}`}
            onClick={() => setStatusFilter('PENDING')}
          >
            Ожидают ({pendingCount})
          </button>
          <button
            className={`filter-btn approved ${statusFilter === 'APPROVED' ? 'active' : ''}`}
            onClick={() => setStatusFilter('APPROVED')}
          >
            Одобрены ({approvedCount})
          </button>
          <button
            className={`filter-btn denied ${statusFilter === 'DENIED' ? 'active' : ''}`}
            onClick={() => setStatusFilter('DENIED')}
          >
            Отклонены ({deniedCount})
          </button>
        </div>
      </div>

      {/* Загрузка и пустые состояния */}
      {isLoading ? (
        <div className="loading-state">
          <Loader className="spinner" size={24} style={{ color: 'var(--accent-cyan)' }} />
          <span>Загрузка списка заявок...</span>
        </div>
      ) : filteredRequests.length > 0 ? (
        <div className="requests-grid">
          {filteredRequests.map((req) => (
            <div key={req.id} className="request-card glass-panel">
              <div className="card-header">
                <span className={`source-badge ${req.source}`}>
                  {req.source === 'TELEGRAM' ? (
                    <>
                      <Send size={10} />
                      <span>Telegram</span>
                    </>
                  ) : (
                    <>
                      <Globe size={10} />
                      <span>Web</span>
                    </>
                  )}
                </span>
                
                <span className="card-date">
                  <Calendar size={10} />
                  <span>{new Date(req.createdAt).toLocaleDateString('ru-RU')}</span>
                </span>

                <span className={`status-badge ${req.status}`}>
                  {req.status === 'PENDING' && 'Ожидает'}
                  {req.status === 'APPROVED' && 'Одобрена'}
                  {req.status === 'DENIED' && 'Отклонена'}
                </span>
              </div>

              <div className="card-body">
                <div className="info-row email-row">
                  <Mail size={14} className="info-icon" />
                  <strong className="email-text">{req.email}</strong>
                </div>

                {req.name && (
                  <div className="info-row">
                    <User size={14} className="info-icon" />
                    <span>Имя: <strong className="val-text">{req.name}</strong></span>
                  </div>
                )}

                {req.telegram && (
                  <div className="info-row">
                    <Send size={14} className="info-icon" />
                    <span>Telegram: <strong className="val-text">{req.telegram}</strong></span>
                  </div>
                )}

                {req.description && (
                  <div className="desc-box">
                    <div className="desc-title">
                      <MessageSquare size={11} />
                      <span>Описание:</span>
                    </div>
                    <div className="desc-text">{req.description}</div>
                  </div>
                )}

                {req.adminNote && (
                  <div className="admin-note-box">
                    <div className="note-title">Заметка администратора:</div>
                    <div className="note-text">{req.adminNote}</div>
                  </div>
                )}
              </div>

              <div className="card-footer">
                {req.status === 'PENDING' ? (
                  <div className="action-buttons">
                    <button className="btn-approve" onClick={() => handleOpenApprove(req)}>
                      <Check size={14} />
                      <span>Одобрить</span>
                    </button>
                    <button className="btn-deny" onClick={() => handleOpenDeny(req)}>
                      <CloseIcon size={14} />
                      <span>Отклонить</span>
                    </button>
                  </div>
                ) : (
                  <div className="footer-meta">
                    <span className="meta-text">Обработано</span>
                    <button className="btn-delete-card" onClick={() => handleDelete(req.id)} title="Удалить заявку">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="no-data-state">
          <Inbox size={48} className="no-data-icon" />
          <h3>Заявок не найдено</h3>
          <p>Ни одна заявка не соответствует выбранным критериям фильтрации.</p>
        </div>
      )}

      {/* Approve Modal */}
      {approveModal.open && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Одобрить заявку на VPN</h3>
              <button className="btn-close" onClick={() => setApproveModal(prev => ({ ...prev, open: false }))}>
                <CloseIcon size={16} />
              </button>
            </div>

            <form onSubmit={handleApproveSubmit} className="modal-form">
              <div className="request-preview">
                <div>Email: <strong>{requests.find(r => r.id === approveModal.requestId)?.email}</strong></div>
                {requests.find(r => r.id === approveModal.requestId)?.name && (
                  <div>Имя заявителя: <strong>{requests.find(r => r.id === approveModal.requestId)?.name}</strong></div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Привязать к компании *</label>
                {companies.length > 0 ? (
                  <select
                    className="form-input"
                    value={approveModal.companyId}
                    onChange={(e) => setApproveModal(prev => ({ ...prev, companyId: e.target.value }))}
                    required
                  >
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="alert-warning">
                    Сначала создайте компанию в разделе «Компании»!
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Выбрать шаблон VPN-подключения *</label>
                {templates.length > 0 ? (
                  <select
                    className="form-input"
                    value={approveModal.templateId}
                    onChange={(e) => setApproveModal(prev => ({ ...prev, templateId: e.target.value }))}
                    required
                  >
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} (Лимит: {t.trafficLimitGB > 0 ? `${t.trafficLimitGB} ГБ` : 'Безлимит'}, {t.durationDays} дн.)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="alert-warning">
                    Сначала создайте шаблон в разделе «Шаблоны»!
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Имя клиента в панели *</label>
                <input
                  type="text"
                  className="form-input"
                  value={approveModal.clientName}
                  onChange={(e) => setApproveModal(prev => ({ ...prev, clientName: e.target.value }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Заметка / Комментарий для пользователя (опционально)</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: '80px', resize: 'vertical' }}
                  placeholder="Ваше сообщение заявителю. Оно будет добавлено к уведомлению..."
                  value={approveModal.adminNote}
                  onChange={(e) => setApproveModal(prev => ({ ...prev, adminNote: e.target.value }))}
                />
              </div>

              <div className="modal-buttons">
                <button
                  type="submit"
                  className="btn-submit-modal"
                  disabled={isSubmitting || companies.length === 0 || templates.length === 0}
                >
                  {isSubmitting ? <Loader size={16} className="spinner" /> : null}
                  <span>Одобрить и создать клиента</span>
                </button>
                <button
                  type="button"
                  className="btn-cancel-modal"
                  onClick={() => setApproveModal(prev => ({ ...prev, open: false }))}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Deny Modal */}
      {denyModal.open && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Отклонить заявку</h3>
              <button className="btn-close" onClick={() => setDenyModal(prev => ({ ...prev, open: false }))}>
                <CloseIcon size={16} />
              </button>
            </div>

            <form onSubmit={handleDenySubmit} className="modal-form">
              <div className="form-group">
                <label className="form-label">Причина отклонения *</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: '100px', resize: 'vertical' }}
                  placeholder="Укажите причину отказа. Она будет отправлена пользователю..."
                  value={denyModal.adminNote}
                  onChange={(e) => setDenyModal(prev => ({ ...prev, adminNote: e.target.value }))}
                  required
                />
              </div>

              <div className="modal-buttons">
                <button type="submit" className="btn-submit-modal btn-danger-gradient" disabled={isSubmitting}>
                  {isSubmitting ? <Loader size={16} className="spinner" /> : null}
                  <span>Отклонить заявку</span>
                </button>
                <button
                  type="button"
                  className="btn-cancel-modal"
                  onClick={() => setDenyModal(prev => ({ ...prev, open: false }))}
                >
                  Отмена
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className={`toast-notification ${toast.type}`}>
          {toast.message}
        </div>
      )}

      <style jsx>{`
        .requests-container {
          display: flex;
          flex-direction: column;
          gap: 25px;
          padding-bottom: 40px;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
        }

        .page-title {
          font-size: 24px;
          font-weight: 800;
          color: #fff;
          margin-bottom: 5px;
        }

        .page-subtitle {
          font-size: 13px;
          color: var(--text-secondary);
        }

        /* Stats Grid */
        .stats-container {
          display: grid;
          grid-template-columns: repeat(4, 100px);
          gap: 12px;
        }

        @media (max-width: 900px) {
          .page-header {
            flex-direction: column;
            align-items: stretch;
          }
          .stats-container {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        .stat-card {
          padding: 12px;
          text-align: center;
          border-radius: var(--radius-sm);
        }

        .stat-num {
          font-size: 20px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .stat-lbl {
          font-size: 10px;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 2px;
        }

        .stat-card.pending .stat-num { color: var(--color-warning); }
        .stat-card.approved .stat-num { color: var(--color-success); }
        .stat-card.denied .stat-num { color: var(--color-danger); }

        /* Filter bar */
        .filter-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
        }

        @media (max-width: 768px) {
          .filter-bar {
            flex-direction: column;
            align-items: stretch;
          }
        }

        .search-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          flex-grow: 1;
          max-width: 450px;
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

        .filter-buttons {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
        }

        .filter-btn {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-sm);
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text-secondary);
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }

        .filter-btn:hover {
          color: var(--text-primary);
          border-color: var(--border-hover);
        }

        .filter-btn.active {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.2);
          color: #fff;
        }

        .filter-btn.pending.active {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.25);
          color: var(--color-warning);
        }

        .filter-btn.approved.active {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.25);
          color: var(--color-success);
        }

        .filter-btn.denied.active {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.25);
          color: var(--color-danger);
        }

        /* Card Grid */
        .requests-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
          gap: 20px;
        }

        @media (max-width: 480px) {
          .requests-grid {
            grid-template-columns: 1fr;
          }
        }

        .request-card {
          padding: 20px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 250px;
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 10px;
        }

        .source-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          gap: 4px;
          text-transform: uppercase;
        }

        .source-badge.WEB {
          background: rgba(6, 182, 212, 0.1);
          color: var(--accent-cyan);
          border: 1px solid rgba(6, 182, 212, 0.15);
        }

        .source-badge.TELEGRAM {
          background: rgba(168, 85, 247, 0.1);
          color: var(--accent-purple);
          border: 1px solid rgba(168, 85, 247, 0.15);
        }

        .card-date {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--text-muted);
        }

        .status-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 6px;
        }

        .status-badge.PENDING {
          background: rgba(245, 158, 11, 0.1);
          color: var(--color-warning);
        }

        .status-badge.APPROVED {
          background: rgba(16, 185, 129, 0.1);
          color: var(--color-success);
        }

        .status-badge.DENIED {
          background: rgba(239, 68, 68, 0.1);
          color: var(--color-danger);
        }

        .card-body {
          display: flex;
          flex-direction: column;
          gap: 12px;
          flex-grow: 1;
        }

        .info-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: var(--text-secondary);
        }

        .info-icon {
          color: var(--text-muted);
        }

        .email-row {
          color: var(--text-primary);
          font-size: 14px;
        }

        .email-text {
          word-break: break-all;
        }

        .val-text {
          color: var(--text-primary);
          font-weight: 600;
        }

        .desc-box {
          background: rgba(0,0,0,0.15);
          border-radius: 8px;
          padding: 10px;
          border: 1px solid var(--border-color);
        }

        .desc-title {
          font-size: 11px;
          color: var(--text-muted);
          font-weight: 700;
          text-transform: uppercase;
          margin-bottom: 4px;
          display: flex;
          align-items: center;
          gap: 5px;
        }

        .desc-text {
          font-size: 12px;
          color: var(--text-secondary);
          line-height: 1.4;
          word-break: break-word;
        }

        .admin-note-box {
          border-left: 2px solid var(--accent-cyan);
          padding-left: 10px;
          margin-top: 5px;
        }

        .note-title {
          font-size: 10px;
          font-weight: 700;
          color: var(--accent-cyan);
          text-transform: uppercase;
        }

        .note-text {
          font-size: 12px;
          color: var(--text-secondary);
          font-style: italic;
          margin-top: 2px;
        }

        .card-footer {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid var(--border-color);
        }

        .action-buttons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .btn-approve {
          background: rgba(16, 185, 129, 0.08);
          border: 1px solid rgba(16, 185, 129, 0.15);
          color: var(--color-success);
          font-size: 12px;
          font-weight: 700;
          padding: 8px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s;
        }

        .btn-approve:hover {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.3);
          transform: translateY(-1px);
        }

        .btn-deny {
          background: rgba(239, 68, 68, 0.06);
          border: 1px solid rgba(239, 68, 68, 0.12);
          color: #f87171;
          font-size: 12px;
          font-weight: 700;
          padding: 8px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.2s;
        }

        .btn-deny:hover {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.25);
          transform: translateY(-1px);
        }

        .footer-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .meta-text {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 600;
        }

        .btn-delete-card {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          border: 1px solid var(--border-color);
          background: var(--border-color);
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-delete-card:hover {
          color: #ef4444;
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.2);
        }

        /* Loading / No Data */
        .loading-state {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          padding: 60px;
          color: var(--text-secondary);
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .no-data-state {
          padding: 60px;
          text-align: center;
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }

        .no-data-icon {
          color: var(--text-muted);
          margin-bottom: 10px;
        }

        .no-data-state h3 {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
        }

        .no-data-state p {
          font-size: 12px;
          color: var(--text-muted);
        }

        /* Modals */
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
        }

        .modal-header h3 {
          font-size: 18px;
          font-weight: 700;
          color: #fff;
        }

        .btn-close {
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          transition: all 0.2s;
        }

        .btn-close:hover {
          color: #fff;
          background: rgba(255,255,255,0.05);
        }

        .modal-form {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }

        .request-preview {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 12px;
          font-size: 13px;
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-label {
          font-size: 11px;
          font-weight: 600;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .form-input {
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px;
          padding: 12px;
          color: #fff;
          font-size: 14px;
          width: 100%;
          transition: all 0.2s;
        }

        .form-input:focus {
          border-color: var(--accent-cyan);
          background: rgba(0,0,0,0.5);
        }

        select.form-input option {
          background: #0f1219;
          color: #fff;
        }

        .alert-warning {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.2);
          border-radius: 8px;
          color: var(--color-warning);
          padding: 10px;
          font-size: 12px;
        }

        .modal-buttons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin-top: 10px;
        }

        .btn-submit-modal {
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
          gap: 8px;
          transition: transform 0.2s;
        }

        .btn-submit-modal:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .btn-submit-modal:disabled {
          background: #374151;
          color: #9ca3af;
          cursor: not-allowed;
        }

        .btn-submit-modal.btn-danger-gradient {
          background: linear-gradient(135deg, #ef4444, #b91c1c);
        }

        .btn-cancel-modal {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.08);
          color: #9ca3af;
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-cancel-modal:hover {
          color: #fff;
          background: rgba(255,255,255,0.08);
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
      `}</style>
    </div>
  );
}
