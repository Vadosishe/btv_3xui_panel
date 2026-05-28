'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail, AlertTriangle, ArrowRight, Loader } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        router.push('/dashboard');
        router.refresh();
      } else {
        setError(data.error || 'Неверный email или пароль');
      }
    } catch (err) {
      setError('Ошибка сети. Проверьте соединение с сервером.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      
      {/* --- СТИЛИ ДЛЯ ЛОГИНА --- */}
      <style jsx>{`
        .login-container {
          width: 100vw;
          min-height: 100vh;
          background: radial-gradient(circle at center, #111827 0%, #030712 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          box-sizing: border-box;
          position: relative;
          overflow: hidden;
        }

        /* Декоративное неоновое размытие */
        .neon-glow {
          position: absolute;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(6, 182, 212, 0.12) 0%, rgba(168, 85, 247, 0.08) 50%, rgba(0, 0, 0, 0) 100%);
          border-radius: 50%;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1;
        }

        .login-card {
          max-width: 420px;
          width: 100%;
          background: rgba(17, 24, 39, 0.7);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
          z-index: 2;
          position: relative;
        }

        .logo-header {
          text-align: center;
          margin-bottom: 30px;
        }

        .logo {
          font-size: 26px;
          font-weight: 800;
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .sub-logo {
          font-size: 12px;
          color: #9ca3af;
          margin-top: 6px;
          font-weight: 500;
        }

        .form-group {
          margin-bottom: 20px;
          position: relative;
        }

        .form-label {
          display: block;
          font-size: 12px;
          color: #9ca3af;
          margin-bottom: 8px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: 15px;
          color: #6b7280;
          pointer-events: none;
        }

        .form-input {
          width: 100%;
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 12px 15px 12px 45px;
          color: #f3f4f6;
          font-size: 14px;
          transition: all 0.2s ease;
        }

        .form-input:focus {
          border-color: #06b6d4;
          box-shadow: 0 0 10px rgba(6, 182, 212, 0.15);
          background: rgba(0, 0, 0, 0.45);
        }

        .btn-submit {
          width: 100%;
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          color: #fff;
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
          transition: all 0.2s ease;
          box-shadow: 0 4px 15px rgba(6, 182, 212, 0.25);
          margin-top: 25px;
        }

        .btn-submit:hover {
          transform: translateY(-1px);
          opacity: 0.95;
          box-shadow: 0 6px 20px rgba(6, 182, 212, 0.35);
        }

        .btn-submit:active {
          transform: translateY(0);
        }

        .btn-submit:disabled {
          background: #374151;
          color: #9ca3af;
          cursor: not-allowed;
          box-shadow: none;
          transform: none;
        }

        .error-alert {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 10px;
          color: #f87171;
          padding: 12px 15px;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
        }

        /* Информационный бокс первого входа */
        .info-box {
          background: rgba(6, 182, 212, 0.06);
          border: 1px solid rgba(6, 182, 212, 0.15);
          border-radius: 10px;
          padding: 12px 15px;
          font-size: 11px;
          color: #06b6d4;
          line-height: 1.5;
          margin-top: 25px;
          text-align: center;
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="neon-glow" />

      <div className="login-card">
        <div className="logo-header">
          <div className="logo">BTW VPN SERVICE</div>
          <div className="sub-logo">БИЗНЕС-ПАНЕЛЬ УПРАВЛЕНИЯ VPN</div>
        </div>

        {error && (
          <div className="error-alert">
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email адрес</label>
            <div className="input-wrapper">
              <Mail size={16} className="input-icon" />
              <input
                type="email"
                className="form-input"
                placeholder="admin@btw.vpn"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '10px' }}>
            <label className="form-label">Пароль</label>
            <div className="input-wrapper">
              <Lock size={16} className="input-icon" />
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="btn-submit" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader size={16} className="spinner" />
                <span>Вход...</span>
              </>
            ) : (
              <>
                <span>Войти в систему</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="info-box">
          <strong>Первый запуск?</strong><br />
          Просто введите email <code>admin@btw.vpn</code> и пароль <code>admin</code> для автоматического создания первой учетной записи.
        </div>
      </div>
    </div>
  );
}
