import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { getSupabaseClient, loadAllFromSupabase, saveToSupabase, isSupabaseConfigured } from '../lib/supabase';

const Ctx = createContext();

const TRADES_KEY    = 'tf_trades';
const SETTINGS_KEY  = 'tf_settings';
const PLAYBOOKS_KEY = 'tf_playbooks';
const JOURNAL_KEY   = 'tf_journal';
const BROKER_KEY    = 'tf_broker';
const ACCOUNTS_KEY  = 'tf_accounts';

const defaultSettings = {
  accountSize: 10000, currency: 'USD', timezone: 'UTC', riskPerTrade: 1, brokeragePerLot: 0,
  statsStartDate: '', statsEndDate: '',
  traderName: 'Trader',
  customSetups:    [],
  customMistakes:  [],
  customChecklist: [],
  removedSetups:    [],
  removedMistakes:  [],
  removedChecklist: [],
};

const sampleTrades = [
  { id: uuidv4(), symbol:'XAUUSD', side:'Short', status:'Win',  entryDate:'2026-04-17', entryTime:'13:36', exitDate:'2026-04-17', exitTime:'13:43', entryPrice:4786.99, exitPrice:4782.79, size:3,   fees:0.5, pnl:1229.70, rMultiple:2.1, setup:'Breakout',       timeframe:'5m', emotion:'Confident', tags:['london','breakout'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Short', status:'Loss', entryDate:'2026-04-17', entryTime:'13:15', exitDate:'2026-04-17', exitTime:'13:31', entryPrice:4784.13, exitPrice:4788.20, size:1,   fees:0.4, pnl:-417.30, rMultiple:-1.0, setup:'VWAP Rejection', timeframe:'1m', emotion:'Anxious',   tags:['london'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Long',  status:'Loss', entryDate:'2026-04-17', entryTime:'12:35', exitDate:'2026-04-17', exitTime:'13:07', entryPrice:4789.60, exitPrice:4788.39, size:0.6, fees:0.3, pnl:-78.12,  rMultiple:-0.5, setup:'Momentum',       timeframe:'1m', emotion:'FOMO',      tags:['newyork'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Short', status:'Loss', entryDate:'2026-04-16', entryTime:'12:12', exitDate:'2026-04-16', exitTime:'12:35', entryPrice:4785.61, exitPrice:4789.51, size:0.6, fees:0.3, pnl:-239.64, rMultiple:-1.1, setup:'VWAP Rejection', timeframe:'5m', emotion:'Anxious',   tags:['london'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Short', status:'Win',  entryDate:'2026-04-16', entryTime:'10:09', exitDate:'2026-04-16', exitTime:'10:45', entryPrice:4785.61, exitPrice:4782.79, size:0.5, fees:0.2, pnl:6.75,    rMultiple:0.1,  setup:'Scalp',         timeframe:'1m', emotion:'Calm',      tags:[] },
  { id: uuidv4(), symbol:'EURUSD', side:'Long',  status:'Loss', entryDate:'2026-04-15', entryTime:'09:30', exitDate:'2026-04-15', exitTime:'10:15', entryPrice:1.0850,  exitPrice:1.0820,  size:1,   fees:0.5, pnl:-147.91, rMultiple:-1.0, setup:'Breakout',       timeframe:'15m', emotion:'Neutral',  tags:['london'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Long',  status:'Win',  entryDate:'2026-04-14', entryTime:'14:20', exitDate:'2026-04-14', exitTime:'15:10', entryPrice:4760.00, exitPrice:4772.50, size:0.5, fees:0.3, pnl:306.56,  rMultiple:1.8,  setup:'Support Bounce', timeframe:'15m', emotion:'Confident', tags:['newyork'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Long',  status:'Win',  entryDate:'2026-04-14', entryTime:'09:45', exitDate:'2026-04-14', exitTime:'10:30', entryPrice:4755.00, exitPrice:4766.00, size:0.5, fees:0.3, pnl:285.92,  rMultiple:2.0,  setup:'Breakout',       timeframe:'5m', emotion:'Confident', tags:['london'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Short', status:'Win',  entryDate:'2026-04-13', entryTime:'11:00', exitDate:'2026-04-13', exitTime:'11:45', entryPrice:4770.00, exitPrice:4758.00, size:0.5, fees:0.3, pnl:181.20,  rMultiple:1.5,  setup:'VWAP Rejection', timeframe:'5m', emotion:'Calm',      tags:['london'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Long',  status:'Win',  entryDate:'2026-04-10', entryTime:'09:45', exitDate:'2026-04-10', exitTime:'10:30', entryPrice:4755.00, exitPrice:4766.00, size:0.5, fees:0.3, pnl:118.50,  rMultiple:1.2,  setup:'Breakout',       timeframe:'5m', emotion:'Confident', tags:['london'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Short', status:'Loss', entryDate:'2026-04-09', entryTime:'13:10', exitDate:'2026-04-09', exitTime:'13:50', entryPrice:4780.00, exitPrice:4783.50, size:0.5, fees:0.3, pnl:-115.16, rMultiple:-0.8, setup:'Double Top',     timeframe:'5m', emotion:'Frustrated', tags:[] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Long',  status:'Win',  entryDate:'2026-04-08', entryTime:'10:00', exitDate:'2026-04-08', exitTime:'11:00', entryPrice:4740.00, exitPrice:4748.00, size:0.5, fees:0.3, pnl:57.91,   rMultiple:1.0,  setup:'Support Bounce', timeframe:'15m', emotion:'Calm',     tags:['london'] },
  { id: uuidv4(), symbol:'XAUUSD', side:'Short', status:'Loss', entryDate:'2026-04-07', entryTime:'14:00', exitDate:'2026-04-07', exitTime:'14:30', entryPrice:4750.00, exitPrice:4754.80, size:0.5, fees:0.3, pnl:-394.80, rMultiple:-1.2, setup:'Reversal',       timeframe:'5m', emotion:'Anxious',   tags:[] },
];

function normalizeTrade(t) {
  return {
    side:'Long', status:'Breakeven', symbol:'—',
    entryDate:'', entryTime:'', exitDate:'', exitTime:'',
    entryPrice:0, exitPrice:null, size:0, fees:0, pnl:0, rMultiple:0,
    setup:'', timeframe:'', emotion:'', tags:[], notes:'', mistakes:[],
    ...t,
    side:   t.side   || 'Long',
    status: t.status || 'Breakeven',
    symbol: t.symbol || '—',
    tags:   Array.isArray(t.tags)     ? t.tags     : [],
    mistakes: Array.isArray(t.mistakes) ? t.mistakes : [],
  };
}

export function TradesProvider({ children }) {
  const [trades,    setTrades]    = useState(() => {
    const raw = (load(TRADES_KEY, sampleTrades)).map(normalizeTrade);
    const seen = new Set();
    return raw.filter(t => { if (!t.positionId) return true; if (seen.has(t.positionId)) return false; seen.add(t.positionId); return true; });
  });
  const [settings,  setSettings]  = useState(() => load(SETTINGS_KEY,  defaultSettings));
  const [accounts,  setAccounts]  = useState(() => load(ACCOUNTS_KEY,  []));
  const [activeAccountId, setActiveAccountId] = useState(null);
  const [playbooks, setPlaybooks] = useState(() => load(PLAYBOOKS_KEY, []));
  const [journal,   setJournal]   = useState(() => load(JOURNAL_KEY,   {}));
  const [broker,    setBroker]    = useState(() => load(BROKER_KEY,    { connected:false, name:'', token:'', accountId:'', platform:'MT4' }));
  const [cloudStatus, setCloudStatus] = useState('idle');
  const cloudLoadDone = useRef(false);
  const sbRef = useRef(getSupabaseClient());

  const applyCloudData = useCallback((data) => {
    if (!data) return;
    if (data[TRADES_KEY]) {
      const raw = data[TRADES_KEY].map(normalizeTrade);
      const seen = new Set();
      const deduped = raw.filter(t => { if (!t.positionId) return true; if (seen.has(t.positionId)) return false; seen.add(t.positionId); return true; });
      setTrades(deduped); save(TRADES_KEY, deduped);
    }
    if (data[SETTINGS_KEY])  { setSettings({ ...defaultSettings, ...data[SETTINGS_KEY] }); save(SETTINGS_KEY, data[SETTINGS_KEY]); }
    if (data[ACCOUNTS_KEY])  { setAccounts(data[ACCOUNTS_KEY]);   save(ACCOUNTS_KEY,  data[ACCOUNTS_KEY]);  }
    if (data[JOURNAL_KEY])   { setJournal(data[JOURNAL_KEY]);     save(JOURNAL_KEY,   data[JOURNAL_KEY]);   }
    if (data[PLAYBOOKS_KEY]) { setPlaybooks(data[PLAYBOOKS_KEY]); save(PLAYBOOKS_KEY, data[PLAYBOOKS_KEY]); }
    if (data['tf_pw_hash'] && !localStorage.getItem('tf_pw_hash')) {
      localStorage.setItem('tf_pw_hash', data['tf_pw_hash']);
    }
  }, []);

  useEffect(() => {
    const client = sbRef.current;
    if (!client) { cloudLoadDone.current = true; return; }
    setCloudStatus('syncing');
    loadAllFromSupabase(client).then(data => {
      cloudLoadDone.current = true;
      if (!data) { setCloudStatus('error'); return; }
      applyCloudData(data);
      setCloudStatus('synced');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((key, value) => {
    save(key, value);
    if (cloudLoadDone.current) saveToSupabase(sbRef.current, key, value);
  }, []);

  useEffect(() => { persist(TRADES_KEY,    trades);    }, [trades,    persist]);
  useEffect(() => { persist(SETTINGS_KEY,  settings);  }, [settings,  persist]);
  useEffect(() => { persist(ACCOUNTS_KEY,  accounts);  }, [accounts,  persist]);
  useEffect(() => { persist(PLAYBOOKS_KEY, playbooks); }, [playbooks, persist]);
  useEffect(() => { persist(JOURNAL_KEY,   journal);   }, [journal,   persist]);
  useEffect(() => { save(BROKER_KEY, broker);           }, [broker]);

  const refreshSupabaseClient = useCallback(() => {
    sbRef.current = getSupabaseClient();
    if (!sbRef.current) { setCloudStatus('idle'); cloudLoadDone.current = true; return; }
    setCloudStatus('syncing');
    cloudLoadDone.current = false;
    loadAllFromSupabase(sbRef.current).then(data => {
      cloudLoadDone.current = true;
      if (!data) { setCloudStatus('error'); return; }
      applyCloudData(data);
      setCloudStatus('synced');
    });
  }, [applyCloudData]);

  const addTrade    = useCallback(t   => setTrades(p => [normalizeTrade({ ...t, id: uuidv4() }), ...p]), []);
  const updateTrade = useCallback((id, u) => setTrades(p => p.map(t => t.id === id ? normalizeTrade({ ...t, ...u }) : t)), []);
  const deleteTrade = useCallback(id  => setTrades(p => p.filter(t => t.id !== id)), []);

  const clearAllTrades = useCallback((activeAccId, allAccs) => {
    if (activeAccId && allAccs?.length) {
      const activeAcc = allAccs.find(a => a.id === activeAccId);
      if (activeAcc) {
        setTrades(prev => prev.filter(t => {
          if (t.accountId) return t.accountId !== activeAccId;
          return t.source !== activeAcc.source && t.source !== activeAcc.name;
        }));
        return;
      }
    }
    setTrades([]);
    try { localStorage.removeItem(TRADES_KEY); } catch {}
  }, []);

  const importTrades = useCallback((arr, brokerSource, accountId) => {
    const matchedAccount = accountId ? accounts.find(a => a.id === accountId) : null;
    const sourceOverride = matchedAccount ? (matchedAccount.source || matchedAccount.name) : null;
    const normalized = arr.map(t => normalizeTrade({
      ...t, id: t.id || uuidv4(),
      ...(accountId      ? { accountId }     : {}),
      ...(sourceOverride ? { source: sourceOverride } : {}),
    }));
    const KEEP_FIELDS = ['notes','setup','emotion','tags','mistakes','rMultiple','status','timeframe'];
    setTrades(prev => {
      const updated = prev.map(existing => {
        if (!existing.positionId) return existing;
        const incoming = normalized.find(t => t.positionId === existing.positionId);
        if (!incoming) return existing;
        const preserved = {};
        KEEP_FIELDS.forEach(k => { if (existing[k] !== undefined) preserved[k] = existing[k]; });
        const wasImported = existing.accountId || (existing.source && existing.source !== 'Manual');
        if (wasImported) {
          if (existing.pnl  != null) preserved.pnl  = existing.pnl;
          if (existing.fees != null) preserved.fees = existing.fees;
          if (existing.size != null) preserved.size = existing.size;
        }
        return { ...existing, ...incoming, ...preserved, id: existing.id, accountId: incoming.accountId || existing.accountId, source: incoming.source || existing.source };
      });
      const existingIds = new Set(prev.map(t => t.positionId).filter(Boolean));
      const brandNew = normalized.filter(t => !t.positionId || !existingIds.has(t.positionId));
      const merged = [...brandNew, ...updated];
      const seenPositions = new Set();
      const deduped = [];
      for (let i = merged.length - 1; i >= 0; i--) {
        const t = merged[i];
        if (!t.positionId) { deduped.unshift(t); }
        else if (!seenPositions.has(t.positionId)) { seenPositions.add(t.positionId); deduped.unshift(t); }
      }
      return deduped;
    });
  }, [accounts]);

  const updateJournal = useCallback((tradeId, data) => setJournal(p => ({ ...p, [tradeId]: { ...(p[tradeId] || {}), ...data } })), []);
  const getJournal    = useCallback(tradeId => journal[tradeId] || {}, [journal]);
  const addPlaybook    = useCallback(p  => setPlaybooks(prev => [...prev, { ...p, id: uuidv4() }]), []);
  const updatePlaybook = useCallback((id, u) => setPlaybooks(p => p.map(x => x.id === id ? { ...x, ...u } : x)), []);
  const deletePlaybook = useCallback(id => setPlaybooks(p => p.filter(x => x.id !== id)), []);
  const addAccount    = useCallback(a => setAccounts(p => [...p, { ...a, id: uuidv4() }]), []);
  const updateAccount = useCallback((id, u) => setAccounts(p => p.map(a => a.id === id ? { ...a, ...u } : a)), []);
  const deleteAccount = useCallback(id => { setAccounts(p => p.filter(a => a.id !== id)); if (activeAccountId === id) setActiveAccountId(null); }, [activeAccountId]);

  const activeAccount = accounts.find(a => a.id === activeAccountId) || null;

  const accountTrades = useMemo(() => {
    if (!activeAccount) return trades;
    return trades.filter(t => {
      if (t.accountId) return t.accountId === activeAccount.id;
      if (t.source === activeAccount.source || t.source === activeAccount.name) return true;
      return false;
    });
  }, [trades, activeAccount]);

  const stats = useMemo(() => {
    const effectiveAccountSize = activeAccount?.accountSize || settings.accountSize || 10000;
    const effectiveStartDate   = activeAccount?.statsStartDate || settings.statsStartDate || '';
    const effectiveEndDate     = activeAccount?.statsEndDate   || settings.statsEndDate   || '';
    const effectiveBrokerage   = (activeAccount?.brokeragePerLot != null && activeAccount.brokeragePerLot !== '')
      ? parseFloat(activeAccount.brokeragePerLot) || 0
      : settings.brokeragePerLot || 0;
    const statsTrades = accountTrades.filter(t => {
      if (t.isWithdrawal) return false;
      if (t.isOpen || t.status === 'Open') return false;
      const d = t.exitDate || t.entryDate || '';
      if (effectiveStartDate && d < effectiveStartDate) return false;
      if (effectiveEndDate   && d > effectiveEndDate)   return false;
      return true;
    });
    return {
      ...calcStats(statsTrades, effectiveBrokerage),
      accountSize:     effectiveAccountSize,
      currency:        settings.currency     || 'USD',
      riskPerTrade:    settings.riskPerTrade || 1,
      brokeragePerLot: effectiveBrokerage,
      statsStartDate:  effectiveStartDate,
      statsEndDate:    effectiveEndDate,
      totalWithdrawals: accountTrades.filter(t=>t.isWithdrawal).reduce((s,t)=>s+Math.abs(t.pnl||0),0),
      withdrawalCount:  accountTrades.filter(t=>t.isWithdrawal).length,
    };
  }, [accountTrades, settings, activeAccount]);

  return (
    <Ctx.Provider value={{
      trades: accountTrades, allTrades: trades,
      settings, setSettings, stats, playbooks, journal,
      accounts, addAccount, updateAccount, deleteAccount,
      activeAccountId, setActiveAccountId, activeAccount,
      addTrade, updateTrade, deleteTrade, clearAllTrades, importTrades,
      updateJournal, getJournal,
      addPlaybook, updatePlaybook, deletePlaybook,
      broker, setBroker,
      cloudStatus, refreshSupabaseClient,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useTrades = () => useContext(Ctx);

function load(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function calcStats(trades, brokeragePerLot = 0) {
  const empty = {
    totalPnl:0, totalGrossPnl:0, totalBrokerage:0,
    winRate:0, totalTrades:0, totalWins:0, totalLosses:0,
    avgWin:0, avgLoss:0, profitFactor:0, avgR:0,
    bestTrade:0, worstTrade:0, expectancy:0, maxDrawdown:0,
    winStreak:0, lossStreak:0, grossProfit:0, grossLoss:0,
    avgHoldMins:0, totalCommissions:0, totalFees:0, maxConsecWins:0, maxConsecLosses:0,
  };
  if (!trades.length) return empty;
  const tradeComm = t => brokeragePerLot > 0 ? brokeragePerLot * (t.size || 0) : (t.fees || 0);
  const netPnl    = t => (t.pnl || 0) - tradeComm(t);
  const totalGrossPnl   = trades.reduce((s,t) => s + (t.pnl||0), 0);
  const totalCommission = trades.reduce((s,t) => s + tradeComm(t), 0);
  const totalPnl        = trades.reduce((s,t) => s + netPnl(t), 0);
  const wins     = trades.filter(t => t.status === 'Win');
  const losses   = trades.filter(t => t.status === 'Loss');
  const wlTrades = trades.filter(t => t.status === 'Win' || t.status === 'Loss');
  const gp = wins.reduce((s,t)   => s + netPnl(t), 0);
  const gl = Math.abs(losses.reduce((s,t) => s + netPnl(t), 0));
  const sorted = [...trades].filter(t=>t.entryDate)
    .sort((a,b) => `${a.entryDate}${a.entryTime||''}`.localeCompare(`${b.entryDate}${b.entryTime||''}`));
  let ws=0,ls=0,maxWs=0,maxLs=0,cw=0,cl=0;
  sorted.forEach(t => {
    if (t.status==='Win')       { cw++; cl=0; maxWs=Math.max(maxWs,cw); }
    else if (t.status==='Loss') { cl++; cw=0; maxLs=Math.max(maxLs,cl); }
  });
  if (sorted.length) { const last=sorted[sorted.length-1]; ws=last.status==='Win'?cw:0; ls=last.status==='Loss'?cl:0; }
  let peak=0, cum=0, maxDD=0;
  sorted.forEach(t => { cum+=netPnl(t); peak=Math.max(peak,cum); maxDD=Math.max(maxDD,peak-cum); });
  const holdMins = trades.map(t => { try { const e=new Date(`${t.entryDate}T${t.entryTime||'00:00'}`); const x=new Date(`${t.exitDate||t.entryDate}T${t.exitTime||'00:00'}`); return Math.abs((x-e)/60000); } catch { return 0; } });
  const avgHold = holdMins.reduce((s,v)=>s+v,0) / holdMins.length;
  const wr  = wlTrades.length ? (wins.length / wlTrades.length) * 100 : 0;
  const pf  = gl > 0 ? gp/gl : gp > 0 ? Infinity : 0;
  const exp = trades.length ? totalPnl / trades.length : 0;
  const netPnlValues = trades.map(t => netPnl(t));
  return {
    totalPnl,
    totalGrossPnl:  parseFloat(totalGrossPnl.toFixed(2)),
    totalBrokerage: parseFloat(totalCommission.toFixed(2)),
    winRate: wr,
    totalTrades:  wlTrades.length,
    totalAllTrades: trades.length,
    totalWins:    wins.length,
    totalLosses:  losses.length,
    totalBreakeven: trades.length - wlTrades.length,
    avgWin:   wins.length   ? gp/wins.length   : 0,
    avgLoss:  losses.length ? gl/losses.length : 0,
    profitFactor: pf,
    avgR: trades.reduce((s,t)=>s+(t.rMultiple||0),0)/trades.length,
    bestTrade:  netPnlValues.length ? Math.max(...netPnlValues) : 0,
    worstTrade: netPnlValues.length ? Math.min(...netPnlValues) : 0,
    expectancy: exp, maxDrawdown: maxDD, winStreak: ws, lossStreak: ls,
    maxConsecWins: maxWs, maxConsecLosses: maxLs,
    grossProfit: gp, grossLoss: gl,
    avgHoldMins: avgHold,
    totalFees:        parseFloat(trades.reduce((s,t)=>s+(t.fees||0),0).toFixed(2)),
    totalCommissions: parseFloat(totalCommission.toFixed(2)),
  };
}
