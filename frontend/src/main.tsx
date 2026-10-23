import React, { lazy, Suspense, useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  Radio,
  Thermometer,
  ShieldAlert,
  ChartColumn,
  HeartPulse,
  Settings as Cog,
  Menu,
  Moon,
  Sun,
  Bell,
  Search,
  X
} from 'lucide-react';
import { Preferences, usePrefs, useApi, type List, type Incident } from './core';
import './style.css';

const Overview = lazy(() => import('./pages').then(m => ({ default: m.Overview })));
const Sensors = lazy(() => import('./pages').then(m => ({ default: m.Sensors })));
const Monitoring = lazy(() => import('./pages').then(m => ({ default: m.Monitoring })));
const Incidents = lazy(() => import('./pages').then(m => ({ default: m.Incidents })));
const Analytics = lazy(() => import('./pages').then(m => ({ default: m.Analytics })));
const Health = lazy(() => import('./pages').then(m => ({ default: m.Health })));
const Settings = lazy(() => import('./pages').then(m => ({ default: m.Settings })));

const links = [
  ['/', 'Overview', Activity],
  ['/sensors', 'Sensors', Radio],
  ['/monitoring', 'Real-time monitoring', Thermometer],
  ['/incidents', 'Incidents', ShieldAlert],
  ['/analytics', 'Analytics', ChartColumn],
  ['/health', 'System health', HeartPulse],
  ['/settings', 'Settings', Cog],
] as const;

function App() {
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState('');
  const { prefs, setPrefs } = usePrefs();
  const nav = useNavigate();
  const location = useLocation();
  const alerts = useApi<List<Incident>>('alerts?status=open&limit=1');
  const openCount = alerts.data?.pagination.total ?? 0;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobile(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to main content</a>
      <div
        className={mobile ? 'backdrop active' : 'backdrop'}
        onClick={() => setMobile(false)}
        aria-hidden="true"
      />
      <aside className={mobile ? 'sidebar expanded' : 'sidebar'} aria-label="Main sidebar">
        <div className="logo">
          <div className="logo-title">
            <Activity size={24} />
            <span>SensorGuard</span>
          </div>
          <small>IOT OPERATIONS</small>
        </div>
        <nav aria-label="Main navigation">
          {links.map(([to, title, Icon]) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMobile(false)}
            >
              <Icon size={18} />
              <span>{title}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          ● Local development
          <small>Operations console</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label={mobile ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            {mobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <form
            className="search"
            role="search"
            onSubmit={e => {
              e.preventDefault();
              if (search.trim()) {
                nav('/sensors?search=' + encodeURIComponent(search.trim()));
              }
            }}
          >
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Global sensor search"
              placeholder="Search sensors by ID or name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              maxLength={100}
            />
          </form>
          <button
            className="theme-btn"
            aria-label={'Switch to ' + (prefs.theme === 'light' ? 'dark' : 'light') + ' theme'}
            onClick={() => setPrefs({ ...prefs, theme: prefs.theme === 'light' ? 'dark' : 'light' })}
          >
            {prefs.theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <NavLink
            to="/incidents?status=open"
            className={'notifications' + (openCount > 0 ? ' has-alerts' : '')}
            aria-label={`${openCount} open incident notifications`}
          >
            <Bell size={16} />
            <span>{openCount > 0 ? openCount : '0'}</span>
          </NavLink>
          <span className="avatar" title="Local Operator">OP</span>
        </header>

        <main id="main">
          <div className="context">
            <span>WORKSPACE / SENSORGUARD MONITORING</span>
            <span>Polling · {prefs.refresh / 1000}s refresh</span>
          </div>
          <Suspense fallback={<p role="status">Loading page…</p>}>
            <Routes location={location} key={location.pathname + location.search}>
              <Route path="/" element={<Overview />} />
              <Route path="/sensors" element={<Sensors />} />
              <Route path="/sensors/:id" element={<Sensors />} />
              <Route path="/monitoring" element={<Monitoring />} />
              <Route path="/incidents" element={<Incidents />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/health" element={<Health />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<h1>Page not found</h1>} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10000, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <Preferences>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Preferences>
    </QueryClientProvider>
  </React.StrictMode>
);
