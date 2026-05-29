'use client';

import React, { useState } from 'react';
import { Mail, User, Send, MessageSquare, CheckCircle, AlertCircle } from 'lucide-react';

export default function RequestPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [telegram, setTelegram] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

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
          max-width: 440px;
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
          margin-bottom: 32px;
          text-transform: uppercase;
          letter-spacing: 1.5px;
          font-weight: 500;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-label {
          display: block;
          font-size: 12px;
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
          font-size: 15px;
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
          background: rgba(16, 185, 129, 0.1);
          border: 1px solid rgba(16, 185, 129, 0.2);
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
          font-size: 14px;
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
        }
      `}</style>

      <div className="page-wrapper">
        <div className="glow-orb" />
        <main className="card">
          <div className="logo">
            <span className="logo-text">⚡ BTV VPN</span>
          </div>
          <p className="subtitle">Запрос конфигурации VPN</p>

          {success ? (
            <div className="success-card">
              <div className="success-icon">
                <CheckCircle size={48} />
              </div>
              <div className="success-title">Заявка отправлена!</div>
              <p className="success-text">
                Мы рассмотрим вашу заявку и свяжемся с вами по указанным контактам.
              </p>
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
                <label className="form-label">Telegram</label>
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
                После одобрения заявки вы получите персональную конфигурацию для подключения к VPN.
              </div>
            </form>
          )}
        </main>
      </div>
    </>
  );
}
