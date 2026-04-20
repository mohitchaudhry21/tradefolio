import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import './styles.css';

export default function App() {
  return (
    <TradesProvider>
      <ToastProvider>
        <BrowserRouter>
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
                <Route path="/settings"  element={<SettingsPage />} />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </ToastProvider>
    </TradesProvider>
  );
}
