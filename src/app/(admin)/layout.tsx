'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  Sliders,
  Users,
  Settings as SettingsIcon,
  LogOut,
  RefreshCw,
  Menu,
  X,
  History,
} from 'lucide-react';

interface AdminInfo {
  id: string;
  email: string;
  name: string;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  
  const [admin, setAdmin] = useState<AdminInfo | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [xuiStatus, setXuiStatus] = useState<'online' | 'offline'>('online');

  // Меню навигации
  const navItems = [
    { name: 'Дашборд', path: '/dashboard', icon: LayoutDashboard },
    { name: 'Компании', path: '/companies', icon: Building2 },
    { name: 'Шаблоны', path: '/templates', icon: Sliders },
    { name: 'Клиенты', path: '/clients', icon: Users },
    { name: 'Логи аудита', path: '/audit', icon: History },
    { name: 'Настройки', path: '/settings', icon: SettingsIcon },
  ];

  useEffect(() => {
    // Получаем информацию об администраторе
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setAdmin(data.admin);
        } else {
          router.push('/login');
        }
      } catch (e) {
        router.push('/login');
      }
    }

    checkSession();
  }, [router]);

  // Запуск ручной синхронизации трафика
  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await fetch('/api/admin/sync', { method: 'POST' });
      if (res.ok) {
        setXuiStatus('online');
        // Перезагружаем текущую страницу для обновления данных
        router.refresh();
      } else {
        setXuiStatus('offline');
      }
    } catch (e) {
      setXuiStatus('offline');
    } finally {
      setIsSyncing(false);
    }
  };

  // Выход из системы
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  return (
    <div style={{ display: 'flex', width: '100vw', minHeight: '100vh', background: '#0a0c10' }}>
      
      {/* --- СТИЛИ ДЛЯ МАКЕТА (CSS-in-JS для надежности или глобальные классы) --- */}
      <style jsx global>{`
        .sidebar {
          width: 260px;
          background: #0f1219;
          border-right: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          flex-direction: column;
          padding: 20px;
          height: 100vh;
          position: sticky;
          top: 0;
          z-index: 50;
          transition: transform 0.3s ease;
        }

        .sidebar-logo {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.5px;
          background: linear-gradient(135deg, #06b6d4, #a855f7);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          margin-bottom: 30px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .nav-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex-grow: 1;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 500;
          color: #9ca3af;
          transition: all 0.2s ease;
        }

        .nav-item:hover, .nav-item.active {
          color: #fff;
          background: rgba(255, 255, 255, 0.05);
        }

        .nav-item.active {
          border-left: 3px solid #06b6d4;
          background: rgba(6, 182, 212, 0.06);
          color: #06b6d4;
        }

        .nav-icon {
          width: 18px;
          height: 18px;
        }

        .admin-footer {
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 15px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .admin-profile {
          display: flex;
          flex-direction: column;
        }

        .admin-name {
          font-size: 14px;
          font-weight: 600;
          color: #f3f4f6;
        }

        .admin-email {
          font-size: 11px;
          color: #6b7280;
          margin-top: 2px;
        }

        .btn-logout {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: rgba(239, 68, 68, 0.08);
          border: 1px solid rgba(239, 68, 68, 0.15);
          color: #f87171;
          font-size: 13px;
          font-weight: 600;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .btn-logout:hover {
          background: rgba(239, 68, 68, 0.15);
        }

        /* Основной контент */
        .main-wrapper {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
        }

        .header {
          height: 70px;
          background: rgba(10, 12, 16, 0.8);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 30px;
          position: sticky;
          top: 0;
          z-index: 40;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .header-title {
          font-size: 18px;
          font-weight: 700;
          color: #f3f4f6;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 20px;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.05);
          padding: 6px 14px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
          color: #e5e7eb;
        }

        .btn-sync {
          background: rgba(6, 182, 212, 0.1);
          border: 1px solid rgba(6, 182, 212, 0.2);
          color: #06b6d4;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: all 0.2s;
        }

        .btn-sync:hover {
          background: rgba(6, 182, 212, 0.18);
        }

        .btn-sync.spin svg {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .content-area {
          padding: 30px;
          flex-grow: 1;
        }

        /* Мобильное меню */
        .mobile-header-btn {
          display: none;
          background: none;
          border: none;
          color: #f3f4f6;
          cursor: pointer;
        }

        @media (max-width: 900px) {
          .sidebar {
            position: fixed;
            left: 0;
            top: 0;
            bottom: 0;
            transform: translateX(-100%);
            box-shadow: 10px 0 30px rgba(0,0,0,0.5);
          }

          .sidebar.open {
            transform: translateX(0);
          }

          .mobile-header-btn {
            display: block;
          }

          .header {
            padding: 0 20px;
          }
        }
      `}</style>

      {/* --- SIDEBAR --- */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <span>⚡</span> BTW VPN PANEL
        </div>
        
        <nav className="nav-list">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.path;
            return (
              <Link 
                key={item.path} 
                href={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Icon className="nav-icon" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        <div className="admin-footer">
          {admin && (
            <div className="admin-profile">
              <span className="admin-name">{admin.name}</span>
              <span className="admin-email">{admin.email}</span>
            </div>
          )}
          <button className="btn-logout" onClick={handleLogout}>
            <LogOut size={16} />
            <span>Выйти</span>
          </button>
        </div>
      </aside>

      {/* --- MAIN CONTENT AREA --- */}
      <div className="main-wrapper">
        <header className="header">
          <div className="header-left">
            <button className="mobile-header-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <h1 className="header-title">
              {navItems.find(i => i.path === pathname)?.name || 'Панель управления'}
            </h1>
          </div>

          <div className="header-right">
            {/* Статус связи с сервером 3XUI */}
            <div className="status-badge">
              <span className={`pulse-indicator ${xuiStatus === 'offline' ? 'offline' : ''}`} />
              <span>3XUI Server</span>
            </div>

            {/* Кнопка синхронизации трафика */}
            <button 
              className={`btn-sync ${isSyncing ? 'spin' : ''}`} 
              onClick={handleSync}
              disabled={isSyncing}
            >
              <RefreshCw size={14} />
              <span>{isSyncing ? 'Синхронизация...' : 'Синхронизировать'}</span>
            </button>
          </div>
        </header>

        <main className="content-area">
          {children}
        </main>
      </div>
    </div>
  );
}
