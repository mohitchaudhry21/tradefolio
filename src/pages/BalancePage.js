import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTrades } from '../context/TradesContext';

const fmtA = n => '$' + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtS = n => (n>=0?'+':'-') + fmtA(n);
const clr  = n => n >= 0 ? '#4ade80' : '#f87171';

function weekStart(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(d); mon.setDate(d.getDate() + diff);
  return mon.toISOString().slice(0,10);
}
function weekEnd(dateStr) {
  const mon = new Date(weekStart(dateStr) + 'T12:00:00');
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return sun.toISOString().slice(0,10);
}
function fmtWeek(monStr) {
  return new Date(monStr+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})
    + ' – ' + new Date(weekEnd(monStr)+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
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
        <div key={p.name} style={{fontWeight:800,color:p.color||'var(--blue-bright)',marginBottom:2}}>
          {p.name==='threshold'?'⚡ Threshold: ':'💰 Balance: '}{fmtA(p.value)}
        </div>
      ))}
    </div>
  );
};

export default function BalancePage() {
  const { trades, stats, settings, accounts, activeAccountId, updateTrade } = useTrades();
  const [fromDate,   setFromDate]   = useState(stats.statsStartDate || '');
  const [splitRatio, setSplitRatio] = useState(50);

  const activeAccount = accounts.find(a => a.id === activeAccountId) || null;
  const startingBalance = parseFloat(activeAccount?.accountSize || settings.accountSize || 10000);

  const accountTrades = useMemo(() => {
    if (!activeAccountId) return trades;
    return trades.filter(t => t.accountId === activeAccountId || (!t.accountId && t.source === activeAccount?.name));
  }, [trades, activeAccountId, activeAccount]);

  const events = useMemo(() => accountTrades
    .filter(t => { const d=t.entryDate||t.exitDate||''; return d && (!fromDate || d >= fromDate); })
    .sort((a,b) => { const da=a.entryDate||'',db=b.entryDate||''; return da!==db?da.localeCompare(db):(a.entryTime||'').localeCompare(b.entryTime||''); }),
  [accountTrades, fromDate]);

  const tradeComm = t => (stats.brokeragePerLot||0) > 0 ? (stats.brokeragePerLot)*(t.size||0) : (t.fees||0);

  const rows = useMemo(() => {
    let balance = startingBalance;
    return events.map(t => {
      const isW=t.isWithdrawal, isD=t.isDeposit, isTrade=!isW&&!isD;
      const comm=isTrade?tradeComm(t):0;
      const net=isTrade?(t.pnl||0)-comm:(t.pnl||0);
      balance += net;
      return { t, net, comm, balance:parseFloat(balance.toFixed(2)), isW, isD, isTrade };
    });
  }, [events, startingBalance]);

  // Weekly data — threshold ONLY moves on isProfitWithdrawal withdrawals
  const weeklyData = useMemo(() => {
    if (!rows.length) return [];
    const byWeek = {};
    rows.forEach(r => {
      const d=r.t.entryDate||r.t.exitDate||''; const key=weekStart(d);
      if (!byWeek[key]) byWeek[key]={rows:[],tradePnl:0,deposits:0,withdrawals:0,profitWithdrawals:0,endBalance:null,startBalance:null};
      byWeek[key].rows.push(r);
      if (r.isTrade)  byWeek[key].tradePnl+=r.net;
      if (r.isD)      byWeek[key].deposits+=r.net;
      if (r.isW)      byWeek[key].withdrawals+=Math.abs(r.net);
      if (r.isW && r.t.isProfitWithdrawal) byWeek[key].profitWithdrawals+=Math.abs(r.net);
      byWeek[key].endBalance=r.balance;
    });
    const weeks=Object.keys(byWeek).sort();
    weeks.forEach((wk,i)=>{ byWeek[wk].startBalance=i===0?startingBalance:byWeek[weeks[i-1]].endBalance; byWeek[wk].tradePnl=parseFloat(byWeek[wk].tradePnl.toFixed(2)); });
    let threshold=startingBalance;
    return weeks.map(wk=>{
      const w=byWeek[wk];
      const closingBal=w.endBalance;
      const aboveThresh=parseFloat((closingBal-threshold).toFixed(2));
      const splitDue=aboveThresh>0;
      const withdrawAmt=splitDue?parseFloat((aboveThresh*(splitRatio/100)).toFixed(2)):0;
      const keepAmt=splitDue?parseFloat((aboveThresh-withdrawAmt).toFixed(2)):0;
      const newThreshold=splitDue?parseFloat((threshold+keepAmt).toFixed(2)):threshold;
      const result={weekKey:wk,label:fmtWeek(wk),tradePnl:w.tradePnl,deposits:w.deposits,withdrawals:w.withdrawals,profitWithdrawals:w.profitWithdrawals,startBal:w.startBalance,endBal:closingBal,threshold,aboveThresh,splitDue,withdrawAmt,keepAmt,newThreshold,tradeCount:w.rows.filter(r=>r.isTrade).length};
      if (splitDue) threshold=newThreshold;
      return result;
    });
  }, [rows, startingBalance, splitRatio]);

  const chartData = useMemo(() => {
    if (!rows.length) return [];
    const byDay={};
    rows.forEach(r=>{ const d=r.t.entryDate||r.t.exitDate||''; byDay[d]=r.balance; });
    const threshByWeek={};
    weeklyData.forEach(w=>{ threshByWeek[w.weekKey]=w.threshold; });
    const weeks=Object.keys(threshByWeek).sort();
    return Object.entries(byDay).sort(([a],[b])=>a.localeCompare(b)).map(([date,balance])=>{
      const wk=weekStart(date); const idx=weeks.findIndex(w=>w>wk);
      const tw=idx>0?weeks[idx-1]:weeks[0];
      return {date:date.slice(5),balance,threshold:threshByWeek[tw]||startingBalance};
    });
  }, [rows, weeklyData, startingBalance]);

  const currentBalance   = rows.length?rows[rows.length-1].balance:startingBalance;
  const totalProfitTaken = rows.filter(r=>r.isW&&r.t.isProfitWithdrawal).reduce((s,r)=>s+Math.abs(r.net),0);
  const totalCapitalOut  = rows.filter(r=>r.isW&&!r.t.isProfitWithdrawal).reduce((s,r)=>s+Math.abs(r.net),0);
  const totalDeposits    = rows.filter(r=>r.isD).reduce((s,r)=>s+r.net,0);
  const totalTradePnl    = rows.filter(r=>r.isTrade).reduce((s,r)=>s+r.net,0);
  const currentThreshold = weeklyData.length?weeklyData[weeklyData.length-1].newThreshold:startingBalance;
  const withdrawalRows   = rows.filter(r=>r.isW);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Account Balance</div>
          <div className="page-sub">Running balance, profit split rule, and transaction history</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <label style={{fontSize:12,color:'var(--text-secondary)',fontWeight:600}}>From:</label>
          <input type="date" className="form-control" style={{width:155,padding:'6px 10px',fontSize:12}} value={fromDate} onChange={e=>setFromDate(e.target.value)}/>
          {fromDate&&<button className="btn btn-ghost btn-sm" onClick={()=>setFromDate('')}>✕</button>}
        </div>
      </div>

      <div className="page-body">

        {/* Summary cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12,marginBottom:20}}>
          {[
            {label:'STARTING BALANCE',  val:fmtA(startingBalance),     color:'var(--text-primary)'},
            {label:'TOTAL DEPOSITS',    val:'+'+fmtA(totalDeposits),    color:'#4ade80'},
            {label:'PROFIT TAKEN OUT',  val:'-'+fmtA(totalProfitTaken), color:'#f59e0b'},
            {label:'CAPITAL WITHDRAWN', val:'-'+fmtA(totalCapitalOut),  color:'#94a3b8'},
            {label:'TRADE P&L (NET)',   val:fmtS(totalTradePnl),        color:clr(totalTradePnl)},
            {label:'CURRENT BALANCE',   val:fmtA(currentBalance),       color:clr(currentBalance-startingBalance), big:true},
          ].map(s=>(
            <div key={s.label} style={{background:'var(--bg-card)',border:`1px solid ${s.big?'rgba(59,130,246,.3)':'var(--border)'}`,borderRadius:10,padding:'14px 16px'}}>
              <div style={{fontSize:9,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.8px',marginBottom:7}}>{s.label}</div>
              <div style={{fontSize:s.big?20:17,fontWeight:900,color:s.color,letterSpacing:'-0.5px'}}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* Profit Split Rule */}
        <div className="card" style={{marginBottom:20}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:14}}>
            <div>
              <div className="card-title" style={{margin:0}}>⚡ Profit Split Rule</div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4,maxWidth:550,lineHeight:1.6}}>
                Each week your balance exceeds the threshold → withdraw <strong style={{color:'#f59e0b'}}>{splitRatio}%</strong>, reinvest <strong style={{color:'#4ade80'}}>{100-splitRatio}%</strong>. Only <strong style={{color:'#f59e0b'}}>Profit Withdrawals</strong> count toward the threshold — Capital Withdrawals (old/non-split withdrawals) do not.
              </div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontSize:12,color:'var(--text-secondary)',fontWeight:600}}>Split:</span>
                {[25,33,50,60,75].map(r=>(
                  <button key={r} onClick={()=>setSplitRatio(r)} style={{
                    padding:'5px 12px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer',border:'1px solid',
                    background:splitRatio===r?'rgba(59,130,246,.25)':'var(--bg-hover)',
                    color:splitRatio===r?'var(--blue-bright)':'var(--text-secondary)',
                    borderColor:splitRatio===r?'rgba(59,130,246,.4)':'var(--border)',
                  }}>{r}%</button>
                ))}
              </div>
              <div style={{padding:'10px 16px',background:'rgba(245,158,11,.08)',borderRadius:8,border:'1px solid rgba(245,158,11,.25)'}}>
                <div style={{fontSize:9,color:'#f59e0b',fontWeight:700,marginBottom:2}}>CURRENT THRESHOLD</div>
                <div style={{fontSize:18,fontWeight:900,color:'#f59e0b'}}>{fmtA(currentThreshold)}</div>
                <div style={{fontSize:9,color:'var(--text-muted)'}}>balance must exceed this</div>
              </div>
            </div>
          </div>
        </div>

        {/* Tag withdrawals */}
        {withdrawalRows.length > 0 && (
          <div className="card" style={{marginBottom:20}}>
            <div style={{marginBottom:14}}>
              <div className="card-title" style={{margin:0}}>🏷 Tag Your Withdrawals</div>
              <div style={{fontSize:12,color:'var(--text-muted)',marginTop:4,lineHeight:1.6}}>
                Mark each withdrawal as <strong style={{color:'#f59e0b'}}>Profit</strong> (part of the split rule — affects threshold) or <strong style={{color:'#94a3b8'}}>Capital</strong> (old withdrawal / not part of the split rule — threshold stays put). Click to toggle any time.
              </div>
            </div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'1px solid var(--border)'}}>
                    {['Date','Amount','Notes','Type — click to toggle'].map(h=>(
                      <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.5px'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {withdrawalRows.map(r=>{
                    const isProfit=!!r.t.isProfitWithdrawal;
                    return (
                      <tr key={r.t.id} style={{borderBottom:'1px solid var(--border)'}}>
                        <td style={{padding:'9px 10px',color:'var(--text-secondary)',whiteSpace:'nowrap',fontSize:12}}>{fmtDate(r.t.entryDate)}</td>
                        <td style={{padding:'9px 10px',fontWeight:700,color:'#f87171',whiteSpace:'nowrap'}}>-{fmtA(Math.abs(r.net))}</td>
                        <td style={{padding:'9px 10px',color:'var(--text-muted)',fontSize:12,maxWidth:200}}>{r.t.notes||'—'}</td>
                        <td style={{padding:'9px 10px'}}>
                          <div style={{display:'flex',gap:6}}>
                            <button onClick={()=>updateTrade(r.t.id,{isProfitWithdrawal:true})} style={{
                              padding:'5px 14px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',border:'1px solid',
                              background:isProfit?'rgba(245,158,11,.2)':'var(--bg-hover)',
                              color:isProfit?'#f59e0b':'var(--text-muted)',
                              borderColor:isProfit?'rgba(245,158,11,.4)':'var(--border)',
                            }}>📈 Profit</button>
                            <button onClick={()=>updateTrade(r.t.id,{isProfitWithdrawal:false})} style={{
                              padding:'5px 14px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',border:'1px solid',
                              background:!isProfit?'rgba(148,163,184,.15)':'var(--bg-hover)',
                              color:!isProfit?'#94a3b8':'var(--text-muted)',
                              borderColor:!isProfit?'rgba(148,163,184,.35)':'var(--border)',
                            }}>💼 Capital</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Chart */}
        {chartData.length > 1 && (
          <div className="card" style={{marginBottom:20}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div className="card-title" style={{margin:0}}>Balance vs Threshold</div>
              <div style={{display:'flex',gap:16,fontSize:11}}>
                <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:12,height:3,background:'#3b82f6',display:'inline-block',borderRadius:2}}/>Balance</span>
                <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:12,height:3,background:'#f59e0b',display:'inline-block',borderRadius:2}}/>Threshold</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData} margin={{top:5,right:10,left:10,bottom:0}}>
                <defs>
                  <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="thGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40}/>
                <YAxis tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=>'$'+(v/1000).toFixed(1)+'k'} width={52}/>
                <Tooltip content={<ChartTip/>}/>
                <Area type="stepAfter" dataKey="threshold" name="threshold" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="5 3" fill="url(#thGrad)" dot={false} activeDot={false}/>
                <Area type="monotone"  dataKey="balance"   name="balance"   stroke="#3b82f6" strokeWidth={2.5} fill="url(#balGrad)" dot={false} activeDot={{r:4,strokeWidth:0}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Weekly breakdown */}
        <div className="card" style={{marginBottom:20}}>
          <div style={{marginBottom:14}}>
            <div className="card-title" style={{margin:0}}>📅 Weekly Breakdown</div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginTop:3}}>Threshold only moves when profit withdrawals are logged · {splitRatio}% split rule</div>
          </div>
          {weeklyData.length===0 ? (
            <div style={{textAlign:'center',padding:'30px',color:'var(--text-muted)',fontSize:13}}>No weekly data yet</div>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'2px solid var(--border)'}}>
                    {['Week','Trades','P&L','Closing Bal','Threshold','Above?','Take Out','Keep','New Threshold'].map(h=>(
                      <th key={h} style={{padding:'8px 10px',textAlign:h==='Week'||h==='Trades'?'left':'right',fontSize:10,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.4px',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...weeklyData].reverse().map(w=>(
                    <tr key={w.weekKey} style={{borderBottom:'1px solid var(--border)',background:w.splitDue?'rgba(245,158,11,.04)':''}}
                      onMouseEnter={e=>e.currentTarget.style.background=w.splitDue?'rgba(245,158,11,.08)':'var(--bg-hover)'}
                      onMouseLeave={e=>e.currentTarget.style.background=w.splitDue?'rgba(245,158,11,.04)':''}>
                      <td style={{padding:'10px 10px',whiteSpace:'nowrap',fontSize:12,fontWeight:600}}>{w.label}</td>
                      <td style={{padding:'10px 10px',color:'var(--text-muted)',fontSize:12}}>{w.tradeCount}</td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:700,color:clr(w.tradePnl),whiteSpace:'nowrap'}}>{w.tradePnl>=0?'+':''}{fmtA(w.tradePnl)}</td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:800,color:w.endBal>=w.threshold?'#4ade80':'var(--text-primary)',whiteSpace:'nowrap'}}>{fmtA(w.endBal)}</td>
                      <td style={{padding:'10px 10px',textAlign:'right',color:'#f59e0b',fontWeight:700,whiteSpace:'nowrap'}}>{fmtA(w.threshold)}</td>
                      <td style={{padding:'10px 10px',textAlign:'right'}}>
                        {w.splitDue
                          ? <span style={{background:'rgba(245,158,11,.15)',color:'#f59e0b',borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>+{fmtA(w.aboveThresh)} ⚡</span>
                          : <span style={{color:'var(--text-muted)',fontSize:11}}>Below</span>}
                      </td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:700,color:w.splitDue?'#f87171':'var(--text-muted)',whiteSpace:'nowrap'}}>{w.splitDue?'-'+fmtA(w.withdrawAmt):'—'}</td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:700,color:w.splitDue?'#4ade80':'var(--text-muted)',whiteSpace:'nowrap'}}>{w.splitDue?'+'+fmtA(w.keepAmt):'—'}</td>
                      <td style={{padding:'10px 10px',textAlign:'right',fontWeight:800,color:'#f59e0b',whiteSpace:'nowrap'}}>{fmtA(w.newThreshold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Transaction history */}
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div className="card-title" style={{margin:0}}>Transaction History</div>
            <div style={{fontSize:12,color:'var(--text-muted)'}}>{rows.length} entries{fromDate?' from '+fmtDate(fromDate):''}</div>
          </div>
          {rows.length===0 ? (
            <div style={{textAlign:'center',padding:'40px',color:'var(--text-muted)'}}><div style={{fontSize:32,marginBottom:10}}>📊</div><div>No transactions found</div></div>
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
                    <td colSpan={2} style={{padding:'10px 12px',textAlign:'right',color:'var(--text-muted)'}}>—</td>
                    <td style={{padding:'10px 12px',textAlign:'right',fontWeight:800,color:'var(--blue-bright)'}}>{fmtA(startingBalance)}</td>
                  </tr>
                  {[...rows].reverse().map((r,i)=>{
                    const {t,net,comm,balance,isW,isD,isTrade}=r;
                    const isProfit=isW&&t.isProfitWithdrawal;
                    const isCapital=isW&&!t.isProfitWithdrawal;
                    const typeLabel=isProfit?'Profit Taken':isCapital?'Capital Out':isD?'Deposit':t.status;
                    const typeBg=isProfit?'rgba(245,158,11,.12)':isCapital?'rgba(148,163,184,.1)':isD?'rgba(74,222,128,.12)':t.status==='Win'?'rgba(59,130,246,.12)':t.status==='Loss'?'rgba(239,68,68,.12)':'var(--bg-hover)';
                    const typeClr=isProfit?'#f59e0b':isCapital?'#94a3b8':isD?'#4ade80':t.status==='Win'?'var(--blue-bright)':t.status==='Loss'?'var(--red)':'var(--text-muted)';
                    const desc=isW?(t.notes||'Withdrawal'):isD?(t.notes||'Deposit'):`${t.symbol} ${t.side}`;
                    return (
                      <tr key={t.id||i} style={{borderBottom:'1px solid var(--border)',transition:'background .1s'}}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                        onMouseLeave={e=>e.currentTarget.style.background=''}>
                        <td style={{padding:'10px 12px',color:'var(--text-secondary)',fontSize:12,whiteSpace:'nowrap'}}>{fmtDate(t.entryDate)}</td>
                        <td style={{padding:'10px 12px',whiteSpace:'nowrap'}}><span style={{background:typeBg,color:typeClr,borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700}}>{typeLabel}</span></td>
                        <td style={{padding:'10px 12px',color:'var(--text-primary)',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{desc}</td>
                        <td style={{padding:'10px 12px',textAlign:'right',fontWeight:700,color:net>=0?'#4ade80':'#f87171',whiteSpace:'nowrap'}}>{net>=0?'+':''}{net<0?'-'+fmtA(Math.abs(net)):fmtA(net)}</td>
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
