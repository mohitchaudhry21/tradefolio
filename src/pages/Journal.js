import React, { useState, useEffect, useRef } from 'react';
import { useTrades } from '../context/TradesContext';
import { useToast } from '../context/ToastContext';

const fmt = n => `${n>=0?'+':'-'}$${Math.abs(n).toFixed(2)}`;

const SETUP_GROUPS = [
  { label:'5 Min',  opts:['5 Min A+','5 Min TJL1','5 Min TJL2','5 Min LVL 3','5 Min LVL 4'] },
  { label:'15 Min', opts:['15 Min A+','15 Min TJL1','15 Min TJL2','15 Min LVL 3','15 Min LVL 4'] },
  { label:'1H',     opts:['1H A+','1H TJL1','1H TJL2','1H LVL 3','1H LVL 4'] },
  { label:'4H',     opts:['4H A+','4H TJL1','4H TJL2'] },
  { label:'1D',     opts:['1D A+','1D TJL1','1D TJL2'] },
];
const MISTAKE_OPTIONS = ['Early Entry','Late Entry','Early Exit','Late Exit','Oversized','Ignored Stop','Ignored trend','Chasing','Revenge Trade','No plan'];

const DEFAULT_CHECKLIST = [
  'Confirmed entry',
  'Checked higher timeframe',
  'Risk within limits',
  'Fits my trading plan',
  'Key levels identified',
  'Economic calendar checked',
];

export default function Journal() {
  const { trades, updateJournal, getJournal, updateTrade, settings, accounts, activeAccount } = useTrades();
  const { showToast } = useToast();

  // Merge global custom checklist from settings into defaults, filter removed
  const EFFECTIVE_CHECKLIST = [
    ...DEFAULT_CHECKLIST.filter(x => !(settings?.removedChecklist||[]).includes(x)),
    ...(settings?.customChecklist || []),
  ];

  // Merge custom setups from settings, filter removed built-ins
  const SETUP_GROUPS_MERGED = [
    ...SETUP_GROUPS.map(g => ({
      ...g,
      opts: g.opts.filter(o => !(settings?.removedSetups||[]).includes(o))
    })).filter(g => g.opts.length > 0),
    ...(settings?.customSetups?.length ? [{ label: 'Custom', opts: settings.customSetups }] : []),
  ];

  // Merge custom mistakes from settings, filter removed built-ins
  const MISTAKE_OPTIONS_MERGED = [
    ...MISTAKE_OPTIONS.filter(m => !(settings?.removedMistakes||[]).includes(m)),
    ...(settings?.customMistakes || []),
  ];
  const [tab,      setTab]      = useState('all');
  const [selected, setSelected] = useState(trades[0]?.id || null);
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [customInput, setCustomInput] = useState('');
  const customRef = useRef(null);

  // A trade is "journalled" if any meaningful annotation has been made:
  // written text fields, OR setup/mistakes selected, OR checklist ticked, OR marked Breakeven
  const isJournalled = (trade, jData) => !!(
    jData.preAnalysis?.trim()    ||
    jData.postReview?.trim()     ||
    jData.emotions?.trim()       ||
    jData.lessons?.trim()        ||
    (trade?.setup && trade.setup.trim())          ||
    (trade?.mistakes?.length > 0)                 ||
    (jData.checklist?.length > 0)                 ||
    trade?.status === 'Breakeven'
  );

  const journaledIds = trades.filter(t => isJournalled(t, getJournal(t.id))).map(t => t.id);

  const displayTrades = trades
    .filter(t => {
      if (t.isWithdrawal) return false;  // withdrawals never appear in journal
      if (tab === 'journaled') return journaledIds.includes(t.id);
      if (tab === 'pending')   return !journaledIds.includes(t.id);
      return true;
    })
    .sort((a, b) => {
      const da = `${a.exitDate||a.entryDate||''}${a.exitTime||a.entryTime||''}`;
      const db = `${b.exitDate||b.entryDate||''}${b.exitTime||b.entryTime||''}`;
      return db.localeCompare(da);
    });

  const selTrade = trades.find(t => t.id === selected);
  const j        = selected ? getJournal(selected) : {};

  // Load SL/TP when selected trade changes
  useEffect(() => {
    if (!selTrade) { setSl(''); setTp(''); return; }
    setSl(j.sl != null && j.sl !== '' ? j.sl : (selTrade.stopLoss || ''));
    setTp(j.tp != null && j.tp !== '' ? j.tp : (selTrade.takeProfit || ''));
  }, [selected]);

  // RR calculation
  const entry  = selTrade?.entryPrice || 0;
  const slNum  = parseFloat(sl) || 0;
  const tpNum  = parseFloat(tp) || 0;
  const risk   = slNum && entry ? Math.abs(entry - slNum) : 0;
  const reward = tpNum && entry ? Math.abs(tpNum - entry) : 0;
  const autoRR = risk > 0 && reward > 0 ? (reward / risk).toFixed(2) : null;
  const dispSL = slNum ? slNum.toFixed(entry > 100 ? 2 : 5) : '—';
  const dispTP = tpNum ? tpNum.toFixed(entry > 100 ? 2 : 5) : '—';
  const dispRR = autoRR
    ? `1:${autoRR}`
    : (j.rr ? `1:${parseFloat(j.rr).toFixed(2)}`
    : (selTrade?.rMultiple && selTrade.rMultiple !== 0 ? `${Math.abs(selTrade.rMultiple).toFixed(2)}R` : '—'));

  const update = (field, val) => { if (selected) updateJournal(selected, { [field]: val }); };
  const handleSlChange = val => { setSl(val); update('sl', val); };
  const handleTpChange = val => { setTp(val); update('tp', val); };

  // Checklist helpers
  const getChecklistItems = () => {
    const defaults = EFFECTIVE_CHECKLIST.map(label => ({ label, default: true }));
    const custom   = (j.customChecklist || []).map(label => ({ label, default: false }));
    return [...defaults, ...custom];
  };

  const getChecked = () => j.checklist || [];

  const toggleCheck = (label) => {
    const cur = getChecked();
    const next = cur.includes(label) ? cur.filter(x => x !== label) : [...cur, label];
    update('checklist', next);
  };

  const addCustomItem = () => {
    const val = customInput.trim();
    if (!val) return;
    const existing = j.customChecklist || [];
    if ([...EFFECTIVE_CHECKLIST, ...existing].includes(val)) { setCustomInput(''); return; }
    update('customChecklist', [...existing, val]);
    setCustomInput('');
  };

  const removeCustomItem = (label) => {
    const existing = j.customChecklist || [];
    update('customChecklist', existing.filter(x => x !== label));
    update('checklist', getChecked().filter(x => x !== label));
  };

  const allItems = selTrade ? getChecklistItems() : [];
  const checked  = selTrade ? getChecked() : [];
  const checkCount = checked.filter(c => allItems.some(i => i.label === c)).length;

  // ── Export Journal to Excel ────────────────────────────────────────────
  const exportJournal = (exportAccountId = null) => {
    const XLSX = window._XLSX;
    if (!XLSX) { showToast({ title: 'Export failed', message: 'Please try again in a moment', type: 'error' }); return; }

    const fmtD = d => { if (!d) return '—'; try { return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); } catch { return d; } };
    const fmtP = n => n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;

    // Filter by account if specified
    let tradesToExport = trades.filter(t => !t.isWithdrawal);
    const exportAccount = exportAccountId ? accounts.find(a => a.id === exportAccountId) : null;
    if (exportAccount) {
      tradesToExport = tradesToExport.filter(t => t.source === exportAccount.source || t.source === exportAccount.name);
    }

    const getAccountLabel = (t) => {
      const acc = accounts.find(a => a.id === t.accountId) || accounts.find(a => a.source === t.source || a.name === t.source);
      if (acc) return acc.accountNumber ? `${acc.name} #${acc.accountNumber}` : acc.name;
      return t.source || 'Manual';
    };

    const rows = tradesToExport.map(t => {
      const jd = getJournal(t.id);
      const customCl = jd.customChecklist || [];
      const allCl = [...EFFECTIVE_CHECKLIST, ...customCl];
      const checkedCl = jd.checklist || [];
      const checklistStr = allCl.map(item => `${checkedCl.includes(item)?'✓':'✗'} ${item}`).join('\n');
      return {
        'Account':             getAccountLabel(t),
        'Date':                fmtD(t.exitDate||t.entryDate),
        'Symbol':              t.symbol||'—',
        'Direction':           t.side||'—',
        'Status':              t.status||'—',
        'Entry Price':         t.entryPrice||0,
        'Exit Price':          t.exitPrice || '—',
        'Lot Size':            t.size||0,
        'Gross P&L ($)':       parseFloat((t.pnl||0).toFixed(2)),
        'Commission ($)':      parseFloat((t.fees||0).toFixed(2)),
        'Net P&L ($)':         parseFloat(((t.pnl||0)-(t.fees||0)).toFixed(2)),
        'Setup':               t.setup||'—',
        'Timeframe':           t.timeframe||'—',
        'Emotion':             t.emotion||'—',
        'Mistakes':            Array.isArray(t.mistakes)&&t.mistakes.length?t.mistakes.join(', '):'None',
        'R-Multiple':          t.rMultiple||0,
        'Pre-Trade Analysis':  jd.preAnalysis||'',
        'Post-Trade Review':   jd.postReview||'',
        'Emotions & Lessons':  [jd.emotions?`Emotions: ${jd.emotions}`:'', jd.lessons?`Lessons: ${jd.lessons}`:''].filter(Boolean).join('\n\n'),
        'Execution Checklist': checklistStr,
        'Entry Date':          fmtD(t.entryDate),
        'Entry Time':          t.entryTime||'—',
        'Exit Date':           fmtD(t.exitDate),
        'Exit Time':           t.exitTime||'—',
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      {wch:22},{wch:14},{wch:10},{wch:11},{wch:10},{wch:13},{wch:13},{wch:9},
      {wch:13},{wch:13},{wch:13},{wch:16},{wch:11},{wch:12},{wch:24},
      {wch:11},{wch:45},{wch:45},{wch:45},{wch:35},{wch:14},{wch:10},{wch:14},{wch:10},
    ];
    ws['!rows'] = [{hpt:22}, ...rows.map(()=>({hpt:64}))];

    const wb = XLSX.utils.book_new();
    const sheetName = exportAccount ? exportAccount.name.slice(0,28) : 'Trade Journal';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    // Summary sheet
    const wins = tradesToExport.filter(t=>t.status==='Win').length;
    const losses = tradesToExport.filter(t=>t.status==='Loss').length;
    const bes = tradesToExport.filter(t=>t.status==='Breakeven').length;
    const totalGross = tradesToExport.reduce((s,t)=>s+(t.pnl||0),0);
    const totalComm  = tradesToExport.reduce((s,t)=>s+(t.fees||0),0);
    const wr = wins+losses>0?((wins/(wins+losses))*100).toFixed(1):'0';
    const journaled = tradesToExport.filter(t => isJournalled(t, getJournal(t.id))).length;

    const ws2 = XLSX.utils.aoa_to_sheet([
      ['TradeFolio — Journal Export', '', new Date().toLocaleDateString('en-US',{dateStyle:'long'})],
      ['Account', exportAccount ? `${exportAccount.name}${exportAccount.accountNumber?' #'+exportAccount.accountNumber:''}` : 'All Accounts (combined)'],
      [],
      ['PERFORMANCE SUMMARY'],
      ['Total Trades',    tradesToExport.length],
      ['Wins',            wins],
      ['Losses',          losses],
      ['Breakeven',       bes],
      ['Win Rate',        `${wr}%`],
      [],
      ['Gross P&L',       fmtP(totalGross)],
      ['Commission',      `-$${totalComm.toFixed(2)}`],
      ['Net P&L',         fmtP(totalGross-totalComm)],
      [],
      ['Journaled Trades', journaled],
      ['Pending Journal',  tradesToExport.length - journaled],
    ]);
    ws2['!cols'] = [{wch:20},{wch:24},{wch:26}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    const suffix = exportAccount ? `_${exportAccount.name.replace(/\s+/g,'_')}` : '_All';
    XLSX.writeFile(wb, `TradeFolio_Journal${suffix}_${new Date().toISOString().slice(0,10)}.xlsx`);
    showToast({ title: 'Journal exported ✓', message: `${tradesToExport.length} trades · ${exportAccount ? exportAccount.name : 'All Accounts'}` });
  };

  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef(null);
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = e => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setShowExportMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  const [mobilePanel, setMobilePanel] = useState('list'); // 'list' | 'detail' — for mobile only

  // When a trade is selected on mobile, switch to detail panel
  const handleSelectTrade = (id) => {
    setSelected(id);
    setMobilePanel('detail');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Page header — fixed */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mobile back button — only shows when viewing detail on mobile */}
          {mobilePanel === 'detail' && (
            <button onClick={() => setMobilePanel('list')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--blue-bright)', fontSize:13, fontWeight:600, padding:0, display:'flex', alignItems:'center', gap:4 }}>
              ← Back
            </button>
          )}
          <div>
            <div className="page-title">Trade Journal</div>
            <div className="page-sub">Review and reflect on your trades</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Export dropdown */}
          <div style={{ position: 'relative' }} ref={exportMenuRef}>
            <button className="btn btn-secondary" onClick={() => setShowExportMenu(p => !p)}>⬇ Export to Excel ▾</button>
            {showExportMenu && (
              <div style={{
                position:'absolute', top:'calc(100% + 4px)', right:0, zIndex:200,
                background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:8,
                boxShadow:'0 8px 24px rgba(0,0,0,.5)', minWidth:200, overflow:'hidden',
              }}>
                <div style={{ padding:'8px 12px', fontSize:10, fontWeight:700, color:'var(--text-muted)', letterSpacing:'.8px', borderBottom:'1px solid var(--border)' }}>EXPORT</div>
                <button onClick={() => { setShowExportMenu(false); exportJournal(null); }} style={{ width:'100%', padding:'9px 14px', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-primary)', fontFamily:'var(--font)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--border)' }}>
                  <span>⬡</span> All Accounts (combined)
                </button>
                {accounts.map(acc => (
                  <button key={acc.id} onClick={() => { setShowExportMenu(false); exportJournal(acc.id); }} style={{ width:'100%', padding:'9px 14px', textAlign:'left', background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-primary)', fontFamily:'var(--font)', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--border)' }}>
                    <span style={{ width:8, height:8, borderRadius:'50%', background:acc.color, display:'inline-block' }}/>
                    {acc.name}{acc.accountNumber ? ` #${acc.accountNumber}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span style={{ width: 8, height: 8, background: 'var(--blue)', borderRadius: '50%', display: 'inline-block' }} />
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Live</span>
          <span style={{ background: 'var(--blue-dim)', color: 'var(--blue-bright)', borderRadius: 6, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{trades.length} entries</span>
        </div>
      </div>

      {/* Two-panel layout — each panel scrolls independently */}
      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', flex: 1, overflow: 'hidden' }}>

        {/* ── LEFT PANEL: Trade list with independent scroll ── */}
        <div style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          // On mobile: hide this panel when viewing detail
          ...(window.innerWidth <= 768 && mobilePanel === 'detail' ? { display: 'none' } : {}),
        }}>
          {/* Tabs — fixed inside left panel */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 14px', flexShrink: 0 }}>
            {[['all','All',trades.length],['journaled','Journaled',journaledIds.length],['pending','Pending',trades.length-journaledIds.length]].map(([k,l,c]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                padding: '10px 12px', fontSize: 12, fontWeight: 600,
                color: tab === k ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: 'none', border: 'none',
                borderBottom: `2px solid ${tab === k ? 'var(--blue)' : 'transparent'}`,
                cursor: 'pointer', fontFamily: 'var(--font)', marginBottom: -1,
                display: 'flex', gap: 5, alignItems: 'center',
              }}>
                {l}
                <span style={{ background: tab === k ? 'var(--blue)' : 'var(--bg-hover)', color: tab === k ? '#fff' : 'var(--text-muted)', borderRadius: 10, padding: '0 6px', fontSize: 10 }}>{c}</span>
              </button>
            ))}
          </div>

          {/* Trade cards — scrollable */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
            {displayTrades.length === 0 && (
              <div className="empty-state"><div className="empty-text">No trades here</div></div>
            )}
            {displayTrades.map(t => {
              const jd = getJournal(t.id);
              const hasNotes = isJournalled(t, jd);
              const isSel = selected === t.id;
              return (
                <div key={t.id} onClick={() => handleSelectTrade(t.id)} style={{
                  background: isSel ? 'var(--bg-hover)' : 'transparent',
                  border: `1px solid ${isSel ? 'var(--blue)' : 'var(--border)'}`,
                  borderRadius: 9, padding: '12px 13px', marginBottom: 6, cursor: 'pointer', transition: 'all .14s',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{t.symbol}</span>
                      {!hasNotes && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-hover)', borderRadius: 4, padding: '2px 6px' }}>NEW</span>}
                    </div>
                    <span style={{
                      fontSize: 9, fontWeight: 700, borderRadius: 4, padding: '2px 7px',
                      background: t.status === 'Win' ? 'rgba(74,222,128,.15)' : t.status === 'Loss' ? 'var(--red-dim)' : 'var(--yellow-dim)',
                      color: t.status === 'Win' ? '#4ade80' : t.status === 'Loss' ? 'var(--red)' : 'var(--yellow)',
                    }}>{t.status === 'Win' ? 'WINNER' : t.status === 'Loss' ? 'LOSER' : 'BREAKEVEN'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2, display: 'flex', gap: 5, alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: (t.side||'Long') === 'Long' ? 'var(--blue-bright)' : 'var(--red)', fontSize: 11 }}>{(t.side||'Long').toUpperCase()}</span>
                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                    <span>Entry ${(t.entryPrice||0).toFixed(t.entryPrice>100?2:5)}</span>
                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                    <span>Size {t.size||t.quantity||0}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.entryDate ? new Date(t.entryDate+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'} {t.entryTime}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: (t.pnl||0) >= 0 ? '#4ade80' : 'var(--red)' }}>
                      {(t.pnl||0) >= 0 ? '+' : ''}{(t.pnl||0).toFixed(2)}
                    </span>
                  </div>
                  {/* Journal completion indicators */}
                  <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                    {[
                      { key: 'preAnalysis',  label: 'Pre'  },
                      { key: 'postReview',   label: 'Post' },
                      { key: 'emotions',     label: 'Emo'  },
                      { key: 'lessons',      label: 'Les'  },
                    ].map(({ key, label }) => {
                      const filled = !!jd[key]?.trim();
                      return (
                        <span key={key} title={`${label}: ${filled ? 'written' : 'empty'}`} style={{
                          fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                          background: filled ? 'rgba(59,130,246,.2)' : 'var(--bg-hover)',
                          color: filled ? 'var(--blue-bright)' : 'var(--text-muted)',
                          border: `1px solid ${filled ? 'rgba(59,130,246,.3)' : 'var(--border)'}`,
                        }}>{label}</span>
                      );
                    })}
                  </div>
                  {/* Account badge */}
                  {t.source && (() => {
                    const acc = accounts.find(a => a.id === t.accountId) || accounts.find(a => a.source === t.source || a.name === t.source);
                    if (!acc && accounts.length === 0) return null;
                    const color = acc?.color || '#6b7280';
                    const label = acc?.name || t.source;
                    const num   = acc?.accountNumber;
                    return (
                      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }}/>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
                          {label}{num ? ` #${num}` : ''}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT PANEL: Journal form with independent scroll ── */}
        {selTrade ? (
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden',
            ...(window.innerWidth <= 768 && mobilePanel === 'list' ? { display: 'none' } : {}),
          }}>
            {/* Trade header — fixed inside right panel */}
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-.3px' }}>{selTrade.symbol}</span>
                  <span style={{
                    background: selTrade.status === 'Win' ? 'rgba(34,197,94,.15)' : selTrade.status === 'Loss' ? 'var(--red-dim)' : 'var(--yellow-dim)',
                    color: selTrade.status === 'Win' ? '#4ade80' : selTrade.status === 'Loss' ? 'var(--red)' : 'var(--yellow)',
                    borderRadius: 5, padding: '2px 10px', fontSize: 11, fontWeight: 700,
                  }}>
                    {selTrade.status === 'Win' ? 'WINNER' : selTrade.status === 'Loss' ? 'LOSER' : 'BREAKEVEN'}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 800, color: (selTrade.pnl||0) >= 0 ? '#4ade80' : 'var(--red)', letterSpacing: '-.3px' }}>
                    {(selTrade.pnl||0) >= 0 ? '+' : ''}{(selTrade.pnl||0).toFixed(2)}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600, color: (selTrade.side||'Long') === 'Long' ? 'var(--blue-bright)' : 'var(--red)' }}>{(selTrade.side||'Long').toUpperCase()}</span>
                  <span style={{ color: 'var(--text-muted)' }}>•</span>
                  <span>Entry <strong style={{ color: 'var(--text-primary)' }}>${(selTrade.entryPrice||0).toFixed(selTrade.entryPrice>100?2:5)}</strong></span>
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <span>Exit <strong style={{ color: 'var(--text-primary)' }}>{selTrade.exitPrice ? `$${selTrade.exitPrice.toFixed(selTrade.exitPrice>100?2:5)}` : '—'}</strong></span>
                  <span style={{ color: 'var(--text-muted)' }}>•</span>
                  <span>Size <strong style={{ color: 'var(--text-primary)' }}>{selTrade.size||selTrade.quantity||0}</strong></span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>SL <strong style={{ color: dispSL === '—' ? 'var(--text-muted)' : 'var(--red)' }}>{dispSL}</strong></span>
                  <span style={{ color: 'var(--text-muted)' }}>•</span>
                  <span>TP <strong style={{ color: dispTP === '—' ? 'var(--text-muted)' : '#4ade80' }}>{dispTP}</strong></span>
                  <span style={{ color: 'var(--text-muted)' }}>•</span>
                  <span>RR <strong style={{ color: dispRR === '—' ? 'var(--text-muted)' : 'var(--text-primary)' }}>{dispRR}</strong></span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
                <button className="btn btn-primary btn-sm" onClick={() => {
                  updateJournal(selTrade.id, { savedAt: Date.now() });
                  showToast({ title: 'Journal saved', message: `${selTrade.symbol} updated` });
                }}>Save</button>
                <button
                  title={selTrade.status === 'Breakeven' ? 'Unmark breakeven' : 'Mark as Breakeven — excludes from win rate'}
                  onClick={() => {
                    const newStatus = selTrade.status === 'Breakeven' ? (selTrade.pnl >= 0 ? 'Win' : 'Loss') : 'Breakeven';
                    updateTrade(selTrade.id, { status: newStatus });
                    showToast({ title: `Marked as ${newStatus}`, message: `${selTrade.symbol} won't count in win rate` });
                  }}
                  style={{
                    padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid',
                    background: selTrade.status === 'Breakeven' ? 'rgba(251,191,36,.15)' : 'var(--bg-hover)',
                    color: selTrade.status === 'Breakeven' ? '#fbbf24' : 'var(--text-muted)',
                    borderColor: selTrade.status === 'Breakeven' ? 'rgba(251,191,36,.35)' : 'var(--border)',
                    transition: 'all .15s',
                  }}>
                  {selTrade.status === 'Breakeven' ? '↩ Undo BE' : '— Mark BE'}
                </button>
              </div>
            </div>

            {/* Journal fields — scrollable */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* ── PRE-TRADE ANALYSIS ── */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  📄 PRE-TRADE ANALYSIS
                </div>
                <textarea className="form-control" rows={4}
                  placeholder="What did you see? Plan, thesis, levels, risk..."
                  value={j.preAnalysis || ''}
                  onChange={e => update('preAnalysis', e.target.value)}
                  style={{ background: 'transparent', border: 'none', padding: '0', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7 }}
                />
              </div>

              {/* ── POST-TRADE REVIEW ── */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  🔄 POST-TRADE REVIEW
                </div>
                <textarea className="form-control" rows={4}
                  placeholder="What happened? Execution, slippage, improvements..."
                  value={j.postReview || ''}
                  onChange={e => update('postReview', e.target.value)}
                  style={{ background: 'transparent', border: 'none', padding: '0', fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.7 }}
                />
              </div>

              {/* ── SL / TP / RR ── */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>✳ STOP LOSS · TAKE PROFIT · RISK:REWARD</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>Enter your SL and TP prices — RR calculates automatically</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--red)', fontWeight: 600, marginBottom: 5 }}>STOP LOSS</div>
                    <input type="number" step="0.01" className="form-control" placeholder="e.g. 4792.00"
                      value={sl} onChange={e => handleSlChange(e.target.value)} style={{ textAlign: 'center' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#4ade80', fontWeight: 600, marginBottom: 5 }}>TAKE PROFIT</div>
                    <input type="number" step="0.01" className="form-control" placeholder="e.g. 4775.00"
                      value={tp} onChange={e => handleTpChange(e.target.value)} style={{ textAlign: 'center' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 5 }}>RISK : REWARD {autoRR ? '(auto)' : '(manual)'}</div>
                    <div style={{ height: 36, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, color: autoRR ? 'var(--blue-bright)' : 'var(--text-muted)' }}>
                      {autoRR ? `1 : ${autoRR}` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── EMOTIONS + LESSONS ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>😊 EMOTIONS</div>
                  <textarea className="form-control" rows={3}
                    placeholder="Calm, anxious, FOMO, confident..."
                    value={j.emotions || ''}
                    onChange={e => update('emotions', e.target.value)}
                    style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 13, resize: 'none' }}
                  />
                </div>
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>💡 LESSONS LEARNED</div>
                  <textarea className="form-control" rows={3}
                    placeholder="Key takeaways to repeat or avoid..."
                    value={j.lessons || ''}
                    onChange={e => update('lessons', e.target.value)}
                    style={{ background: 'transparent', border: 'none', padding: 0, fontSize: 13, resize: 'none' }}
                  />
                </div>
              </div>

              {/* ── SETUP + MISTAKES ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                {/* Setup dropdown */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>📐 SETUP</div>
                  <select
                    className="form-control"
                    value={selTrade.setup || ''}
                    onChange={e => updateTrade(selTrade.id, { setup: e.target.value })}
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', fontSize: 13 }}
                  >
                    <option value="">Select setup...</option>
                    {SETUP_GROUPS_MERGED.map(g => (
                      <optgroup key={g.label} label={`── ${g.label} ──`}>
                        {g.opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {/* Mistakes — multi-select toggle pills */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
                    ⚠ MISTAKES
                    {selTrade.mistakes?.length > 0 && (
                      <span style={{ marginLeft: 6, background: 'var(--red-dim)', color: 'var(--red)', borderRadius: 10, padding: '1px 7px', fontSize: 10 }}>
                        {selTrade.mistakes.length}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {MISTAKE_OPTIONS_MERGED.map(m => {
                      const active = (selTrade.mistakes||[]).includes(m);
                      return (
                        <button key={m} type="button"
                          onClick={() => {
                            const cur = selTrade.mistakes || [];
                            const next = cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m];
                            updateTrade(selTrade.id, { mistakes: next });
                          }}
                          style={{
                            padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', border: '1px solid',
                            background:  active ? 'var(--red-dim)' : 'var(--bg-hover)',
                            color:       active ? 'var(--red)'     : 'var(--text-secondary)',
                            borderColor: active ? 'rgba(239,68,68,.3)' : 'var(--border)',
                            fontWeight:  active ? 600 : 400,
                          }}>
                          {m}
                        </button>
                      );
                    })}
                    {(!selTrade.mistakes || selTrade.mistakes.length === 0) && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', alignSelf: 'center' }}>None selected</span>
                    )}
                  </div>
                </div>
              </div>

              {/* ── EXECUTION CHECKLIST ── */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', display: 'inline-block' }} />
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.8px' }}>EXECUTION CHECKLIST</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: checkCount === allItems.length && allItems.length > 0 ? '#4ade80' : 'var(--text-muted)' }}>{checkCount}/{allItems.length}</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {allItems.map(({ label, default: isDefault }) => {
                    const isChecked = checked.includes(label);
                    return (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, background: isChecked ? 'rgba(59,130,246,.12)' : 'var(--bg-hover)', border: `1px solid ${isChecked ? 'rgba(59,130,246,.3)' : 'var(--border)'}`, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', minWidth: 160, flex: '0 1 auto', transition: 'all .15s' }}>
                        <div onClick={() => toggleCheck(label)} style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, cursor: 'pointer', border: `2px solid ${isChecked ? 'var(--blue)' : 'var(--border-light)'}`, background: isChecked ? 'var(--blue)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>
                          {isChecked && <span style={{ color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                        </div>
                        <span onClick={() => toggleCheck(label)} style={{ fontSize: 12, fontWeight: 500, color: isChecked ? 'var(--text-primary)' : 'var(--text-secondary)', lineHeight: 1.3, userSelect: 'none', flex: 1 }}>{label}</span>
                        {!isDefault && <span onClick={e => { e.stopPropagation(); removeCustomItem(label); }} style={{ fontSize: 14, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1, marginLeft: 4, flexShrink: 0 }} title="Remove">×</span>}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px dashed var(--border)', borderRadius: 8, padding: '10px 14px', minWidth: 160, flex: '0 1 auto' }}>
                    <input ref={customRef} value={customInput} onChange={e => setCustomInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustomItem()} placeholder="Add custom item..." style={{ background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-secondary)', fontSize: 12, fontFamily: 'var(--font)', flex: 1, minWidth: 0 }} />
                    <button onClick={addCustomItem} style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--blue)', background: 'var(--blue-dim)', color: 'var(--blue-bright)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, lineHeight: 1, fontWeight: 700, flexShrink: 0 }}>+</button>
                  </div>
                </div>
              </div>

              {/* ── RATING ── */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12 }}>
                  <span>⭐ TRADE RATING</span>
                  <span style={{ color: 'var(--blue-bright)', fontWeight: 700 }}>{j.rating || 5}/10</span>
                </div>
                <input type="range" min={1} max={10} step={1}
                  value={j.rating || 5} onChange={e => update('rating', e.target.value)}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  <span>1</span><span>5</span><span>10</span>
                </div>
              </div>

            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ paddingTop: 80 }}>
            <div className="empty-icon">📓</div>
            <div className="empty-text">Select a trade to journal</div>
          </div>
        )}
      </div>
    </div>
  );
}
