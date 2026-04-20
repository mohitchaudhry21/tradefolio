import React, { useState, useEffect } from 'react';
import { useTrades } from '../context/TradesContext';

const SYNC_SERVER = 'http://localhost:8765';

const BROKERS = [
  { name:'FortressFX',           server:'FortressFX-Trade' },
  { name:'IC Markets',           server:'ICMarketsSC-Live' },
  { name:'Pepperstone',          server:'Pepperstone-Live01' },
  { name:'XM',                   server:'XMGlobal-Real' },
  { name:'Exness',               server:'Exness-Real' },
  { name:'HFM (HotForex)',       server:'HFMarkets-Live' },
  { name:'OctaFX',               server:'OctaFX-Real' },
  { name:'FBS',                  server:'FBS-Real' },
  { name:'FXTM',                 server:'FXTM-Real' },
  { name:'Alpari',               server:'Alpari-MT5-Live' },
  { name:'FTMO',                 server:'FTMO-Server' },
  { name:'MyForexFunds',         server:'MyForexFunds-Live' },
  { name:'The Funded Trader',    server:'TheFundedTrader-Live' },
  { name:'E8 Funding',           server:'E8-Live' },
  { name:'Other (type manually)',server:'' },
];

export default function BrokerConnect() {
  const { broker, setBroker, importTrades, accounts, stats } = useTrades();
  const [serverOnline, setServerOnline] = useState(false);
  const [checking,     setChecking]     = useState(true);
  const [loading,      setLoading]      = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [error,        setError]        = useState('');
  const [syncMsg,      setSyncMsg]      = useState('');
  const [days, setDays] = useState(1825);
  const [accountInfo,  setAccountInfo]  = useState(null);
  const [syncAccountId, setSyncAccountId] = useState('');
  const [form, setForm] = useState({
    login:'', password:'', server:'', broker:'', platform:'MT5',
  });

  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const checkServer = async () => {
    setChecking(true);
    try {
      const res = await fetch(`${SYNC_SERVER}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) { setServerOnline(true); }
    } catch { setServerOnline(false); }
    finally { setChecking(false); }
  };

  const fetchAccountInfo = async () => {
    try {
      const res = await fetch(`${SYNC_SERVER}/account`);
      if (res.ok) setAccountInfo(await res.json());
    } catch {}
  };

  // On mount: check server, and if already connected restore account info
  useEffect(() => {
    checkServer();
    if (broker.connected) {
      fetchAccountInfo();
    }
  }, []);

  const handleConnect = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch(`${SYNC_SERVER}/connect`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ login:form.login, password:form.password, server:form.server, broker:form.broker, platform:form.platform }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error||'Connection failed');
      const brokerName = data.account.broker || form.broker;
      setBroker({ connected:true, name:brokerName, login:form.login, password:form.password, server:form.server, platform:form.platform });
      setAccountInfo(data.account);
      // Auto-match to a registered account by name or source
      const matched = accounts.find(a =>
        a.source?.toLowerCase() === brokerName.toLowerCase() ||
        a.name?.toLowerCase() === brokerName.toLowerCase() ||
        (form.login && a.accountNumber === form.login)
      );
      if (matched) setSyncAccountId(matched.id);
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleSync = async () => {
    setSyncing(true); setSyncMsg('');
    try {
      const chosenAccountId = syncAccountId || null;
      const chosenAccount = accounts.find(a => a.id === chosenAccountId);
      // Use account start date if set, otherwise global start date, otherwise slider
      const startDate = (chosenAccount?.statsStartDate) || (stats.statsStartDate) || '';
      let effectiveDays = parseInt(days) || 1825;
      if (startDate) {
        const msPerDay = 86400000;
        const daysFromStart = Math.ceil((Date.now() - new Date(startDate).getTime()) / msPerDay) + 1;
        // Only override if the calculation is valid and gives a reasonable number
        if (!isNaN(daysFromStart) && daysFromStart > 0 && daysFromStart < 99999) {
          effectiveDays = daysFromStart;
        }
      }

      const res  = await fetch(`${SYNC_SERVER}/trades?days=${effectiveDays}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.trades?.length > 0) {
        // Filter out trades outside the account's date range before importing
        // Also filter out open positions (isOpen=true) — we don't track floating P&L
        let tradesToImport = data.trades.filter(t => !t.isOpen);
        if (startDate) {
          tradesToImport = tradesToImport.filter(t => {
            const d = t.exitDate || t.entryDate || '';
            return !d || d >= startDate;
          });
        }
        importTrades(tradesToImport, data.account, chosenAccountId);
        const accLabel = chosenAccount ? ` → ${chosenAccount.name}` : '';
        const rangeLabel = startDate ? ` · from ${startDate}` : '';
        const closeMsg = tradesToImport.filter(t => !t.isOpen).length;
        setSyncMsg(`✓ Synced: ${closeMsg} closed${accLabel}${rangeLabel}`);
      } else {
        setSyncMsg(`No trades found${startDate ? ` from ${startDate}` : ` in the last ${effectiveDays} days`}.`);
      }
    } catch(err) { setSyncMsg(`Error: ${err.message}`); }
    finally { setSyncing(false); }
  };

  const handleDisconnect = async () => {
    try { await fetch(`${SYNC_SERVER}/disconnect`,{method:'POST'}); } catch {}
    setBroker({connected:false,name:'',login:'',password:'',server:'',platform:'MT5'});
    setAccountInfo(null); setSyncMsg('');
  };

  const selectBroker = name => {
    const b = BROKERS.find(x=>x.name===name);
    setForm(f=>({...f,broker:name,server:b?.server||''}));
  };

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Broker Connect</div><div className="page-sub">Connect directly with your MT5 login ID and investor password — 100% free, no third-party needed</div></div>
        <button className="btn btn-secondary btn-sm" onClick={checkServer}>↻ Check Server</button>
      </div>

      <div className="page-body" style={{maxWidth:680}}>

        {/* Server status card */}
        <div className="card" style={{marginBottom:16,border:`1px solid ${serverOnline?'rgba(34,197,94,.3)':'rgba(239,68,68,.25)'}`,background:serverOnline?'rgba(34,197,94,.04)':'rgba(239,68,68,.04)'}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:40,height:40,borderRadius:10,background:serverOnline?'rgba(34,197,94,.15)':'var(--red-dim)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>
              {checking?'⏳':serverOnline?'✅':'❌'}
            </div>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:14}}>Sync Server — {checking?'Checking...':serverOnline?'Running ✓':'Not Running'}</div>
              <div style={{fontSize:12,color:'var(--text-secondary)',marginTop:2}}>
                {serverOnline?'Server is online at localhost:8765. You can now connect your broker below.':'Start the sync server first. Instructions below ↓'}
              </div>
            </div>
          </div>

          {!serverOnline && !checking && (
            <div style={{marginTop:14,background:'var(--bg-hover)',borderRadius:8,padding:'14px'}}>
              <div style={{fontWeight:700,marginBottom:10,fontSize:13}}>📋 Start the sync server:</div>
              {[
                'Make sure Python is installed from python.org (tick "Add to PATH")',
                'Open the sync-server folder inside your trading-journal folder',
                'Double-click  START-SERVER.bat',
                'A black window appears — keep it open',
                'Click ↻ Check Server above',
              ].map((s,i)=>(
                <div key={i} style={{display:'flex',gap:8,marginBottom:6,fontSize:12}}>
                  <span style={{width:18,height:18,background:'var(--blue)',borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'#fff',flexShrink:0}}>{i+1}</span>
                  <span style={{color:'var(--text-secondary)'}}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Connected */}
        {broker.connected && accountInfo ? (
          <div className="card" style={{border:'1px solid rgba(59,130,246,.3)'}}>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
              <div style={{width:44,height:44,background:'var(--blue-dim)',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20}}>🔗</div>
              <div style={{flex:1}}>
                <div style={{fontWeight:700,fontSize:15}}>{accountInfo.company||broker.name}</div>
                <div style={{fontSize:12,color:'var(--text-secondary)'}}>Login: {accountInfo.login} · {accountInfo.server}</div>
              </div>
              <span style={{display:'flex',alignItems:'center',gap:5,fontSize:12,fontWeight:600,color:'var(--green)'}}>
                <span style={{width:8,height:8,background:'var(--green)',borderRadius:'50%',display:'inline-block'}}/> Live
              </span>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:16}}>
              {[['Balance',`$${(accountInfo.balance||0).toFixed(2)}`],['Equity',`$${(accountInfo.equity||0).toFixed(2)}`],['Open P&L',`$${(accountInfo.profit||0).toFixed(2)}`],['Currency',accountInfo.currency||'USD']].map(([l,v])=>(
                <div key={l} style={{background:'var(--bg-hover)',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:600,marginBottom:3}}>{l}</div>
                  <div style={{fontWeight:700,fontSize:14}}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
              <select className="filter-inp" value={days} onChange={e=>setDays(e.target.value)} style={{width:150}}>
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
                <option value={180}>Last 6 months</option>
                <option value={365}>Last 1 year</option>
                <option value={1825}>All time (5yr)</option>
              </select>
              {accounts.length > 0 && (
                <select className="filter-inp" value={syncAccountId} onChange={e=>setSyncAccountId(e.target.value)} style={{minWidth:180}}>
                  <option value="">— Assign to account —</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}{a.accountNumber?` #${a.accountNumber}`:''}</option>
                  ))}
                </select>
              )}
              <button className="btn btn-primary" onClick={handleSync} disabled={syncing||!serverOnline}>{syncing?'⏳ Syncing...':'↻ Sync Trades'}</button>
              <button className="btn btn-danger" onClick={handleDisconnect}>Disconnect</button>
            </div>

            {syncMsg&&<div style={{marginTop:12,padding:'9px 12px',background:syncMsg.startsWith('✓')?'var(--blue-dim)':'var(--red-dim)',borderRadius:7,fontSize:13,color:syncMsg.startsWith('✓')?'var(--blue-bright)':'var(--red)'}}>{syncMsg}</div>}
          </div>

        ) : (
          /* Login form */
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div className="card" style={{opacity:serverOnline?1:.45,pointerEvents:serverOnline?'auto':'none'}}>
              <div className="card-title">🔐 Log In with Investor Password</div>
              <div style={{padding:'10px 12px',background:'var(--blue-dim)',borderRadius:8,fontSize:12,color:'var(--text-secondary)',marginBottom:16,lineHeight:1.7}}>
                Use your <strong style={{color:'var(--text-primary)'}}>investor (read-only) password</strong> — not your main trading password. This cannot place or modify trades. Find it in MT5 under <strong style={{color:'var(--text-primary)'}}>Tools → Options → Server</strong>.
              </div>

              <form onSubmit={handleConnect}>
                <div className="form-row cols-2" style={{marginBottom:14}}>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Platform</label>
                    <select className="form-control" value={form.platform} onChange={e=>set('platform',e.target.value)}>
                      <option>MT5</option><option>MT4</option>
                    </select>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Broker</label>
                    <select className="form-control" value={form.broker} onChange={e=>selectBroker(e.target.value)}>
                      <option value="">Select broker...</option>
                      {BROKERS.map(b=><option key={b.name}>{b.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Server Name</label>
                  <input className="form-control" placeholder="e.g. FortressFX-Trade" value={form.server} onChange={e=>set('server',e.target.value)} required/>
                  <div style={{fontSize:11,color:'var(--text-muted)',marginTop:4}}>Find in MT5: File → Open an Account → search broker → copy server name exactly</div>
                </div>

                <div className="form-row cols-2">
                  <div className="form-group">
                    <label className="form-label">Account Number (Login ID)</label>
                    <input className="form-control" type="number" placeholder="e.g. 12345678" value={form.login} onChange={e=>set('login',e.target.value)} required/>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Investor Password</label>
                    <input className="form-control" type="password" placeholder="Read-only investor password" value={form.password} onChange={e=>set('password',e.target.value)} required/>
                  </div>
                </div>

                {error&&<div style={{marginBottom:14,padding:'10px 12px',background:'var(--red-dim)',border:'1px solid rgba(239,68,68,.2)',borderRadius:7,fontSize:13,color:'var(--red)'}}>❌ {error}</div>}
                <button type="submit" className="btn btn-primary" disabled={loading} style={{width:'100%',justifyContent:'center',padding:11}}>{loading?'⏳ Connecting...':'🔗 Connect Account'}</button>
              </form>
            </div>

            {/* Investor password guide */}
            <div className="card">
              <div className="card-title">📍 Where to Find Your Investor Password</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                {[
                  {p:'MT5',steps:['Open MT5 terminal','Tools → Options','Click Server tab','See Investor password','Copy it exactly']},
                  {p:'MT4',steps:['Open MT4 terminal','Tools → Options','Click Server tab','See Investor password','Copy it exactly']},
                ].map(({p,steps})=>(
                  <div key={p} style={{background:'var(--bg-hover)',borderRadius:8,padding:'12px 14px'}}>
                    <div style={{fontWeight:700,fontSize:12,marginBottom:8}}>{p} Terminal</div>
                    {steps.map((s,i)=>(
                      <div key={i} style={{display:'flex',gap:6,marginBottom:4,fontSize:11}}>
                        <span style={{color:'var(--blue)',fontWeight:700}}>{i+1}.</span>
                        <span style={{color:'var(--text-secondary)'}}>{s}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div style={{padding:'9px 12px',background:'var(--yellow-dim)',borderRadius:7,fontSize:12,color:'var(--yellow)',border:'1px solid rgba(245,158,11,.2)'}}>
                ⚠️ The MetaTrader5 Python package works on <strong>Windows only</strong>. MT5 is recommended over MT4 for best compatibility.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
