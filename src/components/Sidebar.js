import React, { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useTrades } from '../context/TradesContext';
import { isAuthEnabled, logout } from './LoginScreen';

const ACCOUNT_COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];

const navItems = [
  { section: 'MENU' },
  { to:'/',          icon:'⬡',  label:'Dashboard' },
  { to:'/trades',    icon:'📋', label:'Trades' },
  { to:'/journal',   icon:'📓', label:'Journal' },
  { to:'/analytics', icon:'📊', label:'Analysis' },
  { to:'/calendar',  icon:'📅', label:'Calendar' },
  { section: 'TOOLS' },
  { to:'/broker',    icon:'🔗', label:'Broker Connect', dot: true },
  { to:'/import',    icon:'⬆',  label:'Import / Export' },
  { section: 'SUPPORT' },
  { to:'/settings',  icon:'⚙',  label:'Settings' },
];

export default function Sidebar() {
  const { stats, broker, accounts, activeAccountId, setActiveAccountId, activeAccount, settings, cloudStatus } = useTrades();
  const [showAccPicker, setShowAccPicker] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (!showAccPicker) return;
    const handler = e => { if (pickerRef.current && !pickerRef.current.contains(e.target)) setShowAccPicker(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAccPicker]);

  const grossPnl   = stats.totalGrossPnl || 0;
  const commission = stats.totalCommissions || 0;
  const netPnl     = grossPnl - commission;
  const pct        = stats.accountSize > 0 ? ((grossPnl / stats.accountSize) * 100).toFixed(1) : '0.0';
  const traderName = settings?.traderName || 'Trader';
  const initial    = traderName.charAt(0).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sb-logo">
        <NavLink to="/" className="sb-logo-inner">
          <div className="sb-logo-icon">📈</div>
          <span className="sb-logo-text">Trade<span>Folio</span></span>
        </NavLink>
        {cloudStatus === 'synced'  && <span title="Cloud synced"  style={{ fontSize:9, color:'#4ade80', marginLeft:'auto' }}>☁✓</span>}
        {cloudStatus === 'syncing' && <span title="Syncing..."    style={{ fontSize:9, color:'var(--blue)', marginLeft:'auto' }}>☁↻</span>}
        {cloudStatus === 'error'   && <span title="Sync error — check Supabase settings" style={{ fontSize:9, color:'var(--red)', marginLeft:'auto' }}>☁✗</span>}
      </div>

      {/* Trader info + account selector */}
      <div className="sb-user" style={{ flexDirection:'column', alignItems:'flex-start', gap:8, paddingBottom:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, width:'100%' }}>
          <div className="sb-avatar" style={{ background: activeAccount ? activeAccount.color : 'var(--blue-dim)', color: activeAccount ? '#fff' : 'var(--blue-bright)', fontSize:13, fontWeight:800 }}>
            {initial}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div className="sb-user-name" style={{ fontWeight:700 }}>{traderName}</div>
            <div className="sb-user-email" style={{ fontSize:10 }}>
              {broker.connected ? broker.name : 'Local Account'}
            </div>
          </div>
          {broker.connected && <span className="sb-elite">LIVE</span>}
        </div>

        {/* Account selector */}
        <div style={{ position:'relative', width:'100%' }} ref={pickerRef}>
          <button
            onClick={() => setShowAccPicker(p => !p)}
            style={{
              width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
              background:'var(--bg-hover)', border:'1px solid var(--border)', borderRadius:7,
              padding:'6px 10px', cursor:'pointer', fontSize:12, color:'var(--text-primary)',
              fontFamily:'var(--font)',
            }}>
            <div style={{ display:'flex', alignItems:'center', gap:7 }}>
              {activeAccount ? (
                <span style={{ width:8, height:8, borderRadius:'50%', background:activeAccount.color, display:'inline-block', flexShrink:0 }}/>
              ) : (
                <span style={{ fontSize:11 }}>⬡</span>
              )}
              <span style={{ fontWeight:600 }}>{activeAccount ? activeAccount.name : 'All Accounts'}</span>
            </div>
            <span style={{ color:'var(--text-muted)', fontSize:10 }}>▾</span>
          </button>

          {showAccPicker && (
            <div style={{
              position:'absolute', top:'calc(100% + 4px)', left:0, right:0, zIndex:200,
              background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8,
              boxShadow:'0 8px 24px rgba(0,0,0,.5)', overflow:'hidden',
            }}>
              {/* All accounts option */}
              <button onClick={() => { setActiveAccountId(null); setShowAccPicker(false); }}
                style={{
                  width:'100%', padding:'9px 12px', display:'flex', alignItems:'center', gap:8,
                  background: !activeAccountId ? 'var(--bg-hover)' : 'transparent',
                  border:'none', cursor:'pointer', fontSize:12, color:'var(--text-primary)',
                  fontFamily:'var(--font)', textAlign:'left', borderBottom:'1px solid var(--border)',
                }}>
                <span style={{ fontSize:11 }}>⬡</span>
                <span style={{ fontWeight:600 }}>All Accounts</span>
                {!activeAccountId && <span style={{ marginLeft:'auto', color:'var(--blue)' }}>✓</span>}
              </button>

              {accounts.map(acc => (
                <button key={acc.id} onClick={() => { setActiveAccountId(acc.id); setShowAccPicker(false); }}
                  style={{
                    width:'100%', padding:'9px 12px', display:'flex', alignItems:'center', gap:8,
                    background: activeAccountId === acc.id ? 'var(--bg-hover)' : 'transparent',
                    border:'none', cursor:'pointer', fontSize:12, color:'var(--text-primary)',
                    fontFamily:'var(--font)', textAlign:'left', borderBottom:'1px solid var(--border)',
                  }}>
                  <span style={{ width:8, height:8, borderRadius:'50%', background:acc.color, display:'inline-block', flexShrink:0 }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:600 }}>{acc.name}</div>
                    {acc.accountNumber && <div style={{ fontSize:10, color:'var(--text-muted)' }}>{acc.accountNumber}</div>}
                  </div>
                  {activeAccountId === acc.id && <span style={{ color:'var(--blue)' }}>✓</span>}
                </button>
              ))}

              {/* Add account link */}
              <NavLink to="/settings" onClick={() => setShowAccPicker(false)}
                style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 12px', fontSize:11, color:'var(--text-muted)', textDecoration:'none' }}>
                <span>＋</span> Manage accounts in Settings
              </NavLink>
            </div>
          )}
        </div>

        {/* Active account badge */}
        {activeAccount && (
          <div style={{ fontSize:10, color:activeAccount.color, background:`${activeAccount.color}20`, borderRadius:4, padding:'2px 8px', fontWeight:700, letterSpacing:'.3px' }}>
            Viewing: {activeAccount.name}{activeAccount.accountNumber ? ` · #${activeAccount.accountNumber}` : ''}
          </div>
        )}
      </div>

      <nav className="sb-nav">
        {navItems.map((item, i) => {
          if (item.section) return <div key={i} className="sb-section">{item.section}</div>;
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.dot && broker.connected && <span className="nav-dot" />}
            </NavLink>
          );
        })}
      </nav>

      <div className="sb-bottom">
        {isAuthEnabled() && (
          <button onClick={logout} style={{
            width:'100%', marginBottom:8, padding:'7px 12px', background:'transparent',
            border:'1px solid var(--border)', borderRadius:7, cursor:'pointer',
            fontSize:12, color:'var(--text-muted)', fontFamily:'var(--font)',
            display:'flex', alignItems:'center', gap:6,
          }}>
            🔒 Lock / Log out
          </button>
        )}
        <div className="pnl-card">
          <div className="pnl-label">GROSS P&L{activeAccount ? ` · ${activeAccount.name}` : ''}</div>
          <div className={`pnl-val ${grossPnl >= 0 ? 'pos' : 'neg'}`}>
            {grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)}
          </div>
          {commission > 0 && (
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-muted)', marginTop:6, padding:'6px 0', borderTop:'1px solid var(--border)' }}>
              <span>Commission</span>
              <span style={{ color:'var(--red)' }}>-${commission.toFixed(2)}</span>
            </div>
          )}
          {commission > 0 && (
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:6, paddingBottom:6, borderBottom:'1px solid var(--border)' }}>
              <span style={{ color:'var(--text-muted)' }}>Net P&L</span>
              <span style={{ fontWeight:700, color: netPnl >= 0 ? 'var(--blue-bright)' : 'var(--red)' }}>
                {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
              </span>
            </div>
          )}
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop: commission > 0 ? 0 : 4 }}>
            {pct}% return · {stats.winRate.toFixed(0)}% win rate
          </div>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:2 }}>
            Account: ${(stats.accountSize||10000).toLocaleString()}
          </div>
        </div>
      </div>
    </aside>
  );
}
