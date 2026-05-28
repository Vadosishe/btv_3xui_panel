'use client';

import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Plus,
  Trash2,
  Edit2,
  Check,
  Globe,
  Clock,
  HardDrive,
  Users,
  AlertTriangle,
  Loader,
} from 'lucide-react';

interface Template {
  id: string;
  name: string;
  description: string | null;
  inboundIdsJson: string; // "[1, 2]"
  trafficLimitGB: number;
  limitIp: number;
  durationDays: number;
  flow?: string | null;
  _count?: { clients: number };
}

interface Inbound {
  id: number;
  remark: string;
  port: number;
  protocol: string;
  nodeId: number;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [inbounds, setInbounds] = useState<Inbound[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Форма добавления/редактирования
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [trafficLimitGB, setTrafficLimitGB] = useState<number>(0);
  const [limitIp, setLimitIp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [flow, setFlow] = useState('');
  const [selectedInboundIds, setSelectedInboundIds] = useState<number[]>([]);
  
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Подгрузка данных (шаблоны + инбаунды)
  const loadData = async () => {
    try {
      const [tplRes, inRes] = await Promise.all([
        fetch('/api/admin/templates'),
        fetch('/api/admin/inbounds'),
      ]);

      if (tplRes.ok && inRes.ok) {
        const tplData = await tplRes.json();
        const inData = await inRes.json();

        setTemplates(tplData.templates || []);
        setInbounds(inData.inbounds || []);
      }
    } catch (e) {
      console.error('Failed to load data:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openAddModal = () => {
    setEditingId(null);
    setName('');
    setDescription('');
    setTrafficLimitGB(0);
    setLimitIp(0);
    setDurationDays(30);
    setFlow('');
    setSelectedInboundIds([]);
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (template: Template) => {
    setEditingId(template.id);
    setName(template.name);
    setDescription(template.description || '');
    setTrafficLimitGB(template.trafficLimitGB);
    setLimitIp(template.limitIp);
    setDurationDays(template.durationDays);
    setFlow(template.flow || '');
    
    try {
      setSelectedInboundIds(JSON.parse(template.inboundIdsJson));
    } catch (e) {
      setSelectedInboundIds([]);
    }
    setError(null);
    setIsModalOpen(true);
  };

  const toggleInboundSelection = (id: number) => {
    if (selectedInboundIds.includes(id)) {
      setSelectedInboundIds(selectedInboundIds.filter(x => x !== id));
    } else {
      setSelectedInboundIds([...selectedInboundIds, id]);
    }
  };

  // Сохранить изменения
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError(null);

    if (selectedInboundIds.length === 0) {
      setError('Необходимо выбрать хотя бы одно входящее подключение (Inbound)');
      setIsSaving(false);
      return;
    }

    const url = editingId ? `/api/admin/templates/${editingId}` : '/api/admin/templates';
    const method = editingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          inboundIds: selectedInboundIds,
          trafficLimitGB,
          limitIp,
          durationDays,
          flow,
        }),
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

  // Удаление шаблона
  const handleDelete = async (id: string, templateName: string) => {
    const confirmed = window.confirm(`Вы действительно хотите удалить шаблон "${templateName}"?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/admin/templates/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        loadData();
      } else {
        alert(data.error || 'Ошибка при удалении');
      }
    } catch (e) {
      alert('Ошибка подключения к серверу.');
    }
  };

  return (
    <div className="templates-container">
      
      {/* --- СТИЛИ СТРАНИЦЫ --- */}
      <style jsx>{`
        .templates-container {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .action-bar {
          display: flex;
          justify-content: flex-end;
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

        /* Таблица шаблонов */
        .template-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 20px;
        }

        .template-card {
          padding: 24px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          min-height: 250px;
        }

        .template-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px;
        }

        .template-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .template-desc {
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.5;
          margin-bottom: 20px;
          flex-grow: 1;
        }

        /* Параметры лимитов в карточке */
        .limits-row {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          background: var(--border-color);
          border: 1px solid var(--border-color);
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 20px;
        }

        .limit-box {
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .limit-icon {
          display: flex;
          justify-content: center;
          color: var(--text-muted);
        }

        .limit-val {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .limit-lbl {
          font-size: 9px;
          color: var(--text-muted);
          text-transform: uppercase;
          font-weight: 500;
        }

        .inbounds-summary {
          font-size: 11px;
          color: var(--text-muted);
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .template-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-top: 1px solid var(--border-color);
          padding-top: 15px;
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

        /* Модалка */
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
          max-width: 580px;
          width: 100%;
          padding: 30px;
          box-shadow: 0 15px 40px rgba(0,0,0,0.5);
          display: flex;
          flex-direction: column;
          gap: 20px;
          max-height: 90vh;
          overflow-y: auto;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 18px;
          font-weight: 700;
          color: #fff;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 15px;
        }

        @media (max-width: 500px) {
          .form-grid {
            grid-template-columns: 1fr;
          }
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

        /* Выбор инбаундов в модалке */
        .inbounds-selector-title {
          font-size: 12px;
          font-weight: 600;
          color: #9ca3af;
          text-transform: uppercase;
          margin-bottom: 10px;
        }

        .inbounds-list-box {
          background: rgba(0,0,0,0.25);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 12px;
          padding: 15px;
          max-height: 180px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .inbound-select-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.04);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .inbound-select-item:hover {
          background: rgba(255,255,255,0.05);
        }

        .inbound-select-item.selected {
          border-color: rgba(6, 182, 212, 0.4);
          background: rgba(6, 182, 212, 0.05);
        }

        .inbound-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .inbound-name {
          font-size: 13px;
          font-weight: 600;
          color: #e5e7eb;
        }

        .inbound-meta {
          font-size: 10px;
          color: #6b7280;
        }

        .inbound-checkbox {
          width: 18px;
          height: 18px;
          border-radius: 4px;
          border: 1px solid rgba(255,255,255,0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #06b6d4;
        }

        .inbound-checkbox.selected {
          background: #06b6d4;
          border-color: #06b6d4;
          color: #fff;
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

      {/* Панель добавления */}
      <div className="action-bar">
        <button className="btn-add" onClick={openAddModal}>
          <Plus size={16} />
          <span>Создать шаблон</span>
        </button>
      </div>

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: '#9ca3af' }}>
          <Loader className="spinner" size={24} style={{ color: '#06b6d4' }} />
          <span style={{ marginLeft: '10px' }}>Загрузка шаблонов...</span>
        </div>
      ) : templates.length > 0 ? (
        <div className="template-grid">
          {templates.map((tpl) => {
            let inboundIdsCount = 0;
            try {
              inboundIdsCount = JSON.parse(tpl.inboundIdsJson).length;
            } catch (e) {}

            return (
              <div key={tpl.id} className="template-card glass-panel">
                <div className="template-header">
                  <div className="template-title">{tpl.name}</div>
                  <Sliders size={18} style={{ color: '#a855f7' }} />
                </div>

                <div className="template-desc">
                  {tpl.description || 'Описание отсутствует.'}
                </div>

                {/* Блок лимитов */}
                <div className="limits-row">
                  <div className="limit-box">
                    <div className="limit-icon"><HardDrive size={14} /></div>
                    <div className="limit-val">{tpl.trafficLimitGB > 0 ? `${tpl.trafficLimitGB} GB` : 'Безлимит'}</div>
                    <div className="limit-lbl">Трафик</div>
                  </div>
                  <div className="limit-box">
                    <div className="limit-icon"><Globe size={14} /></div>
                    <div className="limit-val">{tpl.limitIp > 0 ? `${tpl.limitIp} IP` : 'Безлимит'}</div>
                    <div className="limit-lbl">Устройства</div>
                  </div>
                  <div className="limit-box">
                    <div className="limit-icon"><Clock size={14} /></div>
                    <div className="limit-val">{tpl.durationDays > 0 ? `${tpl.durationDays} дн.` : 'Безлимит'}</div>
                    <div className="limit-lbl">Период</div>
                  </div>
                </div>

                <div className="inbounds-summary">
                  <span className="pulse-indicator" style={{ width: '6px', height: '6px' }} />
                  <span>Привязано инбаундов 3XUI: <strong>{inboundIdsCount}</strong></span>
                </div>

                <div className="template-footer">
                  <div style={{ fontSize: '11px', color: '#6b7280' }}>
                    Клиентов: <strong style={{ color: '#06b6d4' }}>{tpl._count?.clients || 0}</strong>
                  </div>

                  <div className="card-actions">
                    <button className="action-icon" onClick={() => openEditModal(tpl)} title="Редактировать">
                      <Edit2 size={14} />
                    </button>
                    <button className="action-icon action-delete" onClick={() => handleDelete(tpl.id, tpl.name)} title="Удалить">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="no-data" style={{ padding: '60px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>
          Шаблоны не найдены. Создайте первый шаблон кнопкой выше!
        </div>
      )}

      {/* --- МОДАЛЬНОЕ ОКНО ДОБАВЛЕНИЯ / РЕДАКТИРОВАНИЯ --- */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span>{editingId ? 'Редактировать шаблон' : 'Создать новый шаблон'}</span>
            </div>

            {error && (
              <div className="alert-error">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              <div className="form-group">
                <label className="form-label">Название шаблона</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Например: Premium EU + RU (Reality)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Описание</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Например: Доступ к EU и RU серверам Reality VLESS"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              {/* Настройка лимитов в строке */}
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">Лимит трафика (GB)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    placeholder="0 - безлимит"
                    value={trafficLimitGB}
                    onChange={(e) => setTrafficLimitGB(Number(e.target.value))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Лимит IP-адресов</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    placeholder="0 - безлимит"
                    value={limitIp}
                    onChange={(e) => setLimitIp(Number(e.target.value))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Срок действия (дней)</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    placeholder="0 - безлимит"
                    value={durationDays}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Параметр Flow (VLESS Reality)</label>
                <select
                  className="form-input"
                  value={flow}
                  onChange={(e) => setFlow(e.target.value)}
                  style={{ appearance: 'none', background: 'rgba(0,0,0,0.3) url("data:image/svg+xml;utf8,<svg fill=\'%23ffffff\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/><path d=\'M0 0h24v24H0z\' fill=\'none\'/></svg>") no-repeat right 12px center' }}
                >
                  <option value="" style={{ background: '#111827', color: '#fff' }}>Без Flow (По умолчанию)</option>
                  <option value="xtls-rprx-vision" style={{ background: '#111827', color: '#fff' }}>xtls-rprx-vision (Рекомендуется для Reality)</option>
                </select>
                <span className="help-text" style={{ fontSize: '10px', marginTop: '2px', color: '#6b7280' }}>
                  Для Reality VLESS укажите xtls-rprx-vision. Для остальных протоколов оставьте пустым.
                </span>
              </div>

              {/* Секция выбора инбаундов с 3XUI */}
              <div className="form-group">
                <div className="inbounds-selector-title">Выберите входящие подключения (Inbounds) из 3XUI</div>
                
                {inbounds.length > 0 ? (
                  <div className="inbounds-list-box">
                    {inbounds.map((inbound) => {
                      const isSelected = selectedInboundIds.includes(inbound.id);
                      return (
                        <div 
                          key={inbound.id} 
                          className={`inbound-select-item ${isSelected ? 'selected' : ''}`}
                          onClick={() => toggleInboundSelection(inbound.id)}
                        >
                          <div className="inbound-details">
                            <span className="inbound-name">{inbound.remark || 'Без названия'}</span>
                            <span className="inbound-meta">
                              Протокол: <strong>{inbound.protocol.toUpperCase()}</strong> | Порт: {inbound.port} | Нода: {inbound.nodeId}
                            </span>
                          </div>
                          <div className={`inbound-checkbox ${isSelected ? 'selected' : ''}`}>
                            {isSelected ? <Check size={12} /> : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="no-data" style={{ padding: '20px', background: 'rgba(0,0,0,0.15)', borderRadius: '10px' }}>
                    Не удалось загрузить инбаунды с главного сервера 3XUI. Убедитесь, что сервер работает и учетные данные в настройках верны.
                  </div>
                )}
              </div>

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
    </div>
  );
}
