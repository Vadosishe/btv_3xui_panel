'use client';

import React, { useState } from 'react';
import { Mail, User, Send, MessageSquare, CheckCircle, AlertCircle, Search, Clipboard, ExternalLink, Download } from 'lucide-react';

export default function RequestPage() {
  const [activeTab, setActiveTab] = useState<'apply' | 'status'>('apply');
  
  // Apply Form State
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [telegram, setTelegram] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Status Lookup State
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{
    searched: boolean;
    status?: 'PENDING' | 'APPROVED' | 'DENIED';
    adminNote?: string;
    subscriptionToken?: string;
    error?: string;
  } | null>(null);
  
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, telegram, description }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Произошла ошибка при отправке заявки');
        return;
      }

      setSuccess(true);
    } catch {
      setError('Не удалось подключиться к серверу. Попробуйте позже.');
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lookupEmail) return;

    setLookupLoading(true);
    setLookupResult(null);

    try {
      const res = await fetch(`/api/request?email=${encodeURIComponent(lookupEmail.trim())}`);
      const data = await res.json();

      if (res.ok && data.success) {
        setLookupResult({
          searched: true,
          status: data.status,
          adminNote: data.adminNote,
          subscriptionToken: data.subscriptionToken
        });
      } else {
        setLookupResult({
          searched: true,
          error: data.error || 'Заявка с таким email не найдена'
        });
      }
    } catch {
      setLookupResult({
        searched: true,
        error: 'Ошибка при связи с сервером'
      });
    } finally {
      setLookupLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Get current hostname in browser
  const getSubLink = (token: string) => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/api/sub/${token}`;
  };

  return (
    <>
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap');
      `}</style>
      <style jsx>{`
        .page-wrapper {
          width: 100vw;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at center, #111827 0%, #030712 100%);
          font-family: 'Outfit', sans-serif;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }

        .glow-orb {
          position: absolute;
          width: 600px;
          height: 600px;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, rgba(168, 85, 247, 0.08) 50%, transparent 100%);
          pointer-events: none;
          z-index: 0;
        }

        .card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 480px;
          background: rgba(17, 24, 39, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
        }

        .logo {
          text-align: center;
          margin-bottom: 8px;
        }

        .logo-text {
          font-size: 26px;
          font-weight: 800;
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .subtitle {
          text-align: center;
          font-size: 12px;
          color: #9ca3af;
          margin-bottom: 24px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          font-weight: 500;
        }

        /* Tabs System */
        .tabs-header {
          display: grid;
          grid-template-columns: 1fr 1fr;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          padding: 4px;
          margin-bottom: 28px;
        }

        .tab-btn {
          background: transparent;
          border: none;
          color: #9ca3af;
          font-size: 13px;
          font-weight: 600;
          padding: 10px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-family: 'Outfit', sans-serif;
        }

        .tab-btn.active {
          background: rgba(255, 255, 255, 0.08);
          color: #fff;
          box-shadow: 0 4px 10px rgba(0,0,0,0.15);
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-label {
          display: block;
          font-size: 11px;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .input-wrapper {
          position: relative;
        }

        .input-icon {
          position: absolute;
          left: 15px;
          top: 50%;
          transform: translateY(-50%);
          color: #6b7280;
          pointer-events: none;
          display: flex;
          align-items: center;
        }

        .textarea-icon {
          position: absolute;
          left: 15px;
          top: 14px;
          color: #6b7280;
          pointer-events: none;
          display: flex;
          align-items: center;
        }

        .form-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 12px 15px 12px 45px;
          color: #f3f4f6;
          font-size: 14px;
          font-family: 'Outfit', sans-serif;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          box-sizing: border-box;
        }

        .form-input:focus {
          border-color: #06b6d4;
          box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
        }

        .form-input::placeholder {
          color: #4b5563;
        }

        .form-textarea {
          width: 100%;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 12px 15px 12px 45px;
          color: #f3f4f6;
          font-size: 14px;
          font-family: 'Outfit', sans-serif;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          resize: vertical;
          min-height: 80px;
          box-sizing: border-box;
        }

        .form-textarea:focus {
          border-color: #06b6d4;
          box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
        }

        .form-textarea::placeholder {
          color: #4b5563;
        }

        .error-alert {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          color: #f87171;
          padding: 12px;
          border-radius: 10px;
          font-size: 13px;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .submit-btn {
          width: 100%;
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          color: #fff;
          padding: 14px;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          font-family: 'Outfit', sans-serif;
          cursor: pointer;
          box-shadow: 0 4px 15px rgba(6, 182, 212, 0.25);
          transition: transform 0.2s ease, box-shadow 0.2s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(6, 182, 212, 0.35);
        }

        .submit-btn:disabled {
          background: #374151;
          color: #9ca3af;
          cursor: not-allowed;
          box-shadow: none;
          transform: none;
        }

        .spinner {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .success-card {
          background: rgba(16, 185, 129, 0.08);
          border: 1px solid rgba(16, 185, 129, 0.15);
          border-radius: 16px;
          padding: 30px;
          text-align: center;
        }

        .success-icon {
          color: #10b981;
          margin-bottom: 16px;
        }

        .success-title {
          font-size: 20px;
          font-weight: 700;
          color: #10b981;
          margin-bottom: 10px;
        }

        .success-text {
          font-size: 13px;
          color: #9ca3af;
          line-height: 1.6;
        }

        .info-box {
          background: rgba(6, 182, 212, 0.06);
          border: 1px solid rgba(6, 182, 212, 0.15);
          border-radius: 10px;
          padding: 12px;
          font-size: 11px;
          color: #06b6d4;
          text-align: center;
          margin-top: 24px;
          line-height: 1.5;
        }

        .required-mark {
          color: #f87171;
          margin-left: 2px;
        }

        /* Lookup status styles */
        .status-box {
          border-radius: 12px;
          padding: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          margin-top: 10px;
        }

        .status-box.PENDING {
          background: rgba(245, 158, 11, 0.08);
          border-color: rgba(245, 158, 11, 0.15);
        }

        .status-box.DENIED {
          background: rgba(239, 68, 68, 0.08);
          border-color: rgba(239, 68, 68, 0.15);
        }

        .status-box.APPROVED {
          background: rgba(16, 185, 129, 0.08);
          border-color: rgba(16, 185, 129, 0.15);
        }

        .status-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          font-weight: 700;
          font-size: 15px;
        }

        .status-badge {
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
          padding: 4px 10px;
          border-radius: 20px;
          letter-spacing: 0.5px;
        }

        .status-badge.PENDING {
          background: rgba(245, 158, 11, 0.15);
          color: #fbbf24;
        }

        .status-badge.DENIED {
          background: rgba(239, 68, 68, 0.15);
          color: #f87171;
        }

        .status-badge.APPROVED {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
        }

        .status-desc {
          font-size: 13px;
          color: #9ca3af;
          line-height: 1.5;
        }

        /* Approved token UI */
        .approved-action-box {
          margin-top: 15px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .token-input-wrapper {
          display: flex;
          gap: 10px;
        }

        .token-input {
          flex-grow: 1;
          background: rgba(0,0,0,0.4);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 10px;
          color: #fff;
          font-size: 12px;
          font-family: monospace;
          outline: none;
        }

        .btn-action-small {
          background: #374151;
          border: 1px solid rgba(255,255,255,0.08);
          color: #fff;
          border-radius: 8px;
          padding: 8px 12px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
        }

        .btn-action-small:hover {
          background: #4b5563;
        }

        .btn-action-small.btn-primary {
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          border: none;
        }

        .btn-action-small.btn-primary:hover {
          filter: brightness(1.1);
        }

        .instruction-steps {
          margin-top: 15px;
          border-top: 1px solid rgba(255,255,255,0.06);
          padding-top: 15px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .step {
          display: flex;
          gap: 10px;
          font-size: 12px;
          line-height: 1.4;
          color: #9ca3af;
        }

        .step-num {
          background: rgba(6, 182, 212, 0.15);
          color: #06b6d4;
          font-weight: 800;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 10px;
        }

        .btn-row {
          display: flex;
          gap: 10px;
          margin-top: 5px;
        }

        @media (max-width: 480px) {
          .card {
            padding: 28px 22px;
            border-radius: 16px;
          }

          .logo-text {
            font-size: 22px;
          }

          .glow-orb {
            width: 400px;
            height: 400px;
          }

          .token-input-wrapper {
            flex-direction: column;
          }
        }
      `}</style>

      <div className="page-wrapper">
        <div className="glow-orb" />
        <main className="card">
          <div className="logo">
            <span className="logo-text">⚡ BTV VPN</span>
          </div>
          <p className="subtitle">Запрос конфигурации VPN</p>

          {/* Переключатель вкладок */}
          {!success && (
            <div className="tabs-header">
              <button
                className={`tab-btn ${activeTab === 'apply' ? 'active' : ''}`}
                onClick={() => setActiveTab('apply')}
              >
                <MessageSquare size={14} />
                <span>Подать заявку</span>
              </button>
              <button
                className={`tab-btn ${activeTab === 'status' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('status');
                  setLookupResult(null);
                }}
              >
                <Search size={14} />
                <span>Проверить статус</span>
              </button>
            </div>
          )}

          {activeTab === 'apply' ? (
            success ? (
              <div className="success-card">
                <div className="success-icon">
                  <CheckCircle size={48} />
                </div>
                <div className="success-title">Заявка отправлена!</div>
                <p className="success-text">
                  Мы рассмотрим вашу заявку. Вы можете отслеживать её статус во вкладке «Проверить статус» по указанному email адресу.
                </p>
                <button
                  className="submit-btn"
                  style={{ marginTop: '20px' }}
                  onClick={() => {
                    setSuccess(false);
                    setEmail('');
                    setName('');
                    setTelegram('');
                    setDescription('');
                    setActiveTab('status');
                  }}
                >
                  Перейти к отслеживанию
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} autoComplete="off">
                {error && (
                  <div className="error-alert">
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label">
                    Email<span className="required-mark">*</span>
                  </label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Имя</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <User size={16} />
                    </span>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Ваше имя"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Telegram (опционально)</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Send size={16} />
                    </span>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="@username"
                      value={telegram}
                      onChange={(e) => setTelegram(e.target.value)}
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Описание</label>
                  <div className="input-wrapper">
                    <span className="textarea-icon">
                      <MessageSquare size={16} />
                    </span>
                    <textarea
                      className="form-textarea"
                      placeholder="Расскажите кратко, для чего вам VPN..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={loading}
                      rows={3}
                    />
                  </div>
                </div>

                <button type="submit" className="submit-btn" disabled={loading}>
                  {loading ? (
                    <>
                      <span className="spinner" />
                      Отправка...
                    </>
                  ) : (
                    'Отправить заявку'
                  )}
                </button>

                <div className="info-box">
                  После одобрения заявки вы сможете забрать вашу персональную ссылку подключения прямо здесь во вкладке отслеживания.
                </div>
              </form>
            )
          ) : (
            // Status Lookup Tab
            <div>
              <form onSubmit={handleLookup} autoComplete="off">
                <div className="form-group">
                  <label className="form-label">Введите ваш Email для проверки</label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="you@example.com"
                      value={lookupEmail}
                      onChange={(e) => setLookupEmail(e.target.value)}
                      required
                      disabled={lookupLoading}
                    />
                  </div>
                </div>

                <button type="submit" className="submit-btn" disabled={lookupLoading}>
                  {lookupLoading ? (
                    <>
                      <span className="spinner" />
                      Проверка...
                    </>
                  ) : (
                    <>
                      <Search size={16} />
                      Проверить статус
                    </>
                  )}
                </button>
              </form>

              {lookupResult && lookupResult.searched && (
                <div style={{ marginTop: '25px' }}>
                  {lookupResult.error ? (
                    <div className="error-alert" style={{ marginBottom: 0 }}>
                      <AlertCircle size={16} style={{ flexShrink: 0 }} />
                      <span>{lookupResult.error}</span>
                    </div>
                  ) : (
                    <>
                      {/* Status is PENDING */}
                      {lookupResult.status === 'PENDING' && (
                        <div className="status-box PENDING">
                          <div className="status-header-row">
                            <span>Заявка найдена</span>
                            <span className="status-badge PENDING">Ожидает</span>
                          </div>
                          <p className="status-desc">
                            Ваш запрос находится на рассмотрении у администратора. Пожалуйста, зайдите позже для проверки статуса.
                          </p>
                        </div>
                      )}

                      {/* Status is DENIED */}
                      {lookupResult.status === 'DENIED' && (
                        <div className="status-box DENIED">
                          <div className="status-header-row">
                            <span>Заявка отклонена</span>
                            <span className="status-badge DENIED">Отклонена</span>
                          </div>
                          <p className="status-desc">
                            К сожалению, ваша заявка была отклонена.
                            {lookupResult.adminNote && (
                              <span style={{ display: 'block', marginTop: '8px', fontStyle: 'italic', color: '#f87171' }}>
                                💬 Причина отказа: {lookupResult.adminNote}
                              </span>
                            )}
                          </p>
                        </div>
                      )}

                      {/* Status is APPROVED */}
                      {lookupResult.status === 'APPROVED' && lookupResult.subscriptionToken && (
                        <div className="status-box APPROVED">
                          <div className="status-header-row">
                            <span style={{ color: '#10b981' }}>VPN Готов к работе!</span>
                            <span className="status-badge APPROVED">Одобрена</span>
                          </div>
                          <p className="status-desc" style={{ marginBottom: '15px' }}>
                            Ваша заявка успешно одобрена! Вот ваша персональная ссылка подписки для подключения:
                          </p>

                          <div className="approved-action-box">
                            <div className="token-input-wrapper">
                              <input
                                type="text"
                                readOnly
                                className="token-input"
                                value={getSubLink(lookupResult.subscriptionToken)}
                                onClick={(e) => (e.target as HTMLInputElement).select()}
                              />
                              <button
                                className="btn-action-small btn-primary"
                                onClick={() => copyToClipboard(getSubLink(lookupResult.subscriptionToken!))}
                              >
                                <Clipboard size={14} />
                                <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
                              </button>
                            </div>

                            <div className="instruction-steps">
                              <div style={{ fontSize: '11px', fontWeight: 700, color: '#fff', textTransform: 'uppercase', marginBottom: '5px' }}>
                                Простая инструкция по настройке:
                              </div>
                              
                              <div className="step">
                                <div className="step-num">1</div>
                                <div>Скопируйте вашу ссылку подписки кнопкой выше.</div>
                              </div>

                              <div className="step">
                                <div className="step-num">2</div>
                                <div>
                                  Скачайте приложение <b>Happ - Proxy Utility</b>:
                                  <div className="btn-row">
                                    <a
                                      href="https://www.happ.su/main"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn-action-small"
                                      style={{ padding: '4px 8px', fontSize: '10px' }}
                                    >
                                      <Download size={10} />
                                      Скачать Happ
                                    </a>
                                    <a
                                      href="https://amnezia.org/ru"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="btn-action-small"
                                      style={{ padding: '4px 8px', fontSize: '10px' }}
                                    >
                                      <ExternalLink size={10} />
                                      AmneziaVPN
                                    </a>
                                  </div>
                                </div>
                              </div>

                              <div className="step">
                                <div className="step-num">3</div>
                                <div>
                                  Откройте приложение <b>Happ</b> — оно автоматически распознает ссылку подписки в буфере обмена. Подтвердите добавление и нажмите круглую кнопку в центре!
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
