'use html';
'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon,
  Server,
  Link as LinkIcon,
  Download,
  Bell,
  Save,
  AlertTriangle,
  Loader,
  CheckCircle,
  HelpCircle,
} from 'lucide-react';

export default function SettingsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Поля настроек
  const [xuiScheme, setXuiScheme] = useState('http');
  const [xuiAddress, setXuiAddress] = useState('localhost');
  const [xuiPort, setXuiPort] = useState('2053');
  const [xuiBasePath, setXuiBasePath] = useState('/');
  const [xuiApiToken, setXuiApiToken] = useState('');
  const [btwSupportLink, setBtwSupportLink] = useState('');
  const [appPanelUrl, setAppPanelUrl] = useState('');
  
  // Telegram Алерт
  const [tgBotToken, setTgBotToken] = useState('');
  const [tgAdminChatIds, setTgAdminChatIds] = useState('');
  const [syncInterval, setSyncInterval] = useState('15');

  // Состояние проверки связи
  const [isTesting, setIsTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

  // Загрузить текущие настройки
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch('/api/admin/settings');
        if (res.ok) {
          const data = await res.json();
          const s = data.settings || {};

          setXuiScheme(s.xui_scheme || 'http');
          setXuiAddress(s.xui_address || '');
          setXuiPort(s.xui_port || '2053');
          setXuiBasePath(s.xui_base_path || '/');
          setXuiApiToken(s.xui_api_token || '');
          setBtwSupportLink(s.btw_support_link || '');
          setAppPanelUrl(s.app_panel_url || '');
          
          setTgBotToken(s.tg_bot_token || '');
          setTgAdminChatIds(s.tg_admin_chat_ids || '');
          setSyncInterval(s.sync_interval_minutes || '15');
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  // Сохранить настройки
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      xui_scheme: xuiScheme.trim(),
      xui_address: xuiAddress.trim(),
      xui_port: xuiPort.trim(),
      xui_base_path: xuiBasePath.trim(),
      xui_api_token: xuiApiToken.trim(),
      btw_support_link: btwSupportLink.trim(),
      app_panel_url: appPanelUrl.trim(),
      tg_bot_token: tgBotToken.trim(),
      tg_admin_chat_ids: tgAdminChatIds.trim(),
      sync_interval_minutes: syncInterval.trim(),
    };

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess('Настройки успешно обновлены и сохранены в PostgreSQL!');
        // Скроллим вверх для отображения плашки успеха
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setError(data.error || 'Ошибка при сохранении настроек');
      }
    } catch (err) {
      setError('Ошибка сети. Проверьте соединение с сервером.');
    } finally {
      setIsSaving(false);
    }
  };

  // Проверить связь с 3XUI
  const handleTestConnection = async () => {
    if (isTesting) return;
    setIsTesting(true);
    setTestError(null);
    setTestSuccess(null);

    const payload = {
      scheme: xuiScheme.trim(),
      address: xuiAddress.trim(),
      port: xuiPort.trim(),
      basePath: xuiBasePath.trim(),
      apiToken: xuiApiToken.trim(),
    };

    try {
      const res = await fetch('/api/admin/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setTestSuccess(data.message || 'Соединение успешно проверено!');
      } else {
        setTestError(data.error || 'Не удалось подключиться к панели 3XUI.');
      }
    } catch (err) {
      setTestError('Ошибка сети при проверке связи. Убедитесь, что сервер доступен.');
    } finally {
      setIsTesting(false);
    }
  };

  // Скачать резервную копию базы
  const handleDownloadBackup = () => {
    window.open('/api/admin/backup', '_blank');
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: '#9ca3af' }}>
        <Loader className="spinner" size={24} style={{ color: '#06b6d4' }} />
        <span style={{ marginLeft: '10px' }}>Загрузка конфигурации...</span>
      </div>
    );
  }

  return (
    <div className="settings-container">
      
      {/* --- СТИЛИ СТРАНИЦЫ --- */}
      <style jsx>{`
        .settings-container {
          display: flex;
          flex-direction: column;
          gap: 25px;
          max-width: 800px;
          margin: 0 auto;
        }

        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 25px;
        }

        .settings-section {
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .section-header {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 12px;
        }

        .section-icon {
          color: #06b6d4;
        }

        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        @media (max-width: 600px) {
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
          letter-spacing: 0.5px;
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

        .help-text {
          font-size: 11px;
          color: #6b7280;
          line-height: 1.4;
        }

        .btn-submit {
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          color: #white;
          border: none;
          padding: 14px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: transform 0.2s;
          box-shadow: 0 4px 15px rgba(6, 182, 212, 0.2);
        }

        .btn-submit:hover {
          transform: translateY(-1px);
        }

        .btn-backup {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #e5e7eb;
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          transition: all 0.2s;
        }

        .btn-backup:hover {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
        }

        .btn-test-connection {
          background: rgba(6, 182, 212, 0.1);
          border: 1px solid rgba(6, 182, 212, 0.3);
          color: #06b6d4;
          padding: 12px 18px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
        }

        .btn-test-connection:hover {
          background: rgba(6, 182, 212, 0.2);
          border-color: #06b6d4;
          color: #fff;
        }

        .btn-test-connection:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .alert-error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 10px;
          color: #f87171;
          padding: 12px 15px;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .alert-success {
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
          border-radius: 10px;
          color: #34d399;
          padding: 12px 15px;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .spinner { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Сообщения об успешности / ошибке */}
      {error && (
        <div className="alert-error">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="alert-success">
          <CheckCircle size={18} />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="settings-form">
        
        {/* --- СЕКЦИЯ 1: ПОДКЛЮЧЕНИЕ К API 3XUI --- */}
        <div className="settings-section glass-panel">
          <div className="section-header">
            <Server size={18} className="section-icon" />
            <span>Панель 3XUI (Нидерланды BTW Главный)</span>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Схема (Протокол)</label>
              <select
                className="form-input"
                value={xuiScheme}
                onChange={(e) => setXuiScheme(e.target.value)}
                style={{ appearance: 'none', background: 'rgba(0,0,0,0.3) url("data:image/svg+xml;utf8,<svg fill=\'%23ffffff\' height=\'24\' viewBox=\'0 0 24 24\' width=\'24\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M7 10l5 5 5-5z\'/><path d=\'M0 0h24v24H0z\' fill=\'none\'/></svg>") no-repeat right 12px center' }}
              >
                <option value="http" style={{ background: '#111827', color: '#fff' }}>http</option>
                <option value="https" style={{ background: '#111827', color: '#fff' }}>https</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Адрес / IP сервера</label>
              <input
                type="text"
                className="form-input"
                placeholder="nl.vsubbotin.com"
                value={xuiAddress}
                onChange={(e) => setXuiAddress(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Порт</label>
              <input
                type="text"
                className="form-input"
                placeholder="30530"
                value={xuiPort}
                onChange={(e) => setXuiPort(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Базовый путь (Base Path)</label>
              <input
                type="text"
                className="form-input"
                placeholder="/mBywdOSDVfbWb3Hp6x"
                value={xuiBasePath}
                onChange={(e) => setXuiBasePath(e.target.value)}
                required
              />
              <span className="help-text">
                Если панель защищена путем (например, /mBywdOSDVfbWb3Hp6x), укажите его. Иначе оставьте /
              </span>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">API Токен 3XUI (Bearer token)</label>
            <input
              type="text"
              className="form-input"
              placeholder="74Wq3lsLAiPrkhElAELYtxdpawxyvbZfcuEPk2GQZS6AQvkz"
              value={xuiApiToken}
              onChange={(e) => setXuiApiToken(e.target.value)}
              required
            />
            <span className="help-text">
              API-токен генерируется в панели 3XUI (Settings → Security → API Tokens). Авторизация по токенам обходит сессионные куки и CSRF, делая связь на 100% стабильной.
            </span>
          </div>

          {/* Результаты тестирования связи локально в блоке */}
          {testError && (
            <div className="alert-error" style={{ marginTop: '10px' }}>
              <AlertTriangle size={16} />
              <span>{testError}</span>
            </div>
          )}

          {testSuccess && (
            <div className="alert-success" style={{ marginTop: '10px' }}>
              <CheckCircle size={16} />
              <span>{testSuccess}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: '10px' }}>
            <button
              type="button"
              className="btn-test-connection"
              onClick={handleTestConnection}
              disabled={isTesting}
            >
              {isTesting ? (
                <Loader size={16} className="spinner" />
              ) : (
                <Server size={16} />
              )}
              <span>{isTesting ? 'Проверка...' : 'Проверить связь'}</span>
            </button>
          </div>
        </div>



        {/* --- СЕКЦИЯ 3: ОБЩИЕ БИЗНЕС НАСТРОЙКИ --- */}
        <div className="settings-section glass-panel">
          <div className="section-header">
            <LinkIcon size={18} className="section-icon" />
            <span>Общие Бизнес-Настройки</span>
          </div>

          <div className="form-group">
            <label className="form-label">URL-адрес этой Бизнес-Панели</label>
            <input
              type="url"
              className="form-input"
              placeholder="http://your-panel-domain-or-ip:3000"
              value={appPanelUrl}
              onChange={(e) => setAppPanelUrl(e.target.value)}
              required
            />
            <span className="help-text">
              Используется для генерации умных ссылок подписки сотрудников.
            </span>
          </div>

          <div className="form-group">
            <label className="form-label">Ссылка на техподдержку (Telegram)</label>
            <input
              type="url"
              className="form-input"
              placeholder="https://t.me/btw_support_bot"
              value={btwSupportLink}
              onChange={(e) => setBtwSupportLink(e.target.value)}
              required
            />
            <span className="help-text">
              Отображается на персональной веб-странице клиента в случае окончания лимитов или блокировки.
            </span>
          </div>
        </div>

        {/* --- СЕКЦИЯ 4: TELEGRAM УВЕДОМЛЕНИЯ И СИНХРОНИЗАЦИЯ --- */}
        <div className="settings-section glass-panel">
          <div className="section-header">
            <Bell size={18} className="section-icon" style={{ color: '#a855f7' }} />
            <span>Telegram Оповещения & Авто-синхронизация</span>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">Токен бота Telegram (Алертер)</label>
              <input
                type="text"
                className="form-input"
                placeholder="8760402136:AAG..."
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">ID чатов админов (через запятую)</label>
              <input
                type="text"
                className="form-input"
                placeholder="203455295, 430127463"
                value={tgAdminChatIds}
                onChange={(e) => setTgAdminChatIds(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Интервал авто-синхронизации трафика (в минутах)</label>
            <input
              type="number"
              className="form-input"
              min="5"
              max="1440"
              value={syncInterval}
              onChange={(e) => setSyncInterval(e.target.value)}
              required
            />
            <span className="help-text">
              Как часто панель в фоновом режиме будет опрашивать 3XUI сервер и обновлять трафик в PostgreSQL.
            </span>
          </div>
        </div>

        {/* --- СЕКЦИЯ 5: РЕЗЕРВНОЕ КОПИРОВАНИЕ --- */}
        <div className="settings-section glass-panel">
          <div className="section-header">
            <Download size={18} className="section-icon" />
            <span>Резервное копирование данных (Backup)</span>
          </div>
          
          <span className="help-text" style={{ marginTop: '-10px' }}>
            Экспортируйте полную базу данных (администраторы, компании, клиенты, настройки, логи) в один JSON файл. Это гарантирует сохранность при сбое или переносе системы.
          </span>

          <button 
            type="button" 
            className="btn-backup" 
            onClick={handleDownloadBackup}
          >
            <Download size={16} />
            <span>Скачать резервную копию базы (.json)</span>
          </button>
        </div>

        {/* Кнопка сохранения формы */}
        <button type="submit" className="btn-submit" disabled={isSaving}>
          {isSaving ? <Loader size={18} className="spinner" /> : <Save size={18} />}
          <span>{isSaving ? 'Сохранение изменений...' : 'Сохранить все настройки'}</span>
        </button>

      </form>
    </div>
  );
}
