import React, { useState, useMemo } from 'react';
import { useTrades } from '../context/TradesContext';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const fmt = n => `${n>=0?'+':'-'}$${Math.abs(n).toFixed(2)}`;
const fmtShort = n => { const a=Math.abs(n),s=n>=0?'+':'-'; return a>=1000?`${s}$${(a/1000).toFixed(1)}k`:`${s}$${a.toFixed(2)}`; };

export default function Calendar() {
  const { trades, stats } = useTrades();
  const brokeragePerLot = stats.brokeragePerLot || 0;

  const initMonth = useMemo(() => {
    const valid = trades.filter(t => !t.isWithdrawal && (t.exitDate || t.entryDate));
    if (!valid.length) return new Date();
    const d = [...valid].sort((a,b)=>(b.exitDate||b.entryDate).localeCompare(a.exitDate||a.entryDate))[0];
    const dt = d.exitDate || d.entryDate;
    return new Date(parseInt(dt.slice(0,4)), parseInt(dt.slice(5,7))-1, 1);
  }, []);

  const [current,  setCurrent]  = useState(initMonth);
  const [selected, setSelected] = useState(null);

  const year  = current.getFullYear();
  const month = current.getMonth();

  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDOW    = new Date(year, month, 1).getDay();
  const offset      = firstDOW === 0 ? 6 : firstDOW - 1;
  const totalWeeks  = Math.ceil((offset + daysInMonth) / 7);

  const ds = d => `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const dn = (wi, di) => wi * 7 + di - offset + 1;

  const dayMap = useMemo(() => {
    const sd = stats.statsStartDate || '';
    const ed = stats.statsEndDate   || '';
    const tradeMap = {};
    const wdMap    = {};

    trades.forEach(t => {
      const d = t.exitDate || t.entryDate;
      if (!d) return;
      if (t.isOpen || t.status === 'Open') return;

      if (t.isWithdrawal) {
        // Use entryDate for withdrawals — exitDate may be wrong if saved with old bug
        const wd = t.entryDate || t.exitDate;
        if (!wd) return;
        if (!wdMap[wd]) wdMap[wd] = { amount: 0, count: 0 };
        wdMap[wd].amount += Math.abs(t.pnl || 0);
        wdMap[wd].count  += 1;
        return;
      }

      if (sd && d < sd) return;
      if (ed && d > ed) return;

      if (!tradeMap[d]) tradeMap[d] = { pnl: 0, comm: 0, count: 0, trades: [] };
      tradeMap[d].pnl   += parseFloat(t.pnl  || 0);
      tradeMap[d].comm  += parseFloat(t.fees || 0) + brokeragePerLot * (t.size || 0);
      tradeMap[d].count += 1;
      tradeMap[d].trades.push(t);
    });

    Object.values(tradeMap).forEach(v => {
      v.pnl  = parseFloat(v.pnl.toFixed(2));
      v.comm = parseFloat(v.comm.toFixed(2));
    });
    return { tradeMap, wdMap };
  }, [trades, stats.statsStartDate, stats.statsEndDate, brokeragePerLot]);

  const { tradeMap, wdMap } = dayMap;

  const monthPnl = useMemo(() => {
    let t = 0;
    for (let d = 1; d <= daysInMonth; d++) t += tradeMap[ds(d)]?.pnl ?? 0;
    return parseFloat(t.toFixed(2));
  }, [tradeMap, daysInMonth, year, month]);

  const weekData = wi => {
    let pnl = 0, comm = 0, tradedDays = 0;
    for (let di = 0; di < 7; di++) {
      const d = dn(wi, di);
      if (d < 1 || d > daysInMonth) continue;
      const cell = tradeMap[ds(d)];
      if (cell) { pnl += cell.pnl; comm += cell.comm; tradedDays++; }
    }
    return { pnl: parseFloat(pnl.toFixed(2)), comm: parseFloat(comm.toFixed(2)), tradedDays };
  };

  const today   = new Date().toISOString().slice(0, 10);
  const selCell = selected ? tradeMap[selected] : null;
  const selWd   = selected ? wdMap[selected]    : null;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden' }}>
      <div className="page-header" style={{ flexShrink:0 }}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div className="page-title">Trading Calendar</div>
            <div style={{fontSize:11,color:'var(--text-muted)'}}>Gross P&L by day · click to see detail</div>
            {(stats.statsStartDate||stats.statsEndDate) && (
              <span style={{background:'rgba(59,130,246,.15)',color:'var(--blue-bright)',borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:600}}>
                📅 {stats.statsStartDate||'all'} → {stats.statsEndDate||'today'}
              </span>
            )}
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <span className={monthPnl>=0?'pos':'neg'} style={{fontWeight:700}}>Monthly: {fmt(monthPnl)}</span>
          <button className="btn-icon" onClick={()=>setCurrent(new Date(year,month-1,1))}>‹</button>
          <span style={{fontWeight:700,fontSize:14,minWidth:130,textAlign:'center'}}>{MONTHS[month]} {year}</span>
          <button className="btn-icon" onClick={()=>setCurrent(new Date(year,month+1,1))}>›</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:0, flex:1, overflow:'hidden', padding:'16px', paddingTop:'12px' }}>
        <div className="card" style={{ padding:'16px', display:'flex', flexDirection:'column', overflow:'hidden', height:'100%' }}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr) 110px',gap:4,marginBottom:6,flexShrink:0}}>
            {['MON','TUE','WED','THU','FRI','SAT','SUN'].map(d=>(
              <div key={d} style={{textAlign:'center',fontSize:10,fontWeight:700,color:'var(--text-muted)',padding:'4px 0'}}>{d}</div>
            ))}
            <div style={{textAlign:'center',fontSize:10,fontWeight:700,color:'var(--text-muted)',padding:'4px 0'}}>WEEKLY</div>
          </div>

          <div style={{ flex:1, display:'flex', flexDirection:'column', gap:4 }}>
          {Array.from({length:totalWeeks},(_,wi)=>{
            const wp = weekData(wi);
            return (
              <div key={wi} style={{display:'grid',gridTemplateColumns:'repeat(7,1fr) 110px',gap:4,flex:1}}>
                {Array.from({length:7},(_,di)=>{
                  const d    = dn(wi,di);
                  if (d<1||d>daysInMonth) return <div key={di} style={{flex:1}}/>;
                  const date  = ds(d);
                  const cell  = tradeMap[date];
                  const wd    = wdMap[date];
                  const pos   = cell && cell.pnl >= 0;
                  const isTod = date === today;
                  const isSel = selected === date;

                  return (
                    <div key={di} onClick={()=>setSelected(isSel?null:date)}
                      style={{
                        borderRadius:6, padding:'6px 7px', boxSizing:'border-box',
                        cursor:(cell||wd)?'pointer':'default',
                        background: cell?(pos?'rgba(59,130,246,.12)':'rgba(239,68,68,.12)'):'var(--bg-hover)',
                        border: isSel?`2px solid ${pos?'var(--blue)':'var(--red)'}`:isTod?'2px solid var(--blue)':'1px solid var(--border)',
                        transition:'all .14s', position:'relative',
                        display:'flex', flexDirection:'column', minHeight:0,
                      }}>
                      <div style={{fontSize:11,fontWeight:isTod?700:500,color:isTod?'var(--blue)':'var(--text-secondary)',marginBottom:2}}>{d}</div>
                      {cell && (
                        <div style={{fontSize:11,fontWeight:800,color:pos?'var(--blue-bright)':'var(--red)'}}>{fmtShort(cell.pnl)}</div>
                      )}
                      {wd && (
                        <div style={{marginTop:cell?2:0,fontSize:9,fontWeight:700,color:'#f59e0b',display:'flex',alignItems:'center',gap:2}}>
                          💸 -{wd.amount.toFixed(0)}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div style={{
                  borderRadius:6, padding:'7px 10px', boxSizing:'border-box',
                  background:wp.tradedDays>0?(wp.pnl>=0?'rgba(59,130,246,.08)':'rgba(239,68,68,.08)'):'var(--bg-hover)',
                  border:'1px solid var(--border)',
                  display:'flex', flexDirection:'column', justifyContent:'center', minHeight:0,
                }}>
                  <div style={{fontSize:8,fontWeight:700,color:'var(--text-muted)',letterSpacing:'.5px',marginBottom:2}}>WEEKLY</div>
                  <div style={{fontSize:11,fontWeight:800,color:wp.tradedDays>0?(wp.pnl>=0?'var(--blue-bright)':'var(--red)'):'var(--text-muted)'}}>
                    {wp.tradedDays>0?fmt(wp.pnl):'$0'}
                  </div>
                  <div style={{fontSize:9,color:'var(--text-muted)'}}>Traded {wp.tradedDays}d</div>
                </div>
              </div>
            );
          })}
          </div>

          <div style={{display:'flex',gap:16,marginTop:10,fontSize:11,color:'var(--text-secondary)',flexShrink:0}}>
            <span><span style={{color:'var(--blue)'}}>●</span> Profit</span>
            <span><span style={{color:'var(--red)'}}>●</span> Loss</span>
            <span><span style={{color:'#f59e0b'}}>💸</span> Withdrawal</span>
          </div>
        </div>

        <div className="card" style={{ marginLeft:16, display:'flex', flexDirection:'column', overflow:'auto', height:'100%' }}>
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:12}}>
            <span style={{fontSize:14}}>📅</span>
            <span style={{fontWeight:700,fontSize:14}}>Day Detail</span>
          </div>
          {(selCell || selWd) ? (
            <>
              <div style={{marginBottom:12,padding:'8px 10px',background:'var(--bg-hover)',borderRadius:7}}>
                <div style={{fontSize:11,color:'var(--text-muted)'}}>Date</div>
                <div style={{fontWeight:700,fontSize:13}}>{selected}</div>
              </div>

              {selWd && (
                <div style={{marginBottom:12,padding:'10px 12px',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:7}}>
                  <div style={{fontSize:11,color:'#f59e0b',fontWeight:700,marginBottom:2}}>💸 WITHDRAWAL</div>
                  <div style={{fontWeight:800,fontSize:16,color:'#f59e0b'}}>-${selWd.amount.toFixed(2)}</div>
                  <div style={{fontSize:10,color:'var(--text-muted)'}}>Not counted in P&L or stats</div>
                </div>
              )}

              {selCell && (
                <>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
                    <div style={{padding:'10px',background:selCell.pnl>=0?'var(--blue-dim)':'var(--red-dim)',borderRadius:7}}>
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>Gross P&L</div>
                      <div style={{fontWeight:800,fontSize:16,color:selCell.pnl>=0?'var(--blue-bright)':'var(--red)'}}>{fmt(selCell.pnl)}</div>
                    </div>
                    <div style={{padding:'10px',background:'var(--bg-hover)',borderRadius:7}}>
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>Commission</div>
                      <div style={{fontWeight:800,fontSize:16,color:'var(--red)'}}>-${selCell.comm.toFixed(2)}</div>
                    </div>
                  </div>
                  <div style={{marginBottom:12,padding:'10px',background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:7}}>
                    <div style={{fontSize:10,color:'var(--text-muted)'}}>Net P&L</div>
                    <div style={{fontWeight:800,fontSize:18,color:(selCell.pnl-selCell.comm)>=0?'var(--blue-bright)':'var(--red)'}}>
                      {fmt(selCell.pnl-selCell.comm)}
                    </div>
                    <div style={{fontSize:10,color:'var(--text-muted)'}}>{selCell.count} trade{selCell.count!==1?'s':''}</div>
                  </div>
                  {selCell.trades.map(t=>(
                    <div key={t.id} style={{padding:'8px 0',borderBottom:'1px solid var(--border)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                        <div style={{display:'flex',gap:6,alignItems:'center'}}>
                          <span style={{fontWeight:700,fontSize:13}}>{t.symbol}</span>
                          <span className={`badge badge-${(t.side||'long').toLowerCase()}`} style={{fontSize:9}}>{t.side}</span>
                        </div>
                        <span className={(t.pnl||0)>=0?'pos':'neg'} style={{fontWeight:700,fontSize:13}}>{fmt(t.pnl||0)}</span>
                      </div>
                      {(() => { const effComm = (t.fees||0) + brokeragePerLot*(t.size||0); return effComm>0 ? <div style={{fontSize:10,color:'var(--text-muted)'}}>Comm: -${effComm.toFixed(2)}</div> : null; })()}
                      <div style={{fontSize:10,color:'var(--text-muted)'}}>{t.entryTime}→{t.exitTime||'—'} · {t.size||0} lots</div>
                    </div>
                  ))}
                </>
              )}
            </>
          ) : (
            <div style={{textAlign:'center',padding:'30px 10px',color:'var(--text-muted)'}}>
              <div style={{fontSize:28,marginBottom:10}}>📅</div>
              <div style={{fontSize:12}}>Click a day to view detail</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
