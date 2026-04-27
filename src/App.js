import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { TradesProvider } from './context/TradesContext';
import { ToastProvider } from './context/ToastContext';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import TradeLog from './pages/TradeLog';
import Journal from './pages/Journal';
import Analytics from './pages/Analytics';
import Calendar from './pages/Calendar';
import BrokerConnect from './pages/BrokerConnect';
import { ImportPage, SettingsPage } from './pages/OtherPages';
import BalancePage from './pages/BalancePage';
import LoginScreen, { isAuthEnabled, isAuthenticated } from './components/LoginScreen';
import './styles.css';

function AuthGate({ children }) {
  const [authed, setAuthed] = useState(() => !isAuthEnabled() || isAuthenticated());

  // Re-check every second — catches when Supabase pulls password hash on a new device
  useEffect(() => {
    if (authed) return;
    const interval = setInterval(() => {
      if (isAuthEnabled() && !isAuthenticated()) {
        // password just arrived from cloud — stay on login screen
        setAuthed(false);
      } else if (!isAuthEnabled()) {
        // no password configured
        setAuthed(true);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [authed]);

  // Also re-check when localStorage changes (e.g. Supabase sets tf_pw_hash)
  useEffect(() => {
    const handler = () => setAuthed(!isAuthEnabled() || isAuthenticated());
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;
  return children;
}

export default function App() {
  return (
    <AuthGate>
      <TradesProvider>
        <ToastProvider>
          <HashRouter>
            <div className="layout">
              <Sidebar />
              <main className="main">
                <Routes>
                  <Route path="/"          element={<Dashboard />} />
                  <Route path="/trades"    element={<TradeLog />} />
                  <Route path="/journal"   element={<Journal />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/calendar"  element={<Calendar />} />
                  <Route path="/broker"    element={<BrokerConnect />} />
                  <Route path="/import"    element={<ImportPage />} />
                  <Route path="/balance"   element={<BalancePage />} />
                  <Route path="/settings"  element={<SettingsPage />} />
                </Routes>
              </main>
            </div>
          </HashRouter>
        </ToastProvider>
      </TradesProvider>
    </AuthGate>
  );
}
