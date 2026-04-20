import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useTrades } from '../context/TradesContext';
import TradeModal from '../components/TradeModal';

const FILTERS = ['1D','1W','1M','3M','ALL'];
const MONTHS  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS    = ['M','T','W','T','F','S','S'];

const fmtPnl = n => `${n>=0?'+':'-'}$${Math.abs(n).toFixed(2)}`;
const fmtShort = n => {
  const a = Math.abs(n), s = n>=0?'+':'-';
  if (a>=1000) return `${s}$${(a/1000).toFixed(1)}k`;
  return `${s}$${a.toFixed(2)}`;
};

function ChartTooltip({ active, payload, label }) {
  if (!active||!payload?.length) return null;
  const v = payload[0].value;
  return (
    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,padding:'10px 14px',boxShadow:'0 4px 20px rgba(0,0,0,.4)'}}>
      <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:4}}>{label}</div>
      <div style={{fontSize:16,fontWeight:800,color:v>=0?'#3b82f6':'#ef4444'}}>{fmtPnl(v)}</div>
      <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2,textTransform:'uppercase',letterSpacing:'.5px'}}>Cumulative P&L</div>
    </div>
  );
}

export default function Dashboard() {
  const { trades, stats } = useTrades();
  const brokeragePerLot = stats.brokeragePerLot || 0;
  const accountSize     = stats.accountSize || 10000;
  // Same commission logic as calcStats: rate × lots if set, else t.fees
  const tradeComm = t => brokeragePerLot > 0
    ? brokeragePerLot * (t.size || 0)
    : (t.fees || 0);
  const netPnl = t => (t.pnl||0) - tradeComm(t);

  const [filter,    setFilter]    = useState('ALL');
  const [showModal, setShowModal] = useState(false);

  const latestTradeDate = useMemo(() => {
    const withDates = trades.filter(t=>t.exitDate||t.entryDate);
    if (!withDates.length) return new Date();
    const sorted = [...withDates].sort((a,b)=>(b.exitDate||b.entryDate).localeCompare(a.exitDate||a.entryDate));
    const d = sorted[0].exitDate||sorted[0].entryDate;
    const [y,m] = d.split('-').map(Number);
    return new Date(y,m-1,1);
  }, [trades]);

  const [calMonth, setCalMonth] = useState(latestTradeDate);
  const year  = calMonth.getFullYear();
  const month = calMonth.getMonth();

  const filteredTrades = useMemo(() => {
    const base = trades.filter(t => !t.isWithdrawal && !t.isOpen && t.status !== 'Open' && (t.exitDate||t.entryDate));
    const sd = stats.statsStartDate || '';
    const ed = stats.statsEndDate   || '';
    const dateFiltered = base.filter(t => {
      const d = t.exitDate||t.entryDate||'';
      if (sd && d < sd) return false;
      if (ed && d > ed) return false;
      return true;
    });
    const cutoff = new Date();
    if      (filter==='1D') cutoff.setDate(cutoff.getDate()-1);
    else if (filter==='1W') cutoff.setDate(cutoff.getDate()-7);
    else if (filter==='1M') cutoff.setMonth(cutoff.getMonth()-1);
    else if (filter==='3M') cutoff.setMonth(cutoff.getMonth()-3);
    else return dateFiltered;
    return dateFiltered.filter(t=>new Date(t.exitDate||t.entryDate)>=cutoff);
  }, [trades, filter, stats.statsStartDate, stats.statsEndDate]);

  const chartData = useMemo(() => {
    const sorted = [...filteredTrades].sort((a,b)=>((a.exitDate||a.entryDate)||'').localeCompare((b.exitDate||b.entryDate)||''));
    let cum=0;
    return sorted.map(t=>{ cum+=netPnl(t); return {date:(t.exitDate||t.entryDate||'').slice(5),pnl:parseFloat(cum.toFixed(2))}; });
  }, [filteredTrades, brokeragePerLot]);

  const chartPnl = filteredTrades.reduce((s,t)=>s+netPnl(t),0);
  const chartPct = accountSize>0?(chartPnl/accountSize)*100:0;
  const isPos    = chartPnl>=0;

  const daysInMonth  = new Date(year,month+1,0).getDate();
  const firstDOW     = new Date(year,month,1).getDay();      // 0=Sun
  const startOffset  = firstDOW===0?6:firstDOW-1;           // Mon-first offset
  const totalWeeks   = Math.ceil((startOffset+daysInMonth)/7);

  // Build dayMap — exclude withdrawals, respect settings date range
  const dayMap = useMemo(() => {
    const sd = stats.statsStartDate || '';
    const ed = stats.statsEndDate   || '';
    const map={};
    trades.forEach(t=>{
      if (t.isWithdrawal) return;
      if (t.isOpen || t.status === 'Open') return;  // exclude floating unrealized P&L
      const d=t.exitDate||t.entryDate;
      if(!d) return;
      if(sd && d < sd) return;
      if(ed && d > ed) return;
      map[d]=parseFloat(((map[d]||0)+parseFloat(t.pnl||0)).toFixed(2));
    });
    return map;
  }, [trades, stats.statsStartDate, stats.statsEndDate]);

  const ds = d=>`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dayNum = (wi,di) => wi*7 + di - startOffset + 1;   // shared formula

  const monthPnl = useMemo(()=>{
    let t=0; for(let d=1;d<=daysInMonth;d++) t+=dayMap[ds(d)]||0; return parseFloat(t.toFixed(2));
  }, [dayMap,daysInMonth,year,month]);

  const weekPnl = wi=>{
    let total=0,days=0;
    for(let di=0;di<7;di++){
      const dn=dayNum(wi,di);
      if(dn<1||dn>daysInMonth) continue;
      const v=dayMap[ds(dn)];
      if(v!==undefined){total+=v;days++;}
    }
    return {total:parseFloat(total.toFixed(2)),days};
  };

  const today  = new Date().toISOString().slice(0,10);
  

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Dashboard</div><div className="page-sub">Welcome back, Trader</div></div>
        <button className="btn btn-primary" onClick={()=>setShowModal(true)}>+ Add Trade</button>
      </div>

      <div className="page-body">
        {/* Stat cards */}
        <div className="stat-grid">
          <div className="stat-card blue">
            <div className="stat-icon blue">💵</div>
            <div className="stat-label">Gross P&L</div>
            <div className={`stat-val ${(stats.totalGrossPnl||0)>=0?'pos':'neg'}`}>{fmtPnl(stats.totalGrossPnl||0)}</div>
            <div className="stat-sub">→ {stats.totalWins}W · {stats.totalLosses}L{stats.totalBreakeven>0?` · ${stats.totalBreakeven}BE`:''}</div>
          </div>
          <div className="stat-card red">
            <div className="stat-icon red">💸</div>
            <div className="stat-label">Commission</div>
            <div className="stat-val neg">-${(stats.totalCommissions||0).toFixed(2)}</div>
            <div className="stat-sub">Total fees paid</div>
          </div>
          <div className="stat-card yellow">
            <div className="stat-icon yellow">✅</div>
            <div className="stat-label">Net P&L</div>
            <div className={`stat-val ${((stats.totalGrossPnl||0)-(stats.totalCommissions||0))>=0?'pos':'neg'}`}>
              {fmtPnl((stats.totalGrossPnl||0)-(stats.totalCommissions||0))}
            </div>
            <div className="stat-sub">After commission</div>
          </div>
          <div className="stat-card blue">
            <div className="stat-icon blue">🎯</div>
            <div className="stat-label">Win Rate</div>
            <div className="stat-val neu">{stats.winRate.toFixed(1)}%</div>
            <div className="stat-bar"><div className="stat-bar-fill" style={{width:`${stats.winRate}%`,background:stats.winRate>=50?'var(--blue)':'var(--red)'}}/></div>
          </div>
        </div>

        {/* Chart + Calendar */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:18}}>

          {/* Performance chart */}
          <div className="card" style={{padding:'20px 20px 14px'}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:12}}>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:'var(--text-muted)',letterSpacing:'1px',textTransform:'uppercase',marginBottom:6,display:'flex',alignItems:'center',gap:5}}>
                  <span>↗</span> PERFORMANCE
                  {(stats.statsStartDate||stats.statsEndDate) && (
                    <span style={{background:'rgba(59,130,246,.15)',color:'var(--blue-bright)',borderRadius:4,padding:'1px 6px',fontSize:9,fontWeight:700,textTransform:'none',letterSpacing:0}}>
                      📅 {stats.statsStartDate||'all'} → {stats.statsEndDate||'today'}
                    </span>
                  )}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:32,fontWeight:900,color:isPos?'#3b82f6':'#ef4444',letterSpacing:'-1px',fontFamily:'var(--font-mono)'}}>
                    {fmtPnl(chartPnl)}
                  </span>
                  <span style={{background:isPos?'rgba(59,130,246,.15)':'rgba(239,68,68,.15)',color:isPos?'#3b82f6':'#ef4444',borderRadius:6,padding:'3px 10px',fontSize:12,fontWeight:700}}>
                    {isPos?'▲':'▼'} {Math.abs(chartPct).toFixed(1)}%
                  </span>
                </div>
              </div>
              <div className="time-filters" style={{marginTop:4}}>
                {FILTERS.map(f=><button key={f} className={`tf-btn${filter===f?' active':''}`} onClick={()=>setFilter(f)}>{f}</button>)}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={chartData} margin={{top:5,right:5,left:0,bottom:0}}>
                <defs>
                  <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={isPos?'#3b82f6':'#ef4444'} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={isPos?'#3b82f6':'#ef4444'} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40}/>
                <YAxis tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`} width={55}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Area type="monotone" dataKey="pnl" stroke={isPos?'#3b82f6':'#ef4444'} strokeWidth={2} fill="url(#cg)" dot={false} activeDot={{r:4,strokeWidth:0}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly P&L Calendar */}
          <div className="card" style={{padding:'16px 16px 12px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontSize:15,fontWeight:700}}>Monthly P&L</div>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontSize:11,color:'var(--text-muted)'}}>
                  Monthly: <strong style={{color:monthPnl>=0?'#3b82f6':'#ef4444'}}>{fmtPnl(monthPnl)}</strong>
                </span>
                <div style={{display:'flex',alignItems:'center',gap:2}}>
                  <button className="btn-icon" style={{padding:'2px 8px',fontSize:14}} onClick={()=>setCalMonth(new Date(year,month-1,1))}>‹</button>
                  <span style={{fontSize:11,fontWeight:600,minWidth:72,textAlign:'center'}}>{MONTHS[month].slice(0,3)} {year}</span>
                  <button className="btn-icon" style={{padding:'2px 8px',fontSize:14}} onClick={()=>setCalMonth(new Date(year,month+1,1))}>›</button>
                </div>
              </div>
            </div>

            {/* Column headers */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr) 72px',gap:3,marginBottom:3}}>
              {DAYS.map((d,i)=><div key={i} style={{textAlign:'center',fontSize:11,fontWeight:700,color:'var(--text-muted)',padding:'3px 0'}}>{d}</div>)}
              <div style={{textAlign:'center',fontSize:9,fontWeight:700,color:'var(--text-muted)',padding:'3px 0',letterSpacing:'.3px'}}>WEEKLY</div>
            </div>

            {/* Rows */}
            {Array.from({length:totalWeeks},(_,wi)=>{
              const wp = weekPnl(wi);
              return (
                <div key={wi} style={{display:'grid',gridTemplateColumns:'repeat(7,1fr) 72px',gap:3,marginBottom:3}}>
                  {Array.from({length:7},(_,di)=>{
                    const dn=dayNum(wi,di);
                    if(dn<1||dn>daysInMonth) return <div key={di} style={{height:56}}/>;
                    const dateStr=ds(dn);
                    const pnl=dayMap[dateStr];
                    const has=pnl!==undefined;
                    const pos=has&&pnl>=0;
                    const isToday=dateStr===today;
                    return (
                      <div key={di} style={{
                        height:56,borderRadius:7,
                        display:'flex',flexDirection:'column',
                        alignItems:'flex-start',justifyContent:'space-between',
                        padding:'5px 6px',boxSizing:'border-box',
                        background:has?(pos?'rgba(59,130,246,.2)':'rgba(239,68,68,.2)'):'rgba(255,255,255,.03)',
                        border:`1px solid ${isToday?'#3b82f6':has?(pos?'rgba(59,130,246,.3)':'rgba(239,68,68,.3)'):'rgba(255,255,255,.06)'}`,
                      }}>
                        <div style={{fontSize:10,fontWeight:700,color:isToday?'#3b82f6':has?'rgba(255,255,255,.7)':'rgba(255,255,255,.3)'}}>{dn}</div>
                        {has&&<div style={{fontSize:10,fontWeight:900,color:pos?'#60a5fa':'#f87171',letterSpacing:'-0.3px',lineHeight:1}}>{fmtShort(pnl)}</div>}
                      </div>
                    );
                  })}
                  <div style={{
                    height:56,borderRadius:7,
                    display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:1,
                    background:wp.days>0?(wp.total>=0?'rgba(59,130,246,.12)':'rgba(239,68,68,.12)'):'rgba(255,255,255,.02)',
                    border:`1px solid ${wp.days>0?(wp.total>=0?'rgba(59,130,246,.25)':'rgba(239,68,68,.25)'):'rgba(255,255,255,.05)'}`,
                    boxSizing:'border-box',
                  }}>
                    {wp.days>0?(
                      <>
                        <div style={{fontSize:8,fontWeight:700,color:'rgba(255,255,255,.4)',letterSpacing:'.5px'}}>WK</div>
                        <div style={{fontSize:10,fontWeight:900,color:wp.total>=0?'#60a5fa':'#f87171',letterSpacing:'-0.3px'}}>{fmtShort(wp.total)}</div>
                        <div style={{fontSize:8,color:'rgba(255,255,255,.3)'}}>{wp.days}d</div>
                      </>
                    ):<div style={{fontSize:9,color:'rgba(255,255,255,.2)'}}>—</div>}
                  </div>
                </div>
              );
            })}

            <div style={{display:'flex',gap:14,marginTop:6,fontSize:10,color:'var(--text-secondary)'}}>
              <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:7,height:7,borderRadius:'50%',background:'#3b82f6',display:'inline-block'}}/>Profit</span>
              <span style={{display:'flex',alignItems:'center',gap:4}}><span style={{width:7,height:7,borderRadius:'50%',background:'#ef4444',display:'inline-block'}}/>Loss</span>
            </div>
          </div>
        </div>

        {/* Recent Trades — full width */}
        <div className="card">
          <div className="card-title">Recent Trades</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:0}}>
            {trades.filter(t=>!t.isWithdrawal&&(t.exitDate||t.entryDate)).length===0
              ?<div style={{fontSize:13,color:'var(--text-muted)',textAlign:'center',padding:'20px 0'}}>No trades yet</div>
              :trades.filter(t=>!t.isWithdrawal&&(t.exitDate||t.entryDate))
                .sort((a,b)=>(b.exitDate||b.entryDate).localeCompare(a.exitDate||a.entryDate))
                .slice(0,8)
                .map(t=>{const pnl=netPnl(t);const d=t.exitDate||t.entryDate||'';const dateStr=d?new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—';return(
                  <div key={t.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 16px',borderBottom:'1px solid var(--border)'}}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:32,height:32,background:'var(--bg-hover)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12}}>{t.side==='Long'?'📈':'📉'}</div>
                      <div><div style={{fontWeight:600,fontSize:13}}>{t.symbol||'—'}</div><div style={{fontSize:11,color:'var(--text-muted)'}}>{dateStr}</div></div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div className={pnl>=0?'pos':'neg'} style={{fontWeight:700,fontSize:13}}>{fmtPnl(pnl)}</div>
                      <span className={`badge badge-${(t.side||'Long').toLowerCase()}`} style={{fontSize:10}}>{t.side||'Long'}</span>
                    </div>
                  </div>
                );})
            }
          </div>
        </div>
      </div>

      {showModal&&<TradeModal onClose={()=>setShowModal(false)}/>}
    </div>
  );
}
