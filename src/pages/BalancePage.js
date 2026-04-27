import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useTrades } from '../context/TradesContext';

const fmt  = n => `${n>=0?'+':'-'}$${Math.abs(n).toFixed(2)}`;
const fmtA = n => `$${Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

const ChartTip = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:12}}>
      <div style={{color:'var(--text-muted)',marginBottom:3}}>{label}</div>
      <div style={{fontWeight:800,color:'var(--blue-bright)'}}>{fmtA(payload[0].value)}</div>
    </div>
  );
};

export default function BalancePage() {
  const { trades, stats, settings, accounts, activeAccountId } = useTrades();

  const today = new Date().toISOString().slice(0,10);
  const [fromDate, setFromDate] = useState(stats.statsStartDate || '');

  // Build chronological list of all events (trades + deposits + withdrawals)
  const events = useMemo(() => {
    const accountTrades = activeAccountId
      ? trades.filter(t => t.accountId === activeAccountId || (!t.accountId && t.source === accounts.find(a=>a.id===activeAccountId)?.name))
      : trades;

    return accountTrades
      .filter(t => {
        const d = t.entryDate || t.exitDate || '';
        if (!d) return false;
        if (fromDate && d < fromDate) return false;
        return true;
      })
      .sort((a,b) => {
        const da = a.entryDate||'', db = b.entryDate||'';
        if (da !== db) return da.localeCompare(db);
        const ta = a.entryTime||'', tb = b.entryTime||'';
        return ta.localeCompare(tb);
      });
  }, [trades, fromDate, activeAccountId, accounts]);

  // Running balance calculation
  const startingBalance = parseFloat(
    (activeAccountId ? accounts.find(a=>a.id===activeAccountId)?.accountSize : null) ||
    settings.accountSize || 10000
  );

  const rows = useMemo(() => {
    let balance = startingBalance;
    return events.map(t => {
      const isW = t.isWithdrawal;
      const isD = t.isDeposit;
      const isTrade = !isW && !isD;
      const change = parseFloat(t.pnl || 0);
      // Commission for trades
      const comm = isTrade
        ? (stats.brokeragePerLot > 0 ? stats.brokeragePerLot * (t.size||0) : (t.fees||0))
        : 0;
      const net = isTrade ? change - comm : change;
      balance += net;
      return { t, net, comm, balance: parseFloat(balance.toFixed(2)), isW, isD, isTrade };
    });
  }, [events, startingBalance, stats.brokeragePerLot]);

  // Chart data — one point per day
  const chartData = useMemo(() => {
    if (!rows.length) return [];
    const byDay = {};
    rows.forEach(r => {
      const d = r.t.entryDate || r.t.exitDate || '';
      byDay[d] = r.balance; // last balance of each day
    });
    return Object.entries(byDay)
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([date, balance]) => ({ date: date.slice(5), balance }));
  }, [rows]);

  // Summary stats
  const summary = useMemo(() => {
    const totalDeposits    = rows.filter(r=>r.isD).reduce((s,r)=>s+r.net,0);
    const totalWithdrawals = Math.abs(rows.filter(r=>r.isW).reduce((s,r)=>s+r.net,0));
    const totalTradePnl    = rows.filter(r=>r.isTrade).reduce((s,r)=>s+r.net,0);
    const currentBalance   = rows.length ? rows[rows.length-1].balance : startingBalance;
    const totalComm        = rows.filter(r=>r.isTrade).reduce((s,r)=>s+r.comm,0);
    return { totalDeposits, totalWithdrawals, totalTradePnl, currentBalance, totalComm };
  }, [rows, startingBalance]);

  const fmtDate = d => {
    if (!d) return '';
    const dt = new Date(d + 'T12:00:00');
    return dt.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Account Balance</div>
          <div className="page-sub">Running balance including trades, deposits and withdrawals</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <label style={{fontSize:12,color:'var(--text-secondary)',fontWeight:600}}>From date:</label>
          <input type="date" className="form-control" style={{width:160,padding:'6px 10px',fontSize:12}}
            value={fromDate} onChange={e=>setFromDate(e.target.value)}/>
          {fromDate && <button className="btn btn-ghost btn-sm" onClick={()=>setFromDate('')}>✕ Clear</button>}
        </div>
      </div>

      <div className="page-body">

        {/* Summary cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14,marginBottom:20}}>
          {[
            {label:'STARTING BALANCE', val:fmtA(startingBalance), color:'var(--text-primary)', icon:'🏦'},
            {label:'TOTAL DEPOSITS',   val:`+${fmtA(summary.totalDeposits)}`, color:'#4ade80', icon:'💰'},
            {label:'TOTAL WITHDRAWALS',val:`-${fmtA(summary.totalWithdrawals)}`, color:'#f87171', icon:'💸'},
            {label:'TRADE P&L (NET)',  val:fmt(summary.totalTradePnl), color:summary.totalTradePnl>=0?'var(--blue-bright)':'var(--red)', icon:'📈'},
            {label:'CURRENT BALANCE',  val:fmtA(summary.currentBalance), color:summary.currentBalance>=startingBalance?'#4ade80':'#f87171', icon:'💵', big:true},
          ].map(s=>(
            <div key={s.label} style={{
              background:'var(--bg-card)', border:`1px solid ${s.big?'rgba(59,130,246,.3)':'var(--border)'}`,
              borderRadius:10, padding:'16px 18px',
              boxShadow: s.big?'0 0 0 1px rgba(59,130,246,.1)':'none',
            }}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.8px',marginBottom:8}}>{s.label}</div>
              <div style={{fontSize:s.big?24:20,fontWeight:900,color:s.color,letterSpacing:'-0.5px'}}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* Balance chart */}
        {chartData.length > 1 && (
          <div className="card" style={{marginBottom:20}}>
            <div className="card-title">Balance Over Time</div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{top:5,right:10,left:10,bottom:0}}>
                <defs>
                  <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40}/>
                <YAxis tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={50}/>
                <Tooltip content={<ChartTip/>}/>
                <ReferenceLine y={startingBalance} stroke="rgba(255,255,255,.15)" strokeDasharray="4 4"/>
                <Area type="monotone" dataKey="balance" stroke="#3b82f6" strokeWidth={2} fill="url(#balGrad)" dot={false} activeDot={{r:4,strokeWidth:0}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Transaction history */}
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div className="card-title" style={{margin:0}}>Transaction History</div>
            <div style={{fontSize:12,color:'var(--text-muted)'}}>{rows.length} entries {fromDate?`from ${fmtDate(fromDate)}`:''}</div>
          </div>

          {rows.length === 0 ? (
            <div style={{textAlign:'center',padding:'40px 0',color:'var(--text-muted)'}}>
              <div style={{fontSize:32,marginBottom:10}}>📊</div>
              <div>No transactions found{fromDate?` from ${fmtDate(fromDate)}`:''}</div>
              <div style={{fontSize:12,marginTop:6}}>Add trades, deposits or withdrawals to see your balance history</div>
            </div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    {['Date','Type','Description','Change','Commission','Balance'].map(h=>(
                      <th key={h} style={{padding:'8px 12px',textAlign:h==='Change'||h==='Commission'||h==='Balance'?'right':'left',fontSize:11,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.5px',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Starting balance row */}
                  <tr style={{borderBottom:'1px solid var(--border)',background:'rgba(59,130,246,.04)'}}>
                    <td style={{padding:'10px 12px',color:'var(--text-muted)',fontSize:12}}>{fromDate ? fmtDate(fromDate) : 'Start'}</td>
                    <td style={{padding:'10px 12px'}}><span style={{background:'rgba(59,130,246,.15)',color:'var(--blue-bright)',borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700}}>Opening</span></td>
                    <td style={{padding:'10px 12px',color:'var(--text-secondary)'}}>Starting balance</td>
                    <td style={{padding:'10px 12px',textAlign:'right'}}>—</td>
                    <td style={{padding:'10px 12px',textAlign:'right'}}>—</td>
                    <td style={{padding:'10px 12px',textAlign:'right',fontWeight:800,color:'var(--blue-bright)'}}>{fmtA(startingBalance)}</td>
                  </tr>
                  {[...rows].reverse().map((r,i)=>{
                    const { t, net, comm, balance, isW, isD, isTrade } = r;
                    const typeLabel = isW ? 'Withdrawal' : isD ? 'Deposit' : t.status;
                    const typeBg    = isW ? 'rgba(239,68,68,.12)'  : isD ? 'rgba(74,222,128,.12)'  : t.status==='Win'?'rgba(59,130,246,.12)':t.status==='Loss'?'rgba(239,68,68,.12)':'var(--bg-hover)';
                    const typeColor = isW ? 'var(--red)'           : isD ? '#4ade80'               : t.status==='Win'?'var(--blue-bright)':t.status==='Loss'?'var(--red)':'var(--text-muted)';
                    const desc = isW ? (t.notes||'Withdrawal') : isD ? (t.notes||'Deposit') : `${t.symbol} ${t.side}`;
                    return (
                      <tr key={t.id||i} style={{borderBottom:'1px solid var(--border)',transition:'background .1s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                        onMouseLeave={e=>e.currentTarget.style.background=''}>
                        <td style={{padding:'10px 12px',color:'var(--text-secondary)',whiteSpace:'nowrap',fontSize:12}}>{fmtDate(t.entryDate)}</td>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                          <span style={{background:typeBg,color:typeColor,borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700}}>{typeLabel}</span>
                        </td>
                        <td style={{padding:'10px 12px',color:'var(--text-primary)',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{desc}</td>
                        <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:net>=0?'var(--blue-bright)':'var(--red)',whiteSpace:'nowrap'}}>
                          {net>=0?'+':''}{fmtA(net).replace('$',net>=0?'$':'-$').replace('--','-')}
                          {net<0?`-${fmtA(Math.abs(net))}`:fmtA(net)}
                        </td>
                        <td style={{padding:'10px 12px',textAlign:'right',color:'var(--text-muted)',whiteSpace:'nowrap'}}>
                          {comm>0?`-$${comm.toFixed(2)}`:'—'}
                        </td>
                        <td style={{padding:'10px 12px',textAlign:'right',fontWeight:800,color:balance>=startingBalance?'#4ade80':'#f87171',whiteSpace:'nowrap'}}>{fmtA(balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
