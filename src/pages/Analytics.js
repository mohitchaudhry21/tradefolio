import React, { useMemo, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';
import { useTrades } from '../context/TradesContext';

const fmt  = n => `${n>=0?'+':'-'}$${Math.abs(n).toFixed(2)}`;
const fmtK = n => Math.abs(n)>=1000 ? `${n<0?'-':''}$${(Math.abs(n)/1000).toFixed(1)}k` : fmt(n);

const PERIODS = ['Today','7 Days','30 Days','3 Months','1 Year','All Time'];
const FTYPES  = ['All Trades','Winners','Losers'];

const TIP = ({ active, payload, label }) => {
  if (!active||!payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-label">{label}</div>
      <div className={`chart-tip-val ${payload[0].value>=0?'pos':'neg'}`}>{fmt(payload[0].value)}</div>
    </div>
  );
};

function getSession(time) {
  if (!time) return 'unknown';
  const [h] = time.split(':').map(Number);
  const utc = h;
  if (utc>=22||utc<8)  return 'asian';
  if (utc>=8&&utc<13)  return 'london';
  if (utc>=13&&utc<22) return 'newyork';
  return 'other';
}

export default function Analytics() {
  const { trades, stats } = useTrades();
  const [period,  setPeriod]  = useState('30 Days');
  const [ftype,   setFtype]   = useState('All Trades');

  // Base: exclude withdrawals always, respect settings date range
  const baseTrades = useMemo(() => trades.filter(t => {
    if (t.isWithdrawal) return false;
    const d = t.exitDate || t.entryDate || '';
    if (stats.statsStartDate && d < stats.statsStartDate) return false;
    if (stats.statsEndDate   && d > stats.statsEndDate)   return false;
    return true;
  }), [trades, stats.statsStartDate, stats.statsEndDate]);

  const filteredTrades = useMemo(() => {
    const cutoff = new Date();
    if (period==='Today')     cutoff.setDate(cutoff.getDate()-1);
    else if (period==='7 Days')    cutoff.setDate(cutoff.getDate()-7);
    else if (period==='30 Days')   cutoff.setMonth(cutoff.getMonth()-1);
    else if (period==='3 Months')  cutoff.setMonth(cutoff.getMonth()-3);
    else if (period==='1 Year')    cutoff.setFullYear(cutoff.getFullYear()-1);
    else return [...baseTrades];
    let arr = baseTrades.filter(t=>new Date(t.entryDate)>=cutoff);
    if (ftype==='Winners') arr=arr.filter(t=>t.status==='Win');
    if (ftype==='Losers')  arr=arr.filter(t=>t.status==='Loss');
    return arr;
  }, [baseTrades, period, ftype]);

  const fs = useMemo(() => {
    const wins     = filteredTrades.filter(t=>t.status==='Win');
    const losses   = filteredTrades.filter(t=>t.status==='Loss');
    const wlOnly   = filteredTrades.filter(t=>t.status==='Win'||t.status==='Loss'); // breakeven excluded from win rate
    const gp=wins.reduce((s,t)=>s+(t.pnl||0),0);
    const gl=Math.abs(losses.reduce((s,t)=>s+(t.pnl||0),0));
    const totalPnl=filteredTrades.reduce((s,t)=>s+(t.pnl||0),0);
    const totalComm=filteredTrades.reduce((s,t)=>s+(t.fees||0),0);
    const wr=wlOnly.length?(wins.length/wlOnly.length)*100:0;  // breakeven excluded
    const pf=gl>0?gp/gl:gp>0?Infinity:0;
    const exp=filteredTrades.length?totalPnl/filteredTrades.length:0;
    const avgW=wins.length?gp/wins.length:0;
    const avgL=losses.length?gl/losses.length:0;
    const best=filteredTrades.length?Math.max(...filteredTrades.map(t=>t.pnl||0)):0;
    const worst=filteredTrades.length?Math.min(...filteredTrades.map(t=>t.pnl||0)):0;

    // Streaks — breakeven skips, doesn't reset
    const sorted=[...filteredTrades].sort((a,b)=>a.entryDate.localeCompare(b.entryDate));
    let maxWs=0,maxLs=0,cw=0,cl=0;
    sorted.forEach(t=>{
      if(t.status==='Win'){cw++;cl=0;maxWs=Math.max(maxWs,cw);}
      else if(t.status==='Loss'){cl++;cw=0;maxLs=Math.max(maxLs,cl);}
    });

    // Max DD
    let peak=0,cum2=0,maxDD=0;
    sorted.forEach(t=>{cum2+=(t.pnl||0);peak=Math.max(peak,cum2);maxDD=Math.max(maxDD,peak-cum2);});

    // RR avg
    const avgRR = filteredTrades.length ? filteredTrades.reduce((s,t)=>s+(t.rMultiple||0),0)/filteredTrades.length : 0;

    return {totalPnl,totalComm,wins:wins.length,losses:losses.length,breakeven:filteredTrades.length-wlOnly.length,total:wlOnly.length,totalAll:filteredTrades.length,wr,pf,exp,avgW,avgL,best,worst,maxWs,maxLs,maxDD,avgRR,gp,gl};
  }, [filteredTrades]);

  // Equity curve
  const equityCurve = useMemo(()=>{
    const sorted=[...filteredTrades].filter(t=>t.entryDate).sort((a,b)=>(a.entryDate||'').localeCompare(b.entryDate||''));
    let cum=0;
    return sorted.map(t=>{cum+=(t.pnl||0);return{date:(t.entryDate||'').slice(5),pnl:parseFloat(cum.toFixed(2))};});
  },[filteredTrades]);

  // Day performance
  const dayPerf = useMemo(()=>{
    const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const map={};
    filteredTrades.forEach(t=>{
      const d=new Date(t.entryDate).getDay();
      const dk=days[(d+6)%7];
      if(!map[dk]) map[dk]={pnl:0,total:0};
      map[dk].pnl+=t.pnl||0; map[dk].total++;
    });
    return days.map(d=>({day:d,pnl:parseFloat((map[d]?.pnl||0).toFixed(2)),total:map[d]?.total||0}));
  },[filteredTrades]);

  // Long vs Short
  const lsData = useMemo(()=>{
    const longs=filteredTrades.filter(t=>t.side==='Long');
    const shorts=filteredTrades.filter(t=>t.side==='Short');
    const lwins=longs.filter(t=>t.status==='Win').length;
    const swins=shorts.filter(t=>t.status==='Win').length;
    return {
      long:{total:longs.length,pnl:longs.reduce((s,t)=>s+(t.pnl||0),0),wr:longs.length?(lwins/longs.length*100).toFixed(1):'0.0'},
      short:{total:shorts.length,pnl:shorts.reduce((s,t)=>s+(t.pnl||0),0),wr:shorts.length?(swins/shorts.length*100).toFixed(1):'0.0'},
    };
  },[filteredTrades]);

  // Top symbols
  const topSymbols = useMemo(()=>{
    const map={};
    filteredTrades.forEach(t=>{
      if(!map[t.symbol]) map[t.symbol]={pnl:0,total:0,wins:0};
      map[t.symbol].pnl+=t.pnl||0; map[t.symbol].total++;
      if(t.status==='Win') map[t.symbol].wins++;
    });
    return Object.entries(map).map(([sym,s])=>({sym,pnl:s.pnl,total:s.total,wr:s.total?(s.wins/s.total*100).toFixed(0)+'%':'0%'}))
      .sort((a,b)=>Math.abs(b.pnl)-Math.abs(a.pnl)).slice(0,5);
  },[filteredTrades]);

  // Sessions
  const sessions = useMemo(()=>{
    const map={asian:{pnl:0,total:0,wins:0},london:{pnl:0,total:0,wins:0},newyork:{pnl:0,total:0,wins:0}};
    filteredTrades.forEach(t=>{
      const s=getSession(t.entryTime);
      if(map[s]){map[s].pnl+=t.pnl||0;map[s].total++;if(t.status==='Win')map[s].wins++;}
    });
    return {
      asian:  {...map.asian,wr:map.asian.total?(map.asian.wins/map.asian.total*100).toFixed(1):'0.0',   label:'Asian',   time:'22:00 – 08:00 UTC'},
      london: {...map.london,wr:map.london.total?(map.london.wins/map.london.total*100).toFixed(1):'0.0', label:'London',  time:'08:00 – 13:00 UTC'},
      newyork:{...map.newyork,wr:map.newyork.total?(map.newyork.wins/map.newyork.total*100).toFixed(1):'0.0',label:'New York',time:'13:00 – 22:00 UTC'},
    };
  },[filteredTrades]);

  // Monthly stats
  const monthStats = useMemo(()=>{
    const map={};
    trades.forEach(t=>{
      const ym=t.entryDate.slice(0,7);
      if(!map[ym]) map[ym]=0;
      map[ym]+=t.pnl||0;
    });
    const vals=Object.values(map);
    const best=vals.length?Math.max(...vals):0;
    const worst=vals.length?Math.min(...vals):0;
    const avg=vals.length?vals.reduce((s,v)=>s+v,0)/vals.length:0;
    const bestMonth=Object.entries(map).find(([,v])=>v===best);
    const worstMonth=Object.entries(map).find(([,v])=>v===worst);
    return {best,worst,avg,bestMonth:bestMonth?.[0],worstMonth:worstMonth?.[0]};
  },[trades]);

  // Day map for trading days
  const tradingDays = useMemo(()=>{
    const days=new Set(filteredTrades.map(t=>t.entryDate));
    const dayPnl={};
    filteredTrades.forEach(t=>{if(!dayPnl[t.entryDate])dayPnl[t.entryDate]=0;dayPnl[t.entryDate]+=t.pnl||0;});
    const winDays=Object.values(dayPnl).filter(v=>v>0).length;
    const lossDays=Object.values(dayPnl).filter(v=>v<0).length;
    const bestDay=Object.values(dayPnl).length?Math.max(...Object.values(dayPnl)):0;
    const worstDay=Object.values(dayPnl).length?Math.min(...Object.values(dayPnl)):0;
    const avgDayPnl=Object.values(dayPnl).length?Object.values(dayPnl).reduce((s,v)=>s+v,0)/Object.values(dayPnl).length:0;
    const avgWinDay=Object.values(dayPnl).filter(v=>v>0);
    const avgLossDay=Object.values(dayPnl).filter(v=>v<0);
    return {total:days.size,winDays,lossDays,bestDay,worstDay,avgDayPnl,
      avgWinDay:avgWinDay.length?avgWinDay.reduce((s,v)=>s+v,0)/avgWinDay.length:0,
      avgLossDay:avgLossDay.length?avgLossDay.reduce((s,v)=>s+v,0)/avgLossDay.length:0};
  },[filteredTrades]);

  const maxDayAbs=Math.max(...dayPerf.map(d=>Math.abs(d.pnl)),1);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Performance Analytics</div>
          <div className="page-sub">Analyze your trading patterns and improve your strategy</div>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center'}}>
          <div className="time-filters">
            {PERIODS.map(p=><button key={p} className={`tf-btn${period===p?' active':''}`} onClick={()=>setPeriod(p)}>{p}</button>)}
          </div>
          <div className="time-filters">
            {FTYPES.map(f=>(
              <button key={f} className={`tf-btn${ftype===f?' active':''}`} onClick={()=>setFtype(f)}
                style={ftype===f&&f==='Winners'?{background:'var(--blue)'}:ftype===f&&f==='Losers'?{background:'var(--red)'}:{}}>
                {f==='Winners'?'✓ ':f==='Losers'?'✗ ':''}{f}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="page-body">
        {/* Top stats */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
          {[
            {label:'TOTAL P&L',val:fmtK(fs.totalPnl),sub:`${fs.total} trades · ${fs.breakeven>0?fs.breakeven+' BE · ':''}excl. commission`,sub2:'Gross P&L for the selected period',color:fs.totalPnl>=0?'pos':'neg',icon:'💵',c:'blue'},
            {label:'WIN RATE',val:`${fs.wr.toFixed(1)}%`,sub:`${fs.wins}W · ${fs.losses}L${fs.breakeven>0?` · ${fs.breakeven}BE (excl.)`:''}`,sub2:'Win/Loss trades only — breakeven excluded',color:fs.wr>=50?'pos':'neg',icon:'✅',c:'blue',bar:fs.wr},
            {label:'COMMISSION',val:`-$${(fs.totalComm||0).toFixed(2)}`,sub:'Total fees paid',sub2:'Sum of all commissions and swap for this period',color:'neg',icon:'💸',c:'red'},
            {label:'PROFIT FACTOR',val:isFinite(fs.pf)?fs.pf.toFixed(2):'∞',sub:fs.pf>=1.5?'Good':fs.pf>=1?'Break-even':'Below 1',sub2:'Gross profit ÷ Gross loss (above 1.5 is good)',color:'neu',icon:'📊',c:'purple'},
            {label:'EXPECTANCY',val:`$${fs.exp.toFixed(2)}`,sub:'Average per trade',sub2:'Expected profit per trade based on your stats',color:fs.exp>=0?'pos':'neg',icon:'🎯',c:'yellow'},
          ].map(s=>(
            <div key={s.label} style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:10,padding:'18px 20px'}}>
              <div style={{fontSize:11,fontWeight:600,color:'var(--text-muted)',letterSpacing:'.5px',textTransform:'uppercase',marginBottom:10}}>{s.label}</div>
              <div className={`stat-val ${s.color}`} style={{fontSize:28,marginBottom:4}}>{s.val}</div>
              <div style={{fontSize:11,color:'var(--text-secondary)',marginBottom:2}}>{s.sub}</div>
              {s.bar!==undefined && <div className="prog-bar" style={{marginTop:8}}><div className="prog-fill" style={{width:`${s.bar}%`,background:s.bar>=50?'var(--blue)':'var(--red)'}}/></div>}
              <div style={{fontSize:10,color:'var(--text-muted)',marginTop:4}}>{s.sub2}</div>
            </div>
          ))}
        </div>

        {/* Quick stats + Equity curve */}
        <div style={{display:'grid',gridTemplateColumns:'300px 1fr',gap:16,marginBottom:16}}>
          {/* Quick stats */}
          <div className="card">
            <div className="card-title">Quick Stats</div>
            <div className="qs-grid">
              <div className="qs-item"><div className="qs-label">AVG WINNER</div><div className="qs-val pos">${fs.avgW.toFixed(2)}</div></div>
              <div className="qs-item"><div className="qs-label">AVG LOSER</div><div className="qs-val neg">-${fs.avgL.toFixed(2)}</div></div>
              <div className="qs-item"><div className="qs-label">BEST TRADE</div><div className="qs-val pos">{fmtK(fs.best)}</div></div>
              <div className="qs-item"><div className="qs-label">WORST TRADE</div><div className="qs-val neg">{fmtK(fs.worst)}</div></div>
              <div className="qs-item"><div className="qs-label">WIN STREAK</div><div className="qs-val neu">{fs.maxWs} trades</div></div>
              <div className="qs-item"><div className="qs-label">LOSS STREAK</div><div className="qs-val neu">{fs.maxLs} trades</div></div>
              <div className="qs-item"><div className="qs-label">RISK:REWARD</div><div className="qs-val neu">1:{fs.avgRR>=0?fs.avgRR.toFixed(2):'0.00'}</div></div>
              <div className="qs-item"><div className="qs-label">OPEN TRADES</div><div className="qs-val neu">0</div></div>
            </div>
          </div>

          {/* Equity curve */}
          <div className="card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div>
                <div className="card-title" style={{marginBottom:2}}>📈 Equity Curve</div>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>Cumulative P&L progression</div>
              </div>
              <div className="time-filters">
                <button className="tf-btn active">Equity</button>
                <button className="tf-btn">Drawdown</button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={equityCurve} margin={{top:5,right:0,left:0,bottom:0}}>
                <defs>
                  <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false}/>
                <YAxis tick={{fill:'var(--text-muted)',fontSize:10}} tickLine={false} axisLine={false} tickFormatter={v=>`$${v}`}/>
                <Tooltip content={<TIP/>}/>
                <ReferenceLine y={0} stroke="var(--border-light)" strokeDasharray="3 3"/>
                <Area type="monotone" dataKey="pnl" stroke="#3b82f6" strokeWidth={2} fill="url(#eg)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Long vs Short + Day Performance + Top Symbols */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:16}}>
          {/* Long vs Short */}
          <div className="card">
            <div className="card-title">📈 Long vs Short</div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>Performance by trade direction</div>
            {[{side:'Long',data:lsData.long,color:'var(--blue-bright)',icon:'📈'},{side:'Short',data:lsData.short,color:'var(--red)',icon:'📉'}].map(({side,data,color,icon})=>(
              <div key={side} style={{background:'var(--bg-hover)',borderRadius:8,padding:'13px 14px',marginBottom:10,border:`1px solid ${side==='Long'?'rgba(59,130,246,.2)':'rgba(239,68,68,.2)'}`}}>
                <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:10}}>
                  <span style={{fontSize:14}}>{icon}</span>
                  <span style={{fontWeight:700,color}}>{side}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  <div><div style={{fontSize:9,color:'var(--text-muted)',fontWeight:600}}>TRADES</div><div style={{fontWeight:700}}>{data.total}</div></div>
                  <div><div style={{fontSize:9,color:'var(--text-muted)',fontWeight:600}}>P&L</div><div style={{fontWeight:700,color:data.pnl>=0?'var(--blue-bright)':'var(--red)'}}>{fmtK(data.pnl)}</div></div>
                  <div><div style={{fontSize:9,color:'var(--text-muted)',fontWeight:600}}>WIN %</div><div style={{fontWeight:700,color:parseFloat(data.wr)>=50?'var(--blue-bright)':'var(--red)'}}>{data.wr}%</div></div>
                </div>
              </div>
            ))}
          </div>

          {/* Day Performance */}
          <div className="card">
            <div className="card-title">📅 Day Performance</div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>Find your best trading days</div>
            {dayPerf.map(d=>(
              <div key={d.day} style={{display:'flex',alignItems:'center',gap:8,marginBottom:7}}>
                <span style={{width:28,fontSize:11,color:'var(--text-secondary)',fontWeight:500}}>{d.day}</span>
                <div style={{flex:1,height:8,background:'var(--bg-hover)',borderRadius:4,overflow:'hidden'}}>
                  {d.pnl!==0 && <div style={{height:'100%',width:`${(Math.abs(d.pnl)/maxDayAbs)*100}%`,background:d.pnl>=0?'var(--blue)':'var(--red)',borderRadius:4}}/>}
                </div>
                <span style={{fontSize:11,fontWeight:700,color:d.pnl>=0?'var(--blue-bright)':'var(--red)',width:70,textAlign:'right'}}>{d.pnl===0?'—':fmt(d.pnl)}</span>
              </div>
            ))}
          </div>

          {/* Top Symbols */}
          <div className="card">
            <div className="card-title">🏆 Top Symbols</div>
            <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:12}}>Best performing assets</div>
            {topSymbols.map((s,i)=>(
              <div key={s.sym} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'9px 0',borderBottom:'1px solid var(--border)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{width:20,height:20,borderRadius:'50%',background:'var(--bg-hover)',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'var(--text-muted)'}}>{i+1}</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:13}}>{s.sym}</div>
                    <div style={{fontSize:10,color:'var(--text-muted)'}}>{s.total} trades · {s.wr} win</div>
                  </div>
                </div>
                <div className={s.pnl>=0?'pos':'neg'} style={{fontWeight:700,fontSize:13}}>{fmtK(s.pnl)}</div>
              </div>
            ))}
            {topSymbols.length===0 && <div className="empty-state" style={{padding:'20px 0'}}><div className="empty-text">No data</div></div>}
          </div>
        </div>

        {/* Session Performance */}
        <div className="card" style={{marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
            <span className="card-title" style={{margin:0}}>🌍 Session Performance</span>
          </div>
          <div style={{fontSize:11,color:'var(--text-muted)',marginBottom:16}}>Breakdown by trading session — Asian, London &amp; New York</div>
          <div style={{display:'flex',height:8,borderRadius:4,overflow:'hidden',marginBottom:20}}>
            <div style={{flex:2,background:'#854d0e',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'rgba(255,255,255,.7)',letterSpacing:'.5px'}}>ASIAN</div>
            <div style={{flex:2,background:'#1e3a5f',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'rgba(255,255,255,.7)',letterSpacing:'.5px'}}>LONDON</div>
            <div style={{flex:3,background:'#14532d',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:700,color:'rgba(255,255,255,.7)',letterSpacing:'.5px'}}>NEW YORK</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14}}>
            {[
              {key:'asian',  icon:'🏯', border:'rgba(133,77,14,.4)',  bg:'rgba(133,77,14,.08)'},
              {key:'london', icon:'🏛', border:'rgba(30,58,95,.6)',   bg:'rgba(30,58,95,.15)'},
              {key:'newyork',icon:'🗽', border:'rgba(20,83,45,.5)',   bg:'rgba(20,83,45,.12)'},
            ].map(({key,icon,border,bg})=>{
              const s=sessions[key];
              return (
                <div key={key} style={{background:bg,border:`1px solid ${border}`,borderRadius:10,padding:'16px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:4}}>
                    <span style={{fontSize:18}}>{icon}</span>
                    <div>
                      <div style={{fontWeight:700,fontSize:14}}>{s.label}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>{s.time}</div>
                    </div>
                  </div>
                  <div className={s.pnl>=0?'pos':'neg'} style={{fontSize:22,fontWeight:800,marginBottom:8}}>{fmtK(s.pnl)}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                    <div><div style={{fontSize:9,color:'var(--text-muted)',fontWeight:600}}>TRADES</div><div style={{fontWeight:700,fontSize:12}}>{s.total}</div></div>
                    <div><div style={{fontSize:9,color:'var(--text-muted)',fontWeight:600}}>WIN RATE</div><div style={{fontWeight:700,fontSize:12,color:parseFloat(s.wr)>=50?'var(--blue-bright)':'var(--red)'}}>{s.wr}%</div></div>
                    <div><div style={{fontSize:9,color:'var(--text-muted)',fontWeight:600}}>AVG TRADE</div><div style={{fontWeight:700,fontSize:12,color:s.total>0&&s.pnl/s.total>=0?'var(--blue-bright)':'var(--red)'}}>{s.total>0?fmtK(s.pnl/s.total):'—'}</div></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Your Stats big table + Win/Loss dist + Recent */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 360px',gap:16}}>
          {/* Full stats table */}
          <div className="card">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div className="card-title" style={{margin:0}}>Your Stats</div>
              <span style={{background:'var(--bg-hover)',border:'1px solid var(--border)',borderRadius:5,padding:'2px 9px',fontSize:11,color:'var(--text-secondary)',fontWeight:600}}>{period}</span>
            </div>
            {/* Best/Worst/Avg month */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
              {[
                {l:'BEST MONTH',v:fmtK(monthStats.best),sub:monthStats.bestMonth||'—',c:'pos'},
                {l:'WORST MONTH',v:fmtK(monthStats.worst),sub:monthStats.worstMonth||'—',c:'neg'},
                {l:'AVERAGE',v:fmtK(monthStats.avg),sub:'per Month',c:monthStats.avg>=0?'pos':'neg'},
              ].map(x=>(
                <div key={x.l} style={{background:'var(--bg-hover)',borderRadius:8,padding:'12px 14px'}}>
                  <div style={{fontSize:9,fontWeight:600,color:'var(--text-muted)',marginBottom:4}}>{x.l}</div>
                  <div className={`${x.c}`} style={{fontWeight:800,fontSize:15}}>{x.v}</div>
                  <div style={{fontSize:10,color:'var(--text-muted)'}}>{x.sub}</div>
                </div>
              ))}
            </div>
            {/* Stats rows */}
            <div style={{columns:2,columnGap:20}}>
              {[
                ['Total P&L (Gross)',   fmtK(fs.totalPnl),         fs.totalPnl>=0],
                ['Commission',         `-$${(fs.totalComm||0).toFixed(2)}`,  false],
                ['Total Brokerage',    `-$${(fs.totalBrokerage||0).toFixed(2)}`, false],
                ['Open trades','0',null],
                ['Average daily volume', fs.total>0?(fs.total/Math.max(tradingDays.total,1)).toFixed(1):'0',null],
                ['Total trading days',tradingDays.total,null],
                ['Average winning trade',`$${fs.avgW.toFixed(2)}`,true],
                ['Winning days',tradingDays.winDays,null],
                ['Average losing trade',`-$${fs.avgL.toFixed(2)}`,false],
                ['Losing days',tradingDays.lossDays,null],
                ['Total number of trades',fs.total,null],
                ['Breakeven days',tradingDays.total-tradingDays.winDays-tradingDays.lossDays,null],
                ['Number of winning trades',fs.wins,null],
                ['Max consecutive winning days',fs.maxWs,null],
                ['Number of losing trades',fs.losses,null],
                ['Max consecutive losing days',fs.maxLs,null],
                ['Max consecutive wins',fs.maxWs,null],
                ['Average daily P&L',`$${tradingDays.avgDayPnl.toFixed(2)}`,tradingDays.avgDayPnl>=0],
                ['Max consecutive losses',fs.maxLs,null],
                ['Average winning day P&L',`$${tradingDays.avgWinDay.toFixed(2)}`,true],
                ['Largest profit',fmtK(fs.best),true],
                ['Average losing day P&L',`$${tradingDays.avgLossDay.toFixed(2)}`,false],
                ['Largest loss',fmtK(fs.worst),false],
                ['Largest profitable day',fmtK(tradingDays.bestDay),true],
                ['Trade expectancy',`$${fs.exp.toFixed(2)}`,fs.exp>=0],
                ['Largest losing day',fmtK(tradingDays.worstDay),false],
                ['Max drawdown',fmtK(-stats.maxDrawdown),false],
                ['Total commissions',`-$${stats.totalCommissions.toFixed(2)}`,false],
                ['Max drawdown %',`${stats.accountSize>0?((stats.maxDrawdown/stats.accountSize)*100).toFixed(2):0}%`,false],
                ['Account Size', `$${(stats.accountSize||10000).toLocaleString()}`, null],
                ['Account Return', `${stats.accountSize>0?((stats.totalPnl/stats.accountSize)*100).toFixed(2):0}%`, stats.totalPnl>=0],
              ].map(([l,v,pos])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid var(--border)',breakInside:'avoid',fontSize:12}}>
                  <span style={{color:'var(--text-secondary)'}}>{l}</span>
                  <span style={{fontWeight:700,color:pos===null?'var(--text-primary)':pos?'var(--blue-bright)':'var(--red)'}}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Win/Loss + Recent */}
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div className="card">
              <div className="card-title">Win/Loss Distribution</div>
              <div className="wl-bar" style={{marginBottom:12}}>
                <div className="wl-win" style={{flex:fs.wins}}>
                  {fs.wins>0&&<span>{fs.wins}W</span>}
                </div>
                <div className="wl-loss" style={{flex:Math.max(fs.losses,1)}}>
                  {fs.losses>0&&<span>{fs.losses}L</span>}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6,fontSize:12}}>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:2,background:'var(--blue)',display:'inline-block'}}/> Gross Profit</span><span className="pos" style={{fontWeight:700}}>${fs.gp.toFixed(2)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:2,background:'var(--red)',display:'inline-block'}}/> Gross Loss</span><span className="neg" style={{fontWeight:700}}>-${fs.gl.toFixed(2)}</span></div>
                <div style={{display:'flex',justifyContent:'space-between'}}><span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:2,background:'var(--blue)',display:'inline-block'}}/> Net Result</span><span className={fs.totalPnl>=0?'pos':'neg'} style={{fontWeight:700}}>${fs.totalPnl.toFixed(2)}</span></div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">🕐 Recent Trades</div>
              <div style={{fontSize:10,color:'var(--text-muted)',marginBottom:10}}>Your last {Math.min(filteredTrades.length,5)} trades</div>
              {filteredTrades.slice(0,5).map(t=>(
                <div key={t.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                  <div style={{display:'flex',alignItems:'center',gap:9}}>
                    <div style={{width:28,height:28,background:t.side==='Long'?'var(--blue-dim)':'var(--red-dim)',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12}}>
                      {t.side==='Long'?'📈':'📉'}
                    </div>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{t.symbol}</div>
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>{t.entryDate?.slice(5)}</div>
                    </div>
                  </div>
                  <div className={`${(t.pnl||0)>=0?'pos':'neg'}`} style={{fontWeight:700,fontSize:13}}>{fmtK(t.pnl||0)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


