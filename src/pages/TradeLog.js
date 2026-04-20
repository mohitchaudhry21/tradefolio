import React, { useState, useMemo } from 'react';
import { useTrades } from '../context/TradesContext';
import { useToast } from '../context/ToastContext';
import TradeModal from '../components/TradeModal';

const fmt = n => `${n>=0?'+':'-'}$${Math.abs(n).toFixed(2)}`;
const fmtDate = d => { if(!d) return '—'; try { return new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); } catch { return d; } };

export default function TradeLog() {
  const { trades, deleteTrade, clearAllTrades, broker, stats, updateTrade, accounts, activeAccount } = useTrades();
  const { showToast } = useToast();

  // Commission per trade: use account brokerage rate if set, otherwise t.fees
  const brokeragePerLot = stats.brokeragePerLot || 0;
  const tradeComm = t => brokeragePerLot > 0
    ? brokeragePerLot * (t.size || 0)
    : (t.fees || 0);
  const [showModal,   setShowModal]   = useState(false);
  const [editTrade,   setEditTrade]   = useState(null);
  const [detailTrade, setDetailTrade] = useState(null);
  const [confirmDel,  setConfirmDel]  = useState(null);
  const [search,      setSearch]      = useState('');
  const [filterSide,  setFilterSide]  = useState('All');
  const [filterStatus,setFilterStatus]= useState('All');
  const [sortKey,     setSortKey]     = useState('exitDate');
  const [sortDir,     setSortDir]     = useState('desc');

  const filtered = useMemo(() => {
    let arr = [...trades];
    if (search) arr=arr.filter(t=>t.symbol?.toLowerCase().includes(search.toLowerCase())||t.setup?.toLowerCase().includes(search.toLowerCase()));
    if (filterSide!=='All') arr=arr.filter(t=>t.side===filterSide);
    if (filterStatus!=='All') arr=arr.filter(t=>t.status===filterStatus);
    arr.sort((a,b)=>{
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'exitDate')  { av = `${a.exitDate||''}${a.exitTime||''}`; bv = `${b.exitDate||''}${b.exitTime||''}`; }
      if (sortKey === 'entryDate') { av = `${a.entryDate||''}${a.entryTime||''}`; bv = `${b.entryDate||''}${b.entryTime||''}`; }
      if (typeof av==='string') av=av.toLowerCase();
      if (typeof bv==='string') bv=bv.toLowerCase();
      return sortDir==='asc' ? (av<bv?-1:av>bv?1:0) : (av>bv?-1:av<bv?1:0);
    });
    return arr;
  }, [trades, search, filterSide, filterStatus, sortKey, sortDir]);

  // Summary stats — respect the saved stats date range, exclude withdrawals
  const statsTrades = useMemo(() => {
    const sd = stats.statsStartDate || '';
    const ed = stats.statsEndDate   || '';
    return filtered.filter(t => {
      if (t.isWithdrawal) return false;
      if (t.isOpen || t.status === 'Open') return false;
      const d = t.exitDate || t.entryDate || '';
      if (sd && d < sd) return false;
      if (ed && d > ed) return false;
      return true;
    });
  }, [filtered, stats.statsStartDate, stats.statsEndDate]);

  const totalPnl = statsTrades.reduce((s,t)=>s+(t.pnl||0),0);
  const dateRangeActive = !!(stats.statsStartDate || stats.statsEndDate);

  const handleSort = k => { if (sortKey===k) setSortDir(d=>d==='asc'?'desc':'asc'); else {setSortKey(k);setSortDir('desc');}};
  const SI = ({col}) => sortKey===col ? (sortDir==='asc'?' ↑':' ↓') : '';

  return (
    <div>
      <div className="page-header">
        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div>
            <div className="page-title">Trades</div>
          </div>
          {broker.connected && (
            <div style={{display:'flex',alignItems:'center',gap:8,background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,padding:'5px 12px'}}>
              <span style={{width:8,height:8,borderRadius:'50%',background:'var(--green)',display:'inline-block'}}/>
              <span style={{fontSize:13,fontWeight:600}}>{broker.name}</span>
            </div>
          )}
        </div>
        <div style={{display:'flex',gap:8}}>
          {broker.connected && (
            <>
              <button className="btn btn-secondary">↻ Sync</button>
              <button className="btn btn-secondary" style={{color:'var(--red)'}}>Disconnect</button>
            </>
          )}
          {(() => {
            const label = activeAccount ? `Clear ${activeAccount.name} Trades` : 'Clear All Trades';
            const msg   = activeAccount
              ? `Delete all trades for "${activeAccount.name}"? Other accounts won't be affected. This cannot be undone.`
              : 'Delete ALL trades from every account? This cannot be undone.';
            return (
              <button className="btn btn-danger btn-sm" style={{fontSize:12}}
                onClick={() => { if (window.confirm(msg)) clearAllTrades(activeAccount?.id, accounts); }}>
                🗑 {label}
              </button>
            );
          })()}
          <button className="btn btn-primary" onClick={()=>{setEditTrade(null);setShowModal(true);}}>+ Add Trade</button>
        </div>
      </div>

      <div className="page-body">
        {/* Stats date filter active badge */}
        {(stats.statsStartDate || stats.statsEndDate) && (
          <div style={{background:'rgba(59,130,246,.1)',border:'1px solid rgba(59,130,246,.2)',borderRadius:8,padding:'9px 14px',marginBottom:12,display:'flex',alignItems:'center',gap:8,fontSize:12}}>
            <span style={{color:'var(--blue-bright)'}}>📅</span>
            <span style={{color:'var(--text-secondary)'}}>Stats filtering: <strong style={{color:'var(--blue-bright)'}}>{stats.statsStartDate||'all time'}</strong> → <strong style={{color:'var(--blue-bright)'}}>{stats.statsEndDate||'today'}</strong>. Trades outside this range don't count toward metrics.</span>
          </div>
        )}
        {/* Warning: blank symbol rows */}
        {(() => {
          const badTrades = trades.filter(t => !t.symbol || t.symbol.trim() === '');
          if (!badTrades.length) return null;
          return (
            <div style={{background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.3)',borderRadius:8,padding:'12px 16px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:'var(--red)',marginBottom:2}}>⚠ {badTrades.length} entry with no symbol</div>
                <div style={{fontSize:12,color:'var(--text-secondary)'}}>These may be imported withdrawals or deposit rows. Delete them to fix calendar values.</div>
              </div>
              <button className="btn btn-danger btn-sm" style={{flexShrink:0}} onClick={()=>{ if(window.confirm(`Delete ${badTrades.length} entry(s) with no symbol?`)) badTrades.forEach(t=>deleteTrade(t.id)); }}>
                Delete {badTrades.length} row{badTrades.length>1?'s':''}
              </button>
            </div>
          );
        })()}
        {/* Filters */}
        <div className="filter-bar" style={{marginBottom:16}}>
          <input className="filter-inp" placeholder="🔍 Search symbol or setup..." value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,maxWidth:260}}/>
          <select className="filter-inp" value={filterSide} onChange={e=>setFilterSide(e.target.value)}>
            <option>All</option><option>Long</option><option>Short</option>
          </select>
          <select className="filter-inp" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option>All</option><option>Win</option><option>Loss</option><option>Breakeven</option>
          </select>
          <div style={{marginLeft:'auto',display:'flex',gap:12,alignItems:'center'}}>
            <span style={{fontSize:12,color:'var(--text-secondary)'}}>
              {dateRangeActive
                ? <>{statsTrades.length} <span style={{color:'var(--text-muted)'}}>of</span> {filtered.length} trades</>
                : <>{filtered.length} trades</>
              }
            </span>
            <span className={totalPnl>=0?'pos':'neg'} style={{fontWeight:700,fontSize:13}}>
              {fmt(totalPnl)}
              <span style={{fontSize:10,fontWeight:400,color:'var(--text-muted)',marginLeft:4}}>gross{dateRangeActive?' · in range':''}</span>
            </span>
          </div>
        </div>

        {/* Trade History */}
        <div className="card" style={{padding:0}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid var(--border)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:700,fontSize:14}}>Trade History <span style={{color:'var(--text-muted)',fontSize:12,fontWeight:400}}>{dateRangeActive ? `${statsTrades.length} of ${filtered.length}` : filtered.length} trades</span></span>
            <button className="btn-icon" title="Filters">⚙ Filters</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>OPEN / CLOSE</th>
                  <th onClick={()=>handleSort('symbol')} style={{cursor:'pointer'}}>SYMBOL<SI col="symbol"/></th>
                  <th>TYPE</th>
                  <th onClick={()=>handleSort('entryPrice')} style={{cursor:'pointer'}}>ENTRY<SI col="entryPrice"/></th>
                  <th onClick={()=>handleSort('exitPrice')} style={{cursor:'pointer'}}>EXIT<SI col="exitPrice"/></th>
                  <th>SIZE</th>
                  <th onClick={()=>handleSort('pnl')} style={{cursor:'pointer'}}>P&L<SI col="pnl"/></th>
                  <th>COMM</th>
                  <th>STATUS</th>
                  <th>SOURCE</th>
                  <th/>
                </tr>
              </thead>
              <tbody>
                {filtered.length===0 && (
                  <tr><td colSpan={11}>
                    <div className="empty-state">
                      <div className="empty-icon">📋</div>
                      <div className="empty-text">No trades yet. Log your first trade!</div>
                    </div>
                  </td></tr>
                )}
                {filtered.map(t=>(
                  <tr key={t.id} onClick={()=>setDetailTrade(t)} style={t.isWithdrawal?{background:'rgba(239,68,68,.04)',opacity:0.85}:{}}>
                    <td style={{color:'var(--text-secondary)',fontSize:12}}>
                      <div>{fmtDate(t.entryDate)} {t.entryTime}</div>
                      {!t.isWithdrawal&&<div style={{color:'var(--text-muted)'}}>→ {fmtDate(t.exitDate||t.entryDate)} {t.exitTime||'—'}</div>}
                    </td>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:28,height:28,background:t.isWithdrawal?'var(--red-dim)':'var(--bg-hover)',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>
                          {t.isWithdrawal?'💸':'💰'}
                        </div>
                        <div>
                          <span style={{fontWeight:700}}>{t.isWithdrawal?'Withdrawal':t.symbol}</span>
                          {t.isWithdrawal&&<div style={{fontSize:10,color:'var(--text-muted)'}}>Not counted in stats</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {t.isWithdrawal
                        ? <span style={{background:'var(--red-dim)',color:'var(--red)',borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700}}>WITHDRAWAL</span>
                        : <span className={`badge badge-${(t.side||'long').toLowerCase()}`}>{t.side==='Long'?'📈':'📉'} {t.side||'—'}</span>
                      }
                    </td>
                    <td style={{fontWeight:500,color:t.isWithdrawal?'var(--text-muted)':undefined}}>{t.isWithdrawal?'—':`$${(t.entryPrice||0).toFixed(t.entryPrice>100?2:5)}`}</td>
                    <td style={{fontWeight:500,color:t.isWithdrawal?'var(--text-muted)':undefined}}>
                      {t.isWithdrawal||!t.exitPrice?'—':`$${(t.exitPrice).toFixed(t.exitPrice>100?2:5)}`}
                    </td>
                    <td style={{color:'var(--text-secondary)'}}>{t.isWithdrawal?'—':t.size||t.quantity||0}</td>
                    <td style={{fontWeight:700,color:t.isWithdrawal?'var(--red)':(t.pnl||0)>=0?'var(--blue-bright)':'var(--red)'}}>
                      {t.isWithdrawal?`-$${Math.abs(t.pnl||0).toFixed(2)}`:fmt(t.pnl||0)}
                    </td>
                    <td style={{color:'var(--text-muted)',fontSize:12}}>
                      {t.isWithdrawal ? '—' : (() => {
                        const comm = tradeComm(t);
                        if (comm <= 0) return '—';
                        const tooltip = brokeragePerLot > 0
                          ? `Calculated: $${brokeragePerLot}/lot × ${t.size||0} lots`
                          : `MT5 commission: $${(t.fees||0).toFixed(2)}`;
                        return <span title={tooltip}>-${comm.toFixed(2)}</span>;
                      })()}
                    </td>
                    <td onClick={e=>e.stopPropagation()}>
                      {!t.isWithdrawal && (
                        <button
                          title={t.status==='Breakeven'?'Click to unmark breakeven':'Mark as Breakeven (excludes from win rate)'}
                          onClick={()=>{
                            const newStatus = t.status==='Breakeven'?(t.pnl>=0?'Win':'Loss'):'Breakeven';
                            updateTrade(t.id,{status:newStatus});
                            showToast({ title: `Marked as ${newStatus}`, message: `${t.symbol} status updated` });
                          }}
                          style={{
                            padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',border:'1px solid',
                            background: t.status==='Win'  ? 'rgba(74,222,128,.15)' :
                                        t.status==='Loss' ? 'var(--red-dim)' :
                                                            'rgba(251,191,36,.15)',
                            color:      t.status==='Win'  ? '#4ade80' :
                                        t.status==='Loss' ? 'var(--red)' :
                                                            '#fbbf24',
                            borderColor:t.status==='Win'  ? 'rgba(74,222,128,.3)' :
                                        t.status==='Loss' ? 'rgba(239,68,68,.3)' :
                                                            'rgba(251,191,36,.3)',
                          }}>
                          {t.status==='Win'?'W':t.status==='Loss'?'L':'BE'}
                        </button>
                      )}
                    </td>
                    <td>
                      {t.isWithdrawal
                        ? <span style={{color:'var(--text-muted)',fontSize:11}}>Balance op</span>
                        : (() => {
                            const acc = accounts.find(a => a.id === t.accountId)
                              || accounts.find(a => a.source === t.source || a.name === t.source);
                            const color = acc?.color || 'var(--blue)';
                            const label = acc?.name || t.source || 'Manual';
                            const acctNum = acc?.accountNumber;
                            return (
                              <div style={{display:'flex',flexDirection:'column',gap:1}}>
                                <span style={{background:`${color}20`,color,borderRadius:5,padding:'2px 7px',fontSize:11,fontWeight:600,whiteSpace:'nowrap'}}>{label}</span>
                                {acctNum && <span style={{fontSize:9,color:'var(--text-muted)',paddingLeft:2}}>#{acctNum}</span>}
                              </div>
                            );
                          })()
                      }
                    </td>
                    <td onClick={e=>e.stopPropagation()}>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn-icon" style={{fontSize:11}} onClick={()=>{setEditTrade(t);setShowModal(true);}}>✏️</button>
                        <button className="btn-icon" style={{fontSize:11}} onClick={()=>setConfirmDel(t.id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {detailTrade && (
        <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&setDetailTrade(null)}>
          <div className="modal" style={{maxWidth:520}}>
            <div className="modal-header">
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={{fontWeight:800,fontSize:18}}>{detailTrade.symbol}</span>
                <span className={`badge badge-${(detailTrade.side||'long').toLowerCase()}`}>{detailTrade.side}</span>
                <span className={`badge badge-${detailTrade.status==='Win'?'win':detailTrade.status==='Loss'?'loss':'be'}`}>{detailTrade.status==='Win'?'WINNER':detailTrade.status==='Loss'?'LOSER':'BREAKEVEN'}</span>
              </div>
              <button className="btn-ghost" onClick={()=>setDetailTrade(null)}>✕</button>
            </div>
            <div className="modal-body">
              {(() => {
                const effectiveComm = tradeComm(detailTrade);
                const netPnlVal     = (detailTrade.pnl || 0) - effectiveComm;
                const commLabel     = brokeragePerLot > 0
                  ? `$${brokeragePerLot}/lot × ${detailTrade.size||0} lots`
                  : `MT5: $${(detailTrade.fees||0).toFixed(2)}`;
                return (
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10,marginBottom:18}}>
                    <div style={{background:'var(--bg-hover)',borderRadius:8,padding:'12px 14px'}}>
                      <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:600,marginBottom:4}}>GROSS P&L</div>
                      <div style={{fontSize:16,fontWeight:800,color:(detailTrade.pnl||0)>=0?'var(--blue-bright)':'var(--red)'}}>{fmt(detailTrade.pnl||0)}</div>
                    </div>
                    <div style={{background:'var(--bg-hover)',borderRadius:8,padding:'12px 14px'}}>
                      <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:600,marginBottom:4}}>COMMISSION</div>
                      <div style={{fontSize:16,fontWeight:800,color:effectiveComm>0?'var(--red)':'var(--text-muted)'}}>
                        {effectiveComm>0?`-$${effectiveComm.toFixed(2)}`:'$0'}
                      </div>
                      <div style={{fontSize:9,color:'var(--text-muted)',marginTop:2}}>{commLabel}</div>
                    </div>
                    <div style={{background:'var(--bg-card)',border:'1px solid var(--border)',borderRadius:8,padding:'12px 14px'}}>
                      <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:600,marginBottom:4}}>NET P&L</div>
                      <div style={{fontSize:16,fontWeight:800,color:netPnlVal>=0?'var(--blue-bright)':'var(--red)'}}>
                        {fmt(netPnlVal)}
                      </div>
                    </div>
                    <div style={{background:'var(--bg-hover)',borderRadius:8,padding:'12px 14px'}}>
                      <div style={{fontSize:10,color:'var(--text-muted)',fontWeight:600,marginBottom:4}}>SIZE</div>
                      <div style={{fontSize:16,fontWeight:800}}>{detailTrade.size||detailTrade.quantity||0}</div>
                    </div>
                  </div>
                );
              })()}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
                {[
                  ['Entry','$'+(detailTrade.entryPrice||0).toFixed(5)+' · '+fmtDate(detailTrade.entryDate)+' '+detailTrade.entryTime],
                  ['Exit', detailTrade.exitPrice ? `$${(detailTrade.exitPrice).toFixed(detailTrade.exitPrice>100?2:5)} · ${fmtDate(detailTrade.exitDate||detailTrade.entryDate)} ${detailTrade.exitTime||'—'}` : '—'],
                  ['Setup',detailTrade.setup||'—'],['Timeframe',detailTrade.timeframe||'—'],
                  ['Emotion',detailTrade.emotion||'—'],['Tags',(detailTrade.tags||[]).join(', ')||'—'],
                ].map(([l,v])=>(
                  <div key={l}><div style={{fontSize:10,color:'var(--text-muted)',fontWeight:600,marginBottom:2}}>{l}</div><div style={{fontSize:12}}>{v}</div></div>
                ))}
              </div>
              {detailTrade.notes&&<div style={{background:'var(--bg-hover)',borderRadius:7,padding:'10px 12px',fontSize:12,color:'var(--text-secondary)',lineHeight:1.7}}>{detailTrade.notes}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Confirm delete */}
      {confirmDel && (
        <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&setConfirmDel(null)}>
          <div className="modal" style={{maxWidth:380}}>
            <div className="modal-header"><span className="modal-title">Delete Trade?</span></div>
            <div className="modal-body"><p style={{color:'var(--text-secondary)'}}>This cannot be undone.</p></div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={()=>setConfirmDel(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={()=>{deleteTrade(confirmDel);setConfirmDel(null);}}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {showModal && <TradeModal trade={editTrade} onClose={()=>{setShowModal(false);setEditTrade(null);}}/>}
    </div>
  );
}
