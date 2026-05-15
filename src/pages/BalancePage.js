import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, LineChart, Line } from 'recharts';
import { useTrades } from '../context/TradesContext';

const fmtA = n => '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtS = n => (n>=0?'+':'-') + fmtA(n);
const clr  = n => n >= 0 ? '#4ade80' : '#f87171';

// Get Monday of the week for a date string
function weekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d);
  mon.setDate(d.getDate() + diff);
  return mon.toISOString().slice(0,10);
}

// Get Sunday of the week
function weekEnd(dateStr) {
  const mon = new Date(weekStart(dateStr) + 'T12:00:00');
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return sun.toISOString().slice(0,10);
}

function fmtWeek(monStr) {
  const d = new Date(monStr + 'T12:00:00');
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' – ' +
    new Date(weekEnd(monStr)+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}

const ChartTip = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:12}}>
      <div style={{color:'var(--text-muted)',marginBottom:4}}>{label}</div>
      {payload.map(p=>(
        <div key={p.name} style={{fontWeight:800,color:p.color||'var(--blue-bright)'}}>
          {p.name === 'Threshold' ? '⚡ Threshold: ' : '💰 Balance: '}{fmtA(p.value)}
        </div>
      ))}
    </div>
  );
};

export default function BalancePage() {
  const { trades, stats, settings, accounts, activeAccountId } = useTrades();

  const today = new Date().toISOString().slice(0,10);
  const [fromDate,   setFromDate]   = useState(stats.statsStartDate || '');
  const [splitRatio, setSplitRatio] = useState(50); // % to withdraw

  const activeAccount = accounts.find(a => a.id === activeAccountId) || null;
  const startingBalance = parseFloat(
    activeAccount?.accountSize || settings.accountSize || 10000
  );

  // Filter to active account
  const accountTrades = useMemo(() => {
    if (!activeAccountId) return trades;
    return trades.filter(t =>
      t.accountId === activeAccountId ||
      (!t.accountId && t.source === activeAccount?.name)
    );
  }, [trades, activeAccountId, activeAccount]);

  // All events sorted chronologically
  const events = useMemo(() => {
    return accountTrades
      .filter(t => {
        const d = t.entryDate || t.exitDate || '';
        if (!d) return false;
        if (fromDate && d < fromDate) return false;
        return true;
      })
      .sort((a,b) => {
        const da=a.entryDate||'', db=b.entryDate||'';
        return da!==db ? da.localeCompare(db) : (a.entryTime||'').localeCompare(b.entryTime||'');
      });
  }, [accountTrades, fromDate]);

  const tradeComm = t => (stats.brokeragePerLot||0) > 0
    ? (stats.brokeragePerLot) * (t.size||0)
    : (t.fees||0);

  // Build rows with running balance
  const rows = useMemo(() => {
    let balance = startingBalance;
    return events.map(t => {
      const isW = t.isWithdrawal;
      const isD = t.isDeposit;
      const isTrade = !isW && !isD;
      const comm = isTrade ? tradeComm(t) : 0;
      const net  = isTrade ? (t.pnl||0) - comm : (t.pnl||0);
      balance += net;
      return { t, net, comm, balance: parseFloat(balance.toFixed(2)), isW, isD, isTrade };
    });
  }, [events, startingBalance]);

  // Group by week and compute weekly stats + profit split rule
  const weeklyData = useMemo(() => {
    if (!rows.length) return [];

    // Group rows by week start
    const byWeek = {};
    rows.forEach(r => {
      const d   = r.t.entryDate || r.t.exitDate || '';
      const key = weekStart(d);
      if (!byWeek[key]) byWeek[key] = { rows:[], tradePnl:0, deposits:0, withdrawals:0, startBalance:null, endBalance:null };
      byWeek[key].rows.push(r);
      if (r.isTrade)  byWeek[key].tradePnl     += r.net;
      if (r.isD)      byWeek[key].deposits      += r.net;
      if (r.isW)      byWeek[key].withdrawals   += Math.abs(r.net);
      byWeek[key].endBalance = r.balance;
    });

    // Set startBalance for each week
    const weeks = Object.keys(byWeek).sort();
    weeks.forEach((wk, i) => {
      byWeek[wk].startBalance = i === 0 ? startingBalance : byWeek[weeks[i-1]].endBalance;
      byWeek[wk].tradePnl     = parseFloat(byWeek[wk].tradePnl.toFixed(2));
    });

    // Apply profit split rule — track rolling threshold
    let threshold = startingBalance;
    return weeks.map(wk => {
      const w = byWeek[wk];
      const weeklyProfit  = w.tradePnl + w.deposits - w.withdrawals;
      const closingBal    = w.endBalance;
      const aboveThresh   = parseFloat((closingBal - threshold).toFixed(2));
      const splitDue      = aboveThresh > 0;
      const withdrawAmt   = splitDue ? parseFloat((aboveThresh * (splitRatio/100)).toFixed(2)) : 0;
      const keepAmt       = splitDue ? parseFloat((aboveThresh - withdrawAmt).toFixed(2))       : 0;
      const newThreshold  = splitDue ? parseFloat((threshold + keepAmt).toFixed(2))              : threshold;

      const result = {
        weekKey:      wk,
        label:        fmtWeek(wk),
        tradePnl:     w.tradePnl,
        deposits:     w.deposits,
        withdrawals:  w.withdrawals,
        startBal:     w.startBalance,
        endBal:       closingBal,
        threshold,
        aboveThresh,
        splitDue,
        withdrawAmt,
        keepAmt,
        newThreshold,
        tradeCount:   w.rows.filter(r=>r.isTrade).length,
      };

      if (splitDue) threshold = newThreshold;
      return result;
    });
  }, [rows, startingBalance, splitRatio]);

  // Chart data
  const chartData = useMemo(() => {
    if (!rows.length) return [];
    const byDay = {};
    rows.forEach(r => { const d=r.t.entryDate||r.t.exitDate||''; byDay[d]=r.balance; });
    // Also build threshold by day from weeklyData
    const threshByWeek = {};
    weeklyData.forEach(w => { threshByWeek[w.weekKey] = w.threshold; });
    const weeks = Object.keys(threshByWeek).sort();

    return Object.entries(byDay).sort(([a],[b])=>a.localeCompare(b)).map(([date, balance]) => {
      // Find which week this day belongs to
      const wk = weekStart(date);
      const threshIdx = weeks.findIndex(w => w > wk);
      const threshWk  = threshIdx > 0 ? weeks[threshIdx-1] : weeks[0];
      const threshold = threshByWeek[threshWk] || startingBalance;
      return { date: date.slice(5), balance, threshold };
    });
  }, [rows, weeklyData, startingBalance]);

  // Summaries
  const currentBalance   = rows.length ? rows[rows.length-1].balance : startingBalance;
  const totalProfitTaken = rows.filter(r=>r.isW).reduce((s,r)=>s+Math.abs(r.net),0);
  const totalDeposits    = rows.filter(r=>r.isD).reduce((s,r)=>s+r.net,0);
  const totalTradePnl    = rows.filter(r=>r.isTrade).reduce((s,r)=>s+r.net,0);
  const currentThreshold = weeklyData.length ? weeklyData[weeklyData.length-1].newThreshold : startingBalance;
  const nextWithdrawDue  = weeklyData.length ? weeklyData[weeklyData.length-1].splitDue : false;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Account Balance</div>
          <div className="page-sub">Running balance, profit split rule, and transaction history</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <label style={{fontSize:12,color:'var(--text-secondary)',fontWeight:600}}>From:</label>
          <input type="date" className="form-control" style={{width:155,padding:'6px 10px',fontSize:12}}
            value={fromDate} onChange={e=>setFromDate(e.target.value)}/>
          {fromDate && <button className="btn btn-ghost btn-sm" onClick={()=>setFromDate('')}>✕</button>}
        </div>
      </div>

      <div className="page-body">

        {/* ── Summary cards ── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14,marginBottom:20}}>
          {[
            {label:'STARTING BALANCE', val:fmtA(startingBalance), color:'var(--text-primary)',   icon:'🏦'},
            {label:'TOTAL DEPOSITS',   val:'+'+fmtA(totalDeposits), color:'#4ade80',             icon:'💰'},
            {label:'PROFIT TAKEN OUT', val:'-'+fmtA(totalProfitTaken), color:'#f59e0b',          icon:'💸'},
            {label:'TRADE P&L (NET)',  val:fmtS(totalTradePnl), color:clr(totalTradePnl),        icon:'📈'},
            {label:'CURRENT BALANCE',  val:fmtA(currentBalance), color:clr(currentBalance-startingBalance), icon:'💵', big:true},
          ].map(s=>(
            <div key={s.label} style={{
              background:'var(--bg-card)',
              border:`1px solid ${s.big?'rgba(59,130,246,.3)':'var(--border)'}`,
              borderRadius:10, padding:'16px 18px',
            }}>
              <div style={{fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.8px',marginBottom:8}}>{s.label}</div>
              <div style={{fontSize:s.big?24:19,fontWeight:900,color:s.color,letterSpacing:'-0.5px'}}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* ── Profit Split Rule ── */}
        <div className="card" style={{marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:14}}>
            <div>
              <div className="card-title" style={{margin:0}}>⚡ Profit Split Rule</div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4}}>
                At the end of each week, if your balance is above the threshold, you withdraw {splitRatio}% of the excess and keep {100-splitRatio}%.
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:12,color:'var(--text-secondary)',fontWeight:600}}>Split ratio:</span>
                {[25,33,50,60,75].map(r=>(
                  <button key={r} onClick={()=>setSplitRatio(r)} style={{
                    padding:'5px 12px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer',border:'1px solid',
                    background: splitRatio===r?'rgba(59,130,246,.25)':'var(--bg-hover)',
                    color:      splitRatio===r?'var(--blue-bright)':'var(--text-secondary)',
                    borderColor:splitRatio===r?'rgba(59,130,246,.4)':'var(--border)',
                  }}>{r}%</button>
                ))}
              </div>
              <div style={{padding:'10px 18px',background:'var(--bg-hover)',borderRadius:8,border:'1px solid var(--border)'}}>
                <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:2}}>CURRENT THRESHOLD</div>
                <div style={{fontSize:18,fontWeight:900,color:'#f59e0b'}}>{fmtA(currentThreshold)}</div>
                <div style={{fontSize:10,color:'var(--text-muted)'}}>balance must exceed this to trigger split</div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Balance + Threshold chart ── */}
        {chartData.length > 1 && (
          <div className="card" style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div className="card-title" style={{margin:0}}>Balance vs Threshold</div>
              <div style={{display:'flex',gap:16,fontSize:11}}>
                <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:12,height:3,background:'#3b82f6',display:'inline-block',borderRadius:2}}/>Balance</span>
                <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:12,height:3,background:'#f59e0b',borderStyle:'dashed',borderTop:'2px dashed #f59e0b',display:'inline-block'}}/>Threshold</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={chartData} margin={{top:5,right:10,left:10,bottom:0}}>
                <defs>
                  <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40}/>
                <YAxis tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=>`$${(v/1000).toFixed(1)}k`} width={50}/>
                <Tooltip content={<ChartTip/>}/>
                <Area type="monotone" dataKey="balance"   stroke="#3b82f6" strokeWidth={2.5} fill="url(#balGrad)" dot={false} name="Balance"   activeDot={{r:4,strokeWidth:0}}/>
                <Line  type="stepAfter" dataKey="threshold" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" dot={false} name="Threshold"/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* ── Weekly breakdown table ── */}
        <div className="card" style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div>
              <div className="card-title" style={{margin:0}}>📅 Weekly Breakdown</div>
              <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>End-of-week balance vs threshold · {splitRatio}% split rule applied</div>
            </div>
          </div>
          {weeklyData.length === 0 ? (
            <div style={{textAlign:'center',padding:'30px',color:'var(--text-muted)',fontSize:13}}>No weekly data yet</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'2px solid var(--border)'}}>
                    {['Week','Trades','Trade P&L','Closing Balance','Threshold','Above?','Take Out','Keep','New Threshold'].map(h=>(
                      <th key={h} style={{padding:'8px 10px',textAlign:h==='Week'||h==='Trades'?'left':'right',fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.4px',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...weeklyData].reverse().map((w,i)=>(
                    <tr key={w.weekKey} style={{borderBottom:'1px solid var(--border)',background:w.splitDue?'rgba(245,158,11,.04)':''}}
                      onMouseEnter={e=>e.currentTarget.style.background=w.splitDue?'rgba(245,158,11,.08)':'var(--bg-hover)'}
                      onMouseLeave={e=>e.currentTarget.style.background=w.splitDue?'rgba(245,158,11,.04)':''}>
                      <td style={{padding:'10px 10px',whiteSpace:'nowrap'}}>
                        <div style={{fontWeight:600,fontSize:12}}>{w.label}</div>
                      </td>
                      <td style={{padding:'10px 10px',color:'var(--text-muted)',fontSize:12}}>{w.tradeCount}</td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:700,color:clr(w.tradePnl),whiteSpace:'nowrap'}}>
                        {w.tradePnl>=0?'+':''}{fmtA(w.tradePnl)}
                      </td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:800,whiteSpace:'nowrap',color:w.endBal>=w.threshold?'#4ade80':'var(--text-primary)'}}>
                        {fmtA(w.endBal)}
                      </td>
                      <td style={{padding:'10px 10px',textAlign:'right',color:'#f59e0b',fontWeight:700,whiteSpace:'nowrap'}}>
                        {fmtA(w.threshold)}
                      </td>
                      <td style={{padding:'10px 10px',textAlign:'right'}}>
                        {w.splitDue ? (
                          <span style={{background:'rgba(245,158,11,.15)',color:'#f59e0b',borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>
                            +{fmtA(w.aboveThresh)} ⚡
                          </span>
                        ) : (
                          <span style={{color:'var(--text-muted)',fontSize:11}}>Below</span>
                        )}
                      </td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:700,color:w.splitDue?'#f87171':'var(--text-muted)',whiteSpace:'nowrap'}}>
                        {w.splitDue ? '-'+fmtA(w.withdrawAmt) : '—'}
                      </td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:700,color:w.splitDue?'#4ade80':'var(--text-muted)',whiteSpace:'nowrap'}}>
                        {w.splitDue ? '+'+fmtA(w.keepAmt) : '—'}
                      </td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:800,color:'#f59e0b',whiteSpace:'nowrap'}}>
                        {fmtA(w.newThreshold)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Transaction history ── */}
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div className="card-title" style={{margin:0}}>Transaction History</div>
            <div style={{fontSize:12,color:'var(--text-muted)'}}>{rows.length} entries{fromDate?' from '+fmtDate(fromDate):''}</div>
          </div>
          {rows.length === 0 ? (
            <div style={{textAlign:'center',padding:'40px',color:'var(--text-muted)'}}>
              <div style={{fontSize:32,marginBottom:10}}>📊</div>
              <div>No transactions found</div>
            </div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    {['Date','Type','Description','Change','Commission','Balance'].map(h=>(
                      <th key={h} style={{padding:'8px 12px',textAlign:h==='Date'||h==='Type'||h==='Description'?'left':'right',fontSize:11,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.4px',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr style={{borderBottom:'1px solid var(--border)',background:'rgba(59,130,246,.04)'}}>
                    <td style={{padding:'10px 12px',color:'var(--text-muted)',fontSize:12}}>{fromDate?fmtDate(fromDate):'Start'}</td>
                    <td style={{padding:'10px 12px'}}><span style={{background:'rgba(59,130,246,.15)',color:'var(--blue-bright)',borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700}}>Opening</span></td>
                    <td style={{padding:'10px 12px',color:'var(--text-secondary)'}}>Starting balance</td>
                    <td style={{padding:'10px 12px',textAlign:'right'}}>—</td>
                    <td style={{padding:'10px 12px',textAlign:'right'}}>—</td>
                    <td style={{padding:'10px 12px',textAlign:'right',fontWeight:800,color:'var(--blue-bright)'}}>{fmtA(startingBalance)}</td>
                  </tr>
                  {[...rows].reverse().map((r,i)=>{
                    const {t,net,comm,balance,isW,isD,isTrade}=r;
                    const typeLabel = isW?'Profit Taken':isD?'Deposit':t.status;
                    const typeBg    = isW?'rgba(245,158,11,.12)':isD?'rgba(74,222,128,.12)':t.status==='Win'?'rgba(59,130,246,.12)':t.status==='Loss'?'rgba(239,68,68,.12)':'var(--bg-hover)';
                    const typeClr   = isW?'#f59e0b':isD?'#4ade80':t.status==='Win'?'var(--blue-bright)':t.status==='Loss'?'var(--red)':'var(--text-muted)';
                    const desc = isW?(t.notes||'Profit withdrawal'):isD?(t.notes||'Deposit'):`${t.symbol} ${t.side}`;
                    return (
                      <tr key={t.id||i} style={{borderBottom:'1px solid var(--border)',transition:'background .1s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                        onMouseLeave={e=>e.currentTarget.style.background=''}>
                        <td style={{padding:'10px 12px',color:'var(--text-secondary)',fontSize:12,whiteSpace:'nowrap'}}>{fmtDate(t.entryDate)}</td>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}>
                          <span style={{background:typeBg,color:typeClr,borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700}}>{typeLabel}</span>
                        </td>
                        <td style={{padding:'10px 12px',color:'var(--text-primary)',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{desc}</td>
                        <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:net>=0?'#4ade80':'#f87171',whiteSpace:'nowrap'}}>
                          {net>=0?'+':''}{net<0?'-'+fmtA(Math.abs(net)):fmtA(net)}
                        </td>
                        <td style={{padding:'10px 12px',textAlign:'right',color:'var(--text-muted)',whiteSpace:'nowrap'}}>{comm>0?'-$'+comm.toFixed(2):'—'}</td>
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
