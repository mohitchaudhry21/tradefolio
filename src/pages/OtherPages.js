import React, { useState, useRef, useEffect } from 'react';
import { useTrades } from '../context/TradesContext';
import { useToast } from '../context/ToastContext';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import {
  getSupabaseConfig, saveSupabaseConfig, clearSupabaseConfig,
  testSupabaseConnection, isSupabaseConfigured, SETUP_SQL,
} from '../lib/supabase';

// ── Universal cell readers ─────────────────────────────────────────────────
const cellStr = (row, i) => {
  const v = row == null ? undefined : row[i];
  if (v == null) return '';
  if (v instanceof Date) return v.toString();
  return String(v).trim();
};
const cellNum = (row, i) => {
  const v = row == null ? undefined : row[i];
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(/,/g, ''));
};

// ── MT5 timestamp parser ───────────────────────────────────────────────────
function parseMT5Time(val) {
  if (val == null || val === '') return { date: '', time: '' };
  let str = '';
  if (val instanceof Date) {
    const pad = n => String(n).padStart(2, '0');
    str = `${val.getFullYear()}.${pad(val.getMonth()+1)}.${pad(val.getDate())} ${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}`;
  } else {
    str = String(val).trim();
  }
  const parts = str.split(' ');
  return { date: (parts[0] || '').replace(/\./g, '-'), time: (parts[1] || '').slice(0, 5) };
}

function cleanSymbol(sym) {
  if (!sym) return '';
  return String(sym).replace(/[!._]R$/i, '').trim();
}

// ── MT5 Excel parser ───────────────────────────────────────────────────────
// Works with xlsx output from any option combination (raw:true or raw:false)
// Handles: string dates, Date objects, string numbers, real numbers, null cells
function parseMT5Excel(data) {
  const trades = [];
  const errors = [];
  let dataStartRow = -1;
  let dataEndRow   = data.length;

  // Find column header row (Time | Position | Symbol | Type | Volume | ...)
  // and detect end at Orders/Deals section
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || !row.length) continue;
    const c0 = cellStr(row, 0).toLowerCase();
    const c1 = cellStr(row, 1).toLowerCase();

    // Stop at Orders or Deals section
    if ((c0 === 'orders' || c0 === 'deals') && !c1 && dataStartRow >= 0) {
      dataEndRow = i; break;
    }

    // Column header row: Time/Open Time | Position | Symbol | Type
    if (
      (c0 === 'time' || c0 === 'open time') &&
      c1 === 'position' &&
      cellStr(row, 2).toLowerCase() === 'symbol'
    ) {
      dataStartRow = i + 1;
    }
  }

  if (dataStartRow === -1) {
    throw new Error(
      'No Positions section found. ' +
      'File has ' + data.length + ' rows. ' +
      'Expected column headers: Time | Position | Symbol | Type | Volume | Price | S/L | T/P | Time | Price | Commission | Swap | Profit'
    );
  }

  for (let i = dataStartRow; i < dataEndRow; i++) {
    const row = data[i];
    if (!row || !row.length) continue;

    const posId   = cellNum(row, 1);
    const vol     = cellStr(row, 4);
    const profit  = cellNum(row, 12);
    const timeVal = row[0];

    const hasTime    = timeVal instanceof Date || /^\d{4}[.\/\-]/.test(cellStr(row, 0));
    const hasPos     = !isNaN(posId) && posId > 0;
    const hasProfit  = !isNaN(profit);
    const isOrderRow = vol.includes("/");
    const symbol     = cleanSymbol(row[2]);
    const hasSymbol  = symbol && symbol.length > 0;  // withdrawals/deposits have no symbol

    if (!hasTime || !hasPos || !hasProfit || isOrderRow || !hasSymbol) continue;

    try {
      const eT   = parseMT5Time(timeVal);
      const xT   = parseMT5Time(row[8]);
      const comm = cellNum(row, 10) || 0;
      const swap = cellNum(row, 11) || 0;
      // Match sync server formula exactly:
      // pnl  = profit + swap  (GROSS — commission NOT deducted)
      // fees = abs(commission) (stored separately)
      const pnl  = parseFloat((profit + swap).toFixed(2));
      const fees = parseFloat(Math.abs(comm).toFixed(2));
      const sl   = cellNum(row, 6);
      const tp   = cellNum(row, 7);

      trades.push({
        id:         uuidv4(),
        symbol:     symbol,
        side:       cellStr(row, 3).toLowerCase() === 'buy' ? 'Long' : 'Short',
        status:     pnl > 0.01 ? 'Win' : pnl < -0.01 ? 'Loss' : 'Breakeven',
        entryDate:  eT.date, entryTime:  eT.time,
        exitDate:   xT.date, exitTime:   xT.time,
        entryPrice: cellNum(row, 5) || 0,
        exitPrice:  cellNum(row, 9) || 0,
        stopLoss:   !isNaN(sl) && sl > 0 ? sl : null,
        takeProfit: !isNaN(tp) && tp > 0 ? tp : null,
        size:       parseFloat(vol) || 0,
        fees, pnl, rMultiple: 0,
        setup: '', timeframe: '', emotion: '',
        tags: [], notes: '', mistakes: [],
        source: 'MT5 Import',
        positionId: String(Math.round(posId)),
      });
    } catch (err) {
      errors.push('Row ' + (i+1) + ': ' + err.message);
    }
  }
  return { trades, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV parser
// ─────────────────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have a header row + at least one data row');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i]?.trim() || ''; });
    return {
      ...obj, id: uuidv4(),
      entryPrice: parseFloat(obj.entryPrice) || 0,
      exitPrice:  parseFloat(obj.exitPrice)  || 0,
      size:       parseFloat(obj.size) || parseFloat(obj.quantity) || 0,
      fees:       parseFloat(obj.fees) || 0,
      pnl:        parseFloat(obj.pnl)  || 0,
      rMultiple:  parseFloat(obj.rMultiple) || 0,
      tags:       obj.tags ? obj.tags.split(';').map(t => t.trim()).filter(Boolean) : [],
      mistakes:   [],
    };
  });
}


export function ImportPage() {
  const { importTrades, trades, accounts, activeAccountId } = useTrades();
  const { showToast } = useToast();
  const [tab,       setTab]       = useState('mt5');
  const [preview,   setPreview]   = useState(null);
  const [error,     setError]     = useState('');
  const [warnings,  setWarnings]  = useState([]);
  const [success,   setSuccess]   = useState('');
  const [loading,   setLoading]   = useState(false);
  const [csvText,   setCsvText]   = useState('');
  // Pre-populate from sidebar's active account
  const [importAccountId, setImportAccountId] = useState(activeAccountId || '');
  const fileInputRef = useRef();

  // Keep importAccountId in sync when sidebar account changes
  useEffect(() => {
    setImportAccountId(activeAccountId || '');
  }, [activeAccountId]);

  const reset = () => { setPreview(null); setError(''); setWarnings([]); setSuccess(''); };

  // ── Handle MT5 Excel file ──────────────────────────────────────────────
  const handleExcelFile = async (file) => {
    reset(); setLoading(true);
    try {
      const buffer = await file.arrayBuffer();
      const wb   = XLSX.read(buffer, { type: 'array', cellDates: false });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      const { trades: parsed, errors } = parseMT5Excel(data);
      if (parsed.length === 0) {
        setError('No trades found. The file was read but no valid position rows detected.');
        return;
      }
      setPreview(parsed);
      if (errors.length > 0) setWarnings(errors.slice(0, 5));
    } catch (err) {
      setError('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Handle CSV ──────────────────────────────────────────────────────────
  const handleCSV = () => {
    reset();
    try {
      const parsed = parseCSV(csvText);
      setPreview(parsed);
    } catch (err) {
      setError(err.message);
    }
  };

  // ── Import confirmed ────────────────────────────────────────────────────
  const handleImport = () => {
    if (!preview?.length) return;
    const chosenAccountId = importAccountId || null;
    const chosenAccount = accounts.find(a => a.id === chosenAccountId);
    importTrades(preview, null, chosenAccountId);
    const accLabel = chosenAccount ? `→ ${chosenAccount.name}` : '(no account assigned)';
    showToast({ title: `${preview.length} trades imported`, message: `Updated & added · ${accLabel}` });
    setPreview(null);
    setCsvText('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Export all trades ───────────────────────────────────────────────────
  const exportAll = () => {
    if (!trades.length) return;
    const headers = ['symbol','side','status','entryDate','entryTime','exitDate','exitTime','entryPrice','exitPrice','size','fees','pnl','rMultiple','setup','timeframe','notes','emotion'];
    const rows = trades.map(t => headers.map(k => { const v = t[k]; return Array.isArray(v) ? v.join(';') : (v ?? ''); }).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tradefolio_export_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const totalPnl = preview?.reduce((s, t) => s + (t.pnl || 0), 0) || 0;
  const wins     = preview?.filter(t => t.status === 'Win').length || 0;

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Import / Export</div><div className="page-sub">Import trades from MT5 Excel report or CSV</div></div>
        <button className="btn btn-secondary" onClick={exportAll}>⬇ Export All Trades</button>
      </div>

      <div className="page-body" style={{ maxWidth: 760 }}>

        {/* ── Account selector — always visible at top ──────────────────── */}
        {accounts.length > 0 && (
          <div className="card" style={{ marginBottom:14, padding:'14px 18px', background:'rgba(59,130,246,.06)', border:`2px solid ${importAccountId ? 'rgba(59,130,246,.4)' : 'rgba(239,68,68,.3)'}` }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
              <span style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', flexShrink:0 }}>🏦 Import trades into:</span>
              <select className="form-control" style={{ flex:1, maxWidth:300 }}
                value={importAccountId} onChange={e=>setImportAccountId(e.target.value)}>
                <option value="">— Select account first —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}{a.accountNumber ? ` #${a.accountNumber}` : ''}</option>
                ))}
              </select>
              {importAccountId
                ? <span style={{ fontSize:12, color:'var(--blue-bright)', fontWeight:600 }}>
                    ✓ Trades will be tagged to {accounts.find(a=>a.id===importAccountId)?.name}
                  </span>
                : <span style={{ fontSize:12, color:'var(--red)', fontWeight:600 }}>
                    ⚠ Select an account — otherwise trades won't appear under any account filter
                  </span>
              }
            </div>
          </div>
        )}

        <div className="tabs">
          <button className={`tab-btn${tab==='mt5'?' active':''}`} onClick={()=>{setTab('mt5');reset();}}>📊 MT5 Excel Report</button>
          <button className={`tab-btn${tab==='csv'?' active':''}`} onClick={()=>{setTab('csv');reset();}}>📄 CSV Import</button>
        </div>

        {/* ── MT5 Excel Tab ─────────────────────────────────────────────── */}
        {tab === 'mt5' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {/* How to export from MT5 */}
            <div className="card" style={{ background:'rgba(59,130,246,.05)', border:'1px solid rgba(59,130,246,.2)' }}>
              <div className="card-title">📋 How to export from MT5</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                <div>
                  {[
                    'Open MetaTrader 5',
                    'Click View → Terminal (or press Ctrl+T)',
                    'Click the History tab at the bottom',
                    'Right-click anywhere in the history list',
                    'Click "Save as Report"',
                    'Choose Excel (.xlsx) format',
                    'Save the file and upload it below',
                  ].map((s,i)=>(
                    <div key={i} style={{ display:'flex', gap:8, marginBottom:6, fontSize:12 }}>
                      <span style={{ width:18,height:18,background:'var(--blue)',borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:700,color:'#fff',flexShrink:0 }}>{i+1}</span>
                      <span style={{ color:'var(--text-secondary)' }}>{s}</span>
                    </div>
                  ))}
                </div>
                <div style={{ background:'var(--bg-hover)', borderRadius:8, padding:'14px', fontSize:12 }}>
                  <div style={{ fontWeight:700, marginBottom:8, fontSize:13 }}>Expected file format:</div>
                  <div style={{ color:'var(--text-muted)', fontFamily:'monospace', fontSize:11, lineHeight:1.8 }}>
                    Trade History Report<br/>
                    Name: &nbsp;&nbsp;&nbsp;[Your Name]<br/>
                    Account: [Account No]<br/>
                    ...<br/>
                    <span style={{ color:'var(--blue-bright)' }}>Time | Position | Symbol | Type | Volume | Price | ... | Profit</span><br/>
                    2026.02.02 13:27 | 4691854 | XAUUSD | sell | ...
                  </div>
                </div>
              </div>
            </div>

            {/* Upload box */}
            <div className="card">
              <div className="card-title">Upload MT5 Excel File (.xlsx)</div>
              <label style={{
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                border:'2px dashed var(--border-light)', borderRadius:10, padding:'36px 20px',
                cursor:'pointer', background:'var(--bg-hover)', transition:'all .15s',
              }}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='var(--blue)';}}
                onDragLeave={e=>{e.currentTarget.style.borderColor='var(--border-light)';}}
                onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='var(--border-light)';const f=e.dataTransfer.files[0];if(f)handleExcelFile(f);}}
              >
                <div style={{ fontSize:36, marginBottom:10 }}>📊</div>
                <div style={{ fontWeight:700, marginBottom:4 }}>Drop your MT5 Excel file here</div>
                <div style={{ color:'var(--text-muted)', fontSize:12, marginBottom:14 }}>or click to browse — .xlsx files only</div>
                <span className="btn btn-primary">Choose File</span>
                <input
                  ref={fileInputRef}
                  type="file" accept=".xlsx,.xls" style={{ display:'none' }}
                  onChange={e=>{ const f=e.target.files[0]; if(f) handleExcelFile(f); }}
                />
              </label>

              {loading && (
                <div style={{ textAlign:'center', padding:'16px', color:'var(--text-secondary)', fontSize:13 }}>
                  ⏳ Reading file and parsing trades...
                </div>
              )}

              {error && (
                <div style={{ marginTop:12, padding:'12px 14px', background:'var(--red-dim)', border:'1px solid rgba(239,68,68,.2)', borderRadius:8, fontSize:13, color:'var(--red)' }}>
                  ❌ {error}
                </div>
              )}

              {warnings.length > 0 && (
                <div style={{ marginTop:10, padding:'10px 12px', background:'var(--yellow-dim)', borderRadius:7, fontSize:12, color:'var(--yellow)' }}>
                  ⚠️ {warnings.length} rows had issues and were skipped: {warnings[0]}
                </div>
              )}

              {success && (
                <div style={{ marginTop:12, padding:'12px 14px', background:'var(--blue-dim)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, fontSize:13, color:'var(--blue-bright)' }}>
                  {success}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── CSV Tab ───────────────────────────────────────────────────── */}
        {tab === 'csv' && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div className="card">
              <div className="card-title">Paste CSV Data</div>
              <textarea className="form-control" rows={8}
                placeholder={`symbol,side,status,entryDate,entryTime,exitDate,exitTime,entryPrice,exitPrice,size,fees,pnl,rMultiple,setup,timeframe,notes,tags,emotion\nXAUUSD,Short,Win,2026-04-17,13:36,2026-04-17,13:43,4786.99,4782.79,3,0,1229.70,2.1,Breakout,5m,,london,Confident`}
                value={csvText} onChange={e=>setCsvText(e.target.value)}
                style={{ fontFamily:'monospace', fontSize:12 }}
              />
              <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
                <label className="btn btn-secondary" style={{ cursor:'pointer' }}>
                  📁 Upload CSV File
                  <input type="file" accept=".csv,.txt" style={{ display:'none' }}
                    onChange={e=>{ const r=new FileReader(); r.onload=ev=>setCsvText(ev.target.result); r.readAsText(e.target.files[0]); }}
                  />
                </label>
                <button className="btn btn-secondary" onClick={handleCSV} disabled={!csvText.trim()}>Preview</button>
              </div>
              {error && <div style={{ marginTop:10, padding:'9px 12px', background:'var(--red-dim)', borderRadius:7, color:'var(--red)', fontSize:13 }}>❌ {error}</div>}
            </div>
          </div>
        )}

        {/* ── Preview ───────────────────────────────────────────────────── */}
        {preview && preview.length > 0 && (
          <div className="card" style={{ marginTop:14, padding:0 }}>
            {/* Account confirmation reminder */}
            <div style={{ padding:'8px 18px', borderBottom:'1px solid var(--border)', background: importAccountId ? 'rgba(59,130,246,.06)' : 'rgba(239,68,68,.06)', display:'flex', alignItems:'center', gap:8 }}>
              {importAccountId
                ? <span style={{ fontSize:12, color:'var(--blue-bright)', fontWeight:600 }}>🏦 Importing into: {accounts.find(a=>a.id===importAccountId)?.name}</span>
                : <span style={{ fontSize:12, color:'var(--red)', fontWeight:600 }}>⚠ No account selected — scroll up and select an account before importing</span>
              }
            </div>

            {/* Preview header */}
            <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
              <div>
                <span style={{ fontWeight:700, fontSize:14 }}>Preview — {preview.length} trades</span>
                <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:10 }}>
                  {wins}W / {preview.length - wins}L
                </span>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span className={totalPnl>=0?'pos':'neg'} style={{ fontWeight:700, fontSize:13 }}>
                  Net: {totalPnl>=0?'+':''}{totalPnl.toFixed(2)}
                </span>
                <button className="btn btn-primary" onClick={handleImport}>
                  ✓ Import All {preview.length} Trades
                </button>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th><th>Side</th><th>Status</th>
                    <th>Entry Date</th><th>Entry</th><th>Exit</th>
                    <th>Size</th><th>Commission</th><th>P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 20).map((t,i) => (
                    <tr key={i}>
                      <td style={{ fontWeight:700 }}>{t.symbol}</td>
                      <td><span className={`badge badge-${t.side.toLowerCase()}`}>{t.side}</span></td>
                      <td><span className={`badge badge-${t.status==='Win'?'win':t.status==='Loss'?'loss':'be'}`}>{t.status}</span></td>
                      <td style={{ color:'var(--text-secondary)', fontSize:12 }}>{t.entryDate}<br/><span style={{ color:'var(--text-muted)' }}>{t.entryTime}</span></td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{t.entryPrice}</td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{t.exitPrice}</td>
                      <td style={{ color:'var(--text-secondary)' }}>{t.size}</td>
                      <td style={{ color:'var(--red)', fontSize:12 }}>{t.fees > 0 ? `-$${t.fees}` : '—'}</td>
                      <td style={{ fontWeight:700, color:t.pnl>=0?'var(--blue-bright)':'var(--red)' }}>
                        {t.pnl>=0?'+':''}{t.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.length > 20 && (
              <div style={{ padding:'10px 18px', color:'var(--text-muted)', fontSize:12, borderTop:'1px solid var(--border)' }}>
                ... and {preview.length - 20} more trades
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBOOKS PAGE
// ─────────────────────────────────────────────────────────────────────────────
export function PlaybooksPage() {
  const { playbooks, addPlaybook, updatePlaybook, deletePlaybook, trades } = useTrades();
  const [showModal, setShowModal] = useState(false);
  const [editPb,    setEditPb]    = useState(null);
  const [form,      setForm]      = useState({ name:'', description:'', rules:[''] });

  const getStats = name => {
    const t=trades.filter(x=>x.playbook===name);
    const w=t.filter(x=>x.status==='Win').length;
    return { total:t.length, wr:t.length?(w/t.length*100).toFixed(0):'0', pnl:t.reduce((s,x)=>s+(x.pnl||0),0) };
  };

  const open = (pb=null) => {
    setEditPb(pb);
    setForm(pb ? { name:pb.name, description:pb.description||'', rules:[...(pb.rules||[''])] } : { name:'', description:'', rules:[''] });
    setShowModal(true);
  };

  const submit = e => {
    e.preventDefault();
    const p = { ...form, rules: form.rules.filter(r=>r.trim()) };
    if (editPb) updatePlaybook(editPb.id, p); else addPlaybook(p);
    setShowModal(false);
  };

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Playbooks</div><div className="page-sub">Define and track your trading strategies</div></div>
        <button className="btn btn-primary" onClick={()=>open()}>+ New Playbook</button>
      </div>
      <div className="page-body">
        {!playbooks.length && <div className="empty-state"><div className="empty-icon">📚</div><div className="empty-text">No playbooks yet. Create your first strategy!</div></div>}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:14 }}>
          {playbooks.map(pb => {
            const s = getStats(pb.name);
            return (
              <div key={pb.id} className="card">
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontWeight:700, fontSize:14 }}>{pb.name}</span>
                  <div style={{ display:'flex', gap:5 }}>
                    <button className="btn-icon" style={{ fontSize:11 }} onClick={()=>open(pb)}>✏️</button>
                    <button className="btn-icon" style={{ fontSize:11 }} onClick={()=>deletePlaybook(pb.id)}>🗑</button>
                  </div>
                </div>
                {pb.description && <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:12, lineHeight:1.6 }}>{pb.description}</p>}
                {pb.rules?.length>0 && (
                  <div style={{ marginBottom:12 }}>
                    {pb.rules.map((r,i)=>(
                      <div key={i} style={{ display:'flex', gap:7, marginBottom:5, fontSize:12 }}>
                        <span style={{ color:'var(--blue)', fontSize:11 }}>✓</span>
                        <span style={{ color:'var(--text-secondary)' }}>{r}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ height:1, background:'var(--border)', margin:'10px 0' }}/>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
                  {[['TRADES',s.total,'neu'],['WIN%',`${s.wr}%`,parseInt(s.wr)>=50?'pos':'neg'],['P&L',`${s.pnl>=0?'+':''}$${s.pnl.toFixed(0)}`,s.pnl>=0?'pos':'neg']].map(([l,v,c])=>(
                    <div key={l} style={{ textAlign:'center' }}>
                      <div style={{ fontSize:9, color:'var(--text-muted)', fontWeight:600, marginBottom:2 }}>{l}</div>
                      <div className={c} style={{ fontWeight:700, fontSize:13 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showModal && (
        <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal" style={{ maxWidth:480 }}>
            <div className="modal-header"><span className="modal-title">{editPb?'Edit':'New'} Playbook</span><button className="btn-ghost" onClick={()=>setShowModal(false)}>✕</button></div>
            <form onSubmit={submit}>
              <div className="modal-body">
                <div className="form-group"><label className="form-label">Name *</label><input className="form-control" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/></div>
                <div className="form-group"><label className="form-label">Description</label><textarea className="form-control" rows={2} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></div>
                <div className="form-group">
                  <label className="form-label">Rules</label>
                  {form.rules.map((r,i)=>(
                    <div key={i} style={{ display:'flex', gap:6, marginBottom:6 }}>
                      <input className="form-control" value={r} onChange={e=>{const rs=[...form.rules];rs[i]=e.target.value;setForm(f=>({...f,rules:rs}));}}/>
                      {form.rules.length>1 && <button type="button" className="btn-ghost" onClick={()=>setForm(f=>({...f,rules:f.rules.filter((_,j)=>j!==i)}))}>✕</button>}
                    </div>
                  ))}
                  <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setForm(f=>({...f,rules:[...f.rules,'']}))}>+ Rule</button>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editPb?'Save':'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PAGE
// ─────────────────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { settings, setSettings, trades, stats, accounts, addAccount, updateAccount, deleteAccount, deleteTrade, refreshSupabaseClient } = useTrades();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    customSetups: [], customMistakes: [], customChecklist: [],
    removedSetups: [], removedMistakes: [], removedChecklist: [],
    traderName: 'Trader',
    ...settings,
  });
  const [newAcc, setNewAcc]     = useState({ name:'', accountNumber:'', source:'', color:'#3b82f6', brokeragePerLot:'' });
  const [editingAccId, setEditingAccId] = useState(null);
  const [dedupResult, setDedupResult] = useState(null);
  const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316'];
  const [saved, setSaved] = useState(false);

  // Supabase state
  const cfg = getSupabaseConfig();
  const [sbUrl,  setSbUrl]    = useState(cfg.url);
  const [sbKey,  setSbKey]    = useState(cfg.key);
  const [sbTesting, setSbTesting] = useState(false);
  const [sbStatus,  setSbStatus]  = useState(isSupabaseConfigured() ? 'connected' : '');
  const [showSbKey, setShowSbKey] = useState(false);
  const [showSql,   setShowSql]   = useState(false);
  const s  = (k,v) => { setForm(f=>({...f,[k]:v})); setSaved(false); };
  const save = e => { e.preventDefault(); setSettings(form); setSaved(true); setTimeout(()=>setSaved(false),2000); showToast({ title: 'Settings saved', message: 'All preferences updated' }); };

  // Per-account field updater (updates the accounts array directly)
  const setAccField = (id, k, v) => updateAccount(id, { [k]: v });

  // Journal customization: built-in options
  const BUILTIN_SETUPS    = ['5 Min A+','5 Min TJL1','5 Min TJL2','5 Min LVL 3','5 Min LVL 4','15 Min A+','15 Min TJL1','15 Min TJL2','15 Min LVL 3','15 Min LVL 4','1H A+','1H TJL1','1H TJL2','1H LVL 3','1H LVL 4','4H A+','4H TJL1','4H TJL2','1D A+','1D TJL1','1D TJL2'];
  const BUILTIN_MISTAKES  = ['Early Entry','Late Entry','Early Exit','Late Exit','Oversized','Ignored Stop','Ignored trend','Chasing','Revenge Trade','No plan'];
  const BUILTIN_CHECKLIST = ['Confirmed entry','Checked higher timeframe','Risk within limits','Fits my trading plan','Key levels identified','Economic calendar checked'];


  // Reusable full-list editor — shows all items (built-in + custom) with delete
  const FullListEditor = ({ builtins, customKey, removedKey, placeholder }) => {
    const removed  = form[removedKey]  || [];
    const custom   = form[customKey]   || [];
    const allItems = [
      ...builtins.filter(x => !removed.includes(x)).map(x => ({ label:x, isBuiltin:true })),
      ...custom.map(x => ({ label:x, isBuiltin:false })),
    ];
    // Auto-save list changes to settings immediately (no need to click Save Settings)
    const applyAndSave = (key, val) => {
      const updated = { ...form, [key]: val };
      setForm(updated);
      setSettings(updated);
      setSaved(false);
    };
    const removeItem = (item) => {
      if (item.isBuiltin) applyAndSave(removedKey, [...removed, item.label]);
      else applyAndSave(customKey, custom.filter(x => x !== item.label));
    };
    const restoreAll = () => applyAndSave(removedKey, []);
    const addItem = (val) => {
      if (!val || custom.includes(val) || builtins.includes(val)) return false;
      applyAndSave(customKey, [...custom, val]);
      return true;
    };
    return (
      <div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
          {allItems.map((item, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', gap:4,
              background: item.isBuiltin ? 'var(--bg-hover)' : 'rgba(59,130,246,.1)',
              border: `1px solid ${item.isBuiltin ? 'var(--border)' : 'rgba(59,130,246,.25)'}`,
              borderRadius:6, padding:'4px 8px 4px 10px', fontSize:12 }}>
              {!item.isBuiltin && <span style={{ fontSize:9, color:'var(--blue)', fontWeight:700, marginRight:2 }}>+</span>}
              <span>{item.label}</span>
              <button type="button" onClick={() => removeItem(item)}
                style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:13, padding:0, lineHeight:1, marginLeft:3 }}>✕</button>
            </div>
          ))}
          {allItems.length === 0 && (
            <span style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>All items removed</span>
          )}
        </div>
        {removed.length > 0 && (
          <button type="button" onClick={restoreAll} style={{ fontSize:11, color:'var(--blue)', background:'none', border:'none', cursor:'pointer', marginBottom:8, padding:0 }}>
            ↩ Restore {removed.length} removed item{removed.length>1?'s':''}
          </button>
        )}
        <div style={{ display:'flex', gap:8 }}>
          <input className="form-control" placeholder={placeholder} style={{ flex:1 }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (addItem(e.target.value.trim())) e.target.value = '';
              }
            }}/>
          <button type="button" className="btn btn-secondary btn-sm"
            onClick={e => {
              const inp = e.currentTarget.previousSibling;
              if (addItem(inp.value.trim())) inp.value = '';
            }}>Add</button>
        </div>
        <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:5 }}>
          White = built-in · <span style={{ color:'var(--blue)' }}>Blue +</span> = custom added by you · ✕ removes any item
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="page-header"><div><div className="page-title">Settings</div><div className="page-sub">Configure your trading journal</div></div></div>
      <div className="page-body" style={{ maxWidth:600 }}>
        <form onSubmit={save}>

          {/* ── General ───────────────────────────────────────────────────── */}
          <div className="card" style={{ marginBottom:16 }}>
            <div className="card-title">General</div>
            <div className="form-group"><label className="form-label">Trader Name</label><input className="form-control" placeholder="Your name" value={form.traderName||''} onChange={e=>s('traderName',e.target.value)}/></div>
            <div className="form-row cols-2">
              <div className="form-group"><label className="form-label">Currency</label><select className="form-control" value={form.currency} onChange={e=>s('currency',e.target.value)}><option>USD</option><option>EUR</option><option>GBP</option><option>INR</option><option>AUD</option><option>CAD</option></select></div>
              <div className="form-group"><label className="form-label">Default Risk % per trade</label><input className="form-control" type="number" step="0.1" value={form.riskPerTrade} onChange={e=>s('riskPerTrade',parseFloat(e.target.value))}/></div>
            </div>
            <div className="form-group" style={{ marginBottom:0 }}><label className="form-label">Timezone</label><select className="form-control" value={form.timezone} onChange={e=>s('timezone',e.target.value)}><option>UTC</option><option>US/Eastern</option><option>US/Pacific</option><option>Europe/London</option><option>Asia/Kolkata</option><option>Asia/Tokyo</option></select></div>
          </div>

          {/* ── Cloud Sync (Supabase) ─────────────────────────────────────── */}
          <div className="card" style={{ marginBottom:16, border: sbStatus === 'connected' ? '1px solid rgba(74,222,128,.3)' : '1px solid var(--border)' }}>
            <div className="card-title" style={{ display:'flex', alignItems:'center', gap:8 }}>
              ☁ Cloud Sync
              {sbStatus === 'connected' && <span style={{ fontSize:11, fontWeight:600, color:'#4ade80', background:'rgba(74,222,128,.1)', borderRadius:4, padding:'1px 8px' }}>Connected</span>}
              {sbStatus === 'error'     && <span style={{ fontSize:11, fontWeight:600, color:'var(--red)',   background:'var(--red-dim)',           borderRadius:4, padding:'1px 8px' }}>Error</span>}
            </div>
            <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14, lineHeight:1.7 }}>
              Connect your own free <strong>Supabase</strong> project to sync data across all your devices (phone, tablet, computer). Each person uses their own Supabase — your data stays completely private.
            </p>

            {sbStatus !== 'connected' && (
              <div style={{ background:'rgba(59,130,246,.07)', border:'1px solid rgba(59,130,246,.2)', borderRadius:8, padding:'12px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--blue-bright)', marginBottom:8 }}>🚀 Setup — takes 5 minutes, completely free</div>
                <ol style={{ fontSize:12, color:'var(--text-secondary)', margin:0, paddingLeft:18, lineHeight:2 }}>
                  <li>Go to <strong>supabase.com</strong> → Create a free account → New Project</li>
                  <li>In your project: go to <strong>SQL Editor → New query</strong> and run:</li>
                </ol>
                <div style={{ position:'relative', marginTop:8, marginBottom:8 }}>
                  <pre style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:6, padding:'10px 12px', fontSize:11, fontFamily:'monospace', color:'var(--text-secondary)', margin:0, overflowX:'auto' }}>{SETUP_SQL}</pre>
                  <button type="button" onClick={() => { navigator.clipboard.writeText(SETUP_SQL); showToast({ title: 'Copied!', message: 'Paste into Supabase SQL Editor' }); }}
                    style={{ position:'absolute', top:6, right:6, fontSize:10, padding:'2px 8px', borderRadius:4, background:'var(--bg-hover)', border:'1px solid var(--border)', cursor:'pointer', color:'var(--text-secondary)' }}>Copy</button>
                </div>
                <ol start={3} style={{ fontSize:12, color:'var(--text-secondary)', margin:0, paddingLeft:18, lineHeight:2 }}>
                  <li>Go to <strong>Project Settings → API</strong> and copy your <strong>Project URL</strong> and <strong>anon/public</strong> key</li>
                  <li>Paste them below and click Connect</li>
                </ol>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Supabase Project URL</label>
              <input className="form-control" placeholder="https://xxxxxxxxxxxx.supabase.co" value={sbUrl} onChange={e=>setSbUrl(e.target.value)}/>
            </div>
            <div className="form-group" style={{ marginBottom:12 }}>
              <label className="form-label">Supabase Anon Key</label>
              <div style={{ position:'relative' }}>
                <input className="form-control" type={showSbKey?'text':'password'} placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." value={sbKey} onChange={e=>setSbKey(e.target.value)} style={{ paddingRight:60 }}/>
                <button type="button" onClick={()=>setShowSbKey(p=>!p)} style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', fontSize:12 }}>{showSbKey?'Hide':'Show'}</button>
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button type="button" className="btn btn-primary btn-sm" disabled={sbTesting || !sbUrl || !sbKey}
                onClick={async () => {
                  setSbTesting(true); setSbStatus('');
                  const result = await testSupabaseConnection(sbUrl, sbKey);
                  setSbTesting(false);
                  if (result.ok) {
                    saveSupabaseConfig(sbUrl, sbKey);
                    setSbStatus('connected');
                    refreshSupabaseClient();
                    showToast({ title: '☁ Cloud sync enabled', message: 'Your data will now sync across devices' });
                  } else {
                    setSbStatus('error');
                    showToast({ title: 'Connection failed', message: result.message || 'Check your URL and key', type: 'error' });
                  }
                }}>
                {sbTesting ? '⏳ Testing...' : sbStatus === 'connected' ? '↻ Reconnect' : 'Connect'}
              </button>
              {sbStatus === 'connected' && (
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (!window.confirm('Disconnect cloud sync? Your data stays in the browser but won\'t sync to other devices.')) return;
                    clearSupabaseConfig(); setSbUrl(''); setSbKey(''); setSbStatus('');
                    refreshSupabaseClient();
                    showToast({ title: 'Cloud sync disconnected' });
                  }}>Disconnect</button>
              )}
            </div>
            {sbStatus === 'connected' && (
              <div style={{ marginTop:10, fontSize:12, color:'var(--text-muted)', lineHeight:1.6 }}>
                ✓ Data syncs automatically on every change. To use on another device, open the app URL and enter the same Supabase URL and key in Settings.
              </div>
            )}
          </div>

          {/* ── Account Sizes + Date Ranges ───────────────────────────────── */}
          <div className="card" style={{ marginBottom:16 }}>
            <div className="card-title">📊 Account Size &amp; Date Range</div>
            <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14, lineHeight:1.7 }}>
              Set a starting balance and stats date range for each account separately, or use the global defaults.
            </p>

            {/* Global defaults */}
            <div style={{ background:'var(--bg-hover)', borderRadius:8, padding:'14px 16px', marginBottom:12, border:'1px solid var(--border)' }}>
              <div style={{ fontWeight:700, fontSize:13, marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ fontSize:11 }}>⬡</span> Global Defaults
                <span style={{ fontSize:11, color:'var(--text-muted)', fontWeight:400 }}>(used when "All Accounts" is selected)</span>
              </div>
              <div className="form-row cols-2" style={{ marginBottom:10 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Starting Account Size ($)</label>
                  <input className="form-control" type="number" value={form.accountSize} onChange={e=>s('accountSize',parseFloat(e.target.value))}/>
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Brokerage per Lot ($)</label>
                  <input className="form-control" type="number" step="0.01" min="0" placeholder="e.g. 7.00" value={form.brokeragePerLot||''} onChange={e=>s('brokeragePerLot',parseFloat(e.target.value)||0)}/>
                </div>
              </div>
              <div className="form-row cols-2" style={{ marginBottom:0 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Stats Start Date</label>
                  <input className="form-control" type="date" value={form.statsStartDate||''} onChange={e=>s('statsStartDate',e.target.value)}/>
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Stats End Date</label>
                  <input className="form-control" type="date" value={form.statsEndDate||''} onChange={e=>s('statsEndDate',e.target.value)}/>
                </div>
              </div>
              {(form.statsStartDate||form.statsEndDate) && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.2)', borderRadius:6, padding:'6px 10px', marginTop:10 }}>
                  <span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                    📊 {form.statsStartDate||'all time'} → {form.statsEndDate||'today'}
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{s('statsStartDate','');s('statsEndDate','');}}>✕ Clear</button>
                </div>
              )}
            </div>

            {/* Per-account overrides */}
            {accounts.map(acc => (
              <div key={acc.id} style={{ background:'var(--bg-hover)', borderRadius:8, padding:'14px 16px', marginBottom:10, border:`1px solid ${acc.color}30` }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: editingAccId===acc.id ? 14 : 0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ width:10, height:10, borderRadius:'50%', background:acc.color, display:'inline-block' }}/>
                    <span style={{ fontWeight:700, fontSize:13 }}>{acc.name}</span>
                    {acc.accountNumber && <span style={{ fontSize:11, color:'var(--text-muted)' }}>#{acc.accountNumber}</span>}
                    {(acc.accountSize || acc.statsStartDate || acc.statsEndDate || acc.brokeragePerLot != null) && (
                      <span style={{ fontSize:10, background:`${acc.color}20`, color:acc.color, borderRadius:4, padding:'1px 6px', fontWeight:600 }}>Custom</span>
                    )}
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => setEditingAccId(editingAccId===acc.id ? null : acc.id)}>
                    {editingAccId===acc.id ? '▲ Close' : '✎ Edit'}
                  </button>
                </div>
                {editingAccId === acc.id && (
                  <div>
                    <div className="form-row cols-2" style={{ marginBottom:10 }}>
                      <div className="form-group" style={{ marginBottom:0 }}>
                        <label className="form-label">Account Size ($) <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(override global)</span></label>
                        <input className="form-control" type="number" placeholder={`Global: $${form.accountSize||10000}`}
                          value={acc.accountSize||''} onChange={e=>setAccField(acc.id,'accountSize',parseFloat(e.target.value)||null)}/>
                      </div>
                      <div className="form-group" style={{ marginBottom:0 }}>
                        <label className="form-label">Brokerage per Lot ($) <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(override global)</span></label>
                        <input className="form-control" type="number" step="0.01" min="0"
                          placeholder={`Global: $${form.brokeragePerLot||0}`}
                          value={acc.brokeragePerLot != null ? acc.brokeragePerLot : ''}
                          onChange={e => setAccField(acc.id, 'brokeragePerLot', e.target.value === '' ? null : parseFloat(e.target.value) || 0)}/>
                      </div>
                    </div>
                    <div className="form-row cols-2" style={{ marginBottom:10 }}>
                      <div className="form-group" style={{ marginBottom:0 }}>
                        <label className="form-label">Stats Start Date <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(this account)</span></label>
                        <input className="form-control" type="date" value={acc.statsStartDate||''} onChange={e=>setAccField(acc.id,'statsStartDate',e.target.value)}/>
                      </div>
                      <div className="form-group" style={{ marginBottom:0 }}>
                        <label className="form-label">Stats End Date</label>
                        <input className="form-control" type="date" value={acc.statsEndDate||''} onChange={e=>setAccField(acc.id,'statsEndDate',e.target.value)}/>
                      </div>
                    </div>
                    {(acc.statsStartDate||acc.statsEndDate) && (
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', background:`${acc.color}15`, border:`1px solid ${acc.color}30`, borderRadius:6, padding:'6px 10px', marginBottom:10 }}>
                        <span style={{ fontSize:11, color:'var(--text-secondary)' }}>
                          📊 {acc.statsStartDate||'all time'} → {acc.statsEndDate||'today'}
                        </span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setAccField(acc.id,'statsStartDate','');setAccField(acc.id,'statsEndDate','');}}>✕ Clear</button>
                      </div>
                    )}
                    <div style={{ display:'flex', gap:8 }}>
                      <button type="button" className="btn btn-danger btn-sm"
                        onClick={() => { if (window.confirm(`Remove "${acc.name}"?`)) { deleteAccount(acc.id); setEditingAccId(null); } }}>
                        🗑 Remove Account
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Add new account inline */}
            <div style={{ background:'var(--bg-card)', border:'1px dashed var(--border)', borderRadius:8, padding:'14px 16px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text-secondary)', marginBottom:12 }}>＋ Add New Account</div>
              <div className="form-row cols-2" style={{ marginBottom:10 }}>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Account Name *</label>
                  <input className="form-control" placeholder="e.g. FortressFX Live" value={newAcc.name} onChange={e=>setNewAcc(p=>({...p,name:e.target.value}))}/>
                </div>
                <div className="form-group" style={{ marginBottom:0 }}>
                  <label className="form-label">Account Number</label>
                  <input className="form-control" placeholder="e.g. 70118102" value={newAcc.accountNumber} onChange={e=>setNewAcc(p=>({...p,accountNumber:e.target.value}))}/>
                </div>
              </div>
              <div className="form-group" style={{ marginBottom:10 }}>
                <label className="form-label">Source Name <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(matches trade source — e.g. FortressFX)</span></label>
                <input className="form-control" placeholder="e.g. FortressFX" value={newAcc.source} onChange={e=>setNewAcc(p=>({...p,source:e.target.value}))}/>
              </div>
              <div className="form-group" style={{ marginBottom:10 }}>
                <label className="form-label">Brokerage per Lot ($) <span style={{ fontWeight:400, color:'var(--text-muted)' }}>(leave blank to use global setting)</span></label>
                <input className="form-control" type="number" step="0.01" min="0" placeholder={`e.g. ${form.brokeragePerLot||7}`}
                  value={newAcc.brokeragePerLot} onChange={e=>setNewAcc(p=>({...p,brokeragePerLot:e.target.value}))}/>
              </div>
              <div className="form-group" style={{ marginBottom:12 }}>
                <label className="form-label">Colour</label>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:4 }}>
                  {COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setNewAcc(p=>({...p,color:c}))}
                      style={{ width:24, height:24, borderRadius:'50%', background:c, border:`3px solid ${newAcc.color===c?'white':'transparent'}`, cursor:'pointer', outline:newAcc.color===c?`2px solid ${c}`:'none', outlineOffset:1 }}/>
                  ))}
                </div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (!newAcc.name.trim() || !newAcc.source.trim()) return;
                  addAccount({
                    name: newAcc.name.trim(),
                    accountNumber: newAcc.accountNumber.trim(),
                    source: newAcc.source.trim(),
                    color: newAcc.color,
                    brokeragePerLot: newAcc.brokeragePerLot !== '' ? parseFloat(newAcc.brokeragePerLot) || 0 : null,
                  });
                  setNewAcc({ name:'', accountNumber:'', source:'', color:'#3b82f6', brokeragePerLot:'' });
                  showToast({ title: 'Account added', message: newAcc.name });
                }}>
                Add Account
              </button>
            </div>
          </div>

          {/* ── Journal Customization ─────────────────────────────────────── */}
          <div className="card" style={{ marginBottom:16 }}>
            <div className="card-title">📝 Journal Customization</div>
            <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:18, lineHeight:1.7 }}>
              See all options for Setups, Mistakes and Checklist. Click ✕ on any item to remove it. Add new ones at the bottom. Changes apply everywhere in the journal and trade forms.
            </p>

            {[
              {
                label: '📐 Setup Options',
                builtins: BUILTIN_SETUPS,
                customKey: 'customSetups',
                removedKey: 'removedSetups',
                placeholder: 'e.g. Engulfing, Pin Bar...',
              },
              {
                label: '⚠ Mistake Options',
                builtins: BUILTIN_MISTAKES,
                customKey: 'customMistakes',
                removedKey: 'removedMistakes',
                placeholder: 'e.g. Moved SL, Traded news...',
              },
              {
                label: '✅ Execution Checklist Items',
                builtins: BUILTIN_CHECKLIST,
                customKey: 'customChecklist',
                removedKey: 'removedChecklist',
                placeholder: 'e.g. Spread acceptable...',
              },
            ].map(cfg => (
              <div key={cfg.customKey} style={{ marginBottom:22 }}>
                <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:10 }}>{cfg.label}</div>
                <FullListEditor {...cfg}/>
              </div>
            ))}
          </div>

          {/* ── Password Protection ───────────────────────────────────────── */}
          {(() => {
            const [pwMode,    setPwMode]    = React.useState('');  // '' | 'set' | 'change' | 'remove'
            const [pw1,       setPw1]       = React.useState('');
            const [pw2,       setPw2]       = React.useState('');
            const [pwCurrent, setPwCurrent] = React.useState('');
            const [pwMsg,     setPwMsg]     = React.useState('');
            const [pwErr,     setPwErr]     = React.useState('');
            const hasPassword = !!localStorage.getItem('tf_pw_hash');

            const sha256 = async (str) => {
              const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
              return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
            };

            const handleSave = async () => {
              setPwErr(''); setPwMsg('');
              if (!pw1) { setPwErr('Enter a password.'); return; }
              if (pw1.length < 6) { setPwErr('Password must be at least 6 characters.'); return; }
              if (pw1 !== pw2) { setPwErr('Passwords do not match.'); return; }
              if (pwMode === 'change') {
                const curHash = await sha256(pwCurrent);
                if (curHash !== localStorage.getItem('tf_pw_hash')) { setPwErr('Current password is wrong.'); return; }
              }
              const hash = await sha256(pw1);
              localStorage.setItem('tf_pw_hash', hash);
              // Also sync to Supabase so new devices get the password automatically
              const { getSupabaseClient: getSb } = await import('../lib/supabase');
              const sbClient = getSb();
              if (sbClient) {
                await sbClient.from('tf_data').upsert({ key: 'tf_pw_hash', value: hash, updated_at: new Date().toISOString() }, { onConflict: 'key' });
              }
              setPwMsg(pwMode === 'set' ? '✓ Password set. Takes effect on next login.' : '✓ Password updated.');
              setPw1(''); setPw2(''); setPwCurrent(''); setPwMode('');
              showToast({ title: 'Password saved', message: 'Takes effect next time you open the app' });
            };

            const handleRemove = async () => {
              setPwErr(''); setPwMsg('');
              const curHash = await sha256(pwCurrent);
              if (curHash !== localStorage.getItem('tf_pw_hash')) { setPwErr('Wrong password.'); return; }
              localStorage.removeItem('tf_pw_hash');
              setPwMsg('✓ Password removed. App is now open access.');
              setPwCurrent(''); setPwMode('');
              showToast({ title: 'Password removed' });
            };

            return (
              <div className="card" style={{ marginBottom:16 }}>
                <div className="card-title">🔐 Password Protection</div>
                <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14, lineHeight:1.7 }}>
                  {hasPassword
                    ? 'Your app is password protected. A login screen appears when someone opens the app.'
                    : 'Set a password so only you (and people you share the password with) can access this app.'}
                </p>

                <div style={{ display:'flex', gap:8, marginBottom: pwMode ? 14 : 0, flexWrap:'wrap' }}>
                  {!hasPassword && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setPwMode('set'); setPwErr(''); setPwMsg(''); }}>
                      🔒 Set Password
                    </button>
                  )}
                  {hasPassword && (
                    <>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setPwMode('change'); setPwErr(''); setPwMsg(''); }}>
                        ✏️ Change Password
                      </button>
                      <button type="button" className="btn btn-secondary btn-sm" style={{ color:'var(--red)' }} onClick={() => { setPwMode('remove'); setPwErr(''); setPwMsg(''); }}>
                        🔓 Remove Password
                      </button>
                    </>
                  )}
                </div>

                {pwMode === 'set' && (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    <input className="form-control" type="password" placeholder="New password (min 6 chars)" value={pw1} onChange={e=>setPw1(e.target.value)}/>
                    <input className="form-control" type="password" placeholder="Confirm password" value={pw2} onChange={e=>setPw2(e.target.value)}/>
                    {pwErr && <div style={{ fontSize:12, color:'var(--red)' }}>{pwErr}</div>}
                    <div style={{ display:'flex', gap:8 }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>Save Password</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPwMode(''); setPwErr(''); }}>Cancel</button>
                    </div>
                  </div>
                )}

                {pwMode === 'change' && (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    <input className="form-control" type="password" placeholder="Current password" value={pwCurrent} onChange={e=>setPwCurrent(e.target.value)}/>
                    <input className="form-control" type="password" placeholder="New password (min 6 chars)" value={pw1} onChange={e=>setPw1(e.target.value)}/>
                    <input className="form-control" type="password" placeholder="Confirm new password" value={pw2} onChange={e=>setPw2(e.target.value)}/>
                    {pwErr && <div style={{ fontSize:12, color:'var(--red)' }}>{pwErr}</div>}
                    <div style={{ display:'flex', gap:8 }}>
                      <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>Update Password</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPwMode(''); setPwErr(''); }}>Cancel</button>
                    </div>
                  </div>
                )}

                {pwMode === 'remove' && (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    <input className="form-control" type="password" placeholder="Enter current password to confirm" value={pwCurrent} onChange={e=>setPwCurrent(e.target.value)}/>
                    {pwErr && <div style={{ fontSize:12, color:'var(--red)' }}>{pwErr}</div>}
                    <div style={{ display:'flex', gap:8 }}>
                      <button type="button" className="btn btn-danger btn-sm" onClick={handleRemove}>Remove Password</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPwMode(''); setPwErr(''); }}>Cancel</button>
                    </div>
                  </div>
                )}

                {pwMsg && <div style={{ marginTop:8, fontSize:12, color:'#4ade80' }}>{pwMsg}</div>}
              </div>
            );
          })()}

          <div className="card" style={{ marginBottom:16 }}>
            <div className="card-title">Data &amp; Storage</div>
            <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14 }}>All data stored locally in your browser. Nothing is sent to any server.</p>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14 }}>
              <div style={{ background:'var(--bg-hover)', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:3 }}>TOTAL TRADES</div>
                <div style={{ fontWeight:800, fontSize:20 }}>{trades.length}</div>
              </div>
              <div style={{ background:'var(--bg-hover)', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:3 }}>STORAGE USED</div>
                <div style={{ fontWeight:800, fontSize:20 }}>{(new Blob([JSON.stringify(localStorage)]).size/1024).toFixed(1)} KB</div>
              </div>
              <div style={{ background:'var(--bg-hover)', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:3 }}>DUPLICATES</div>
                <div style={{ fontWeight:800, fontSize:20 }}>
                  {(() => {
                    const seen = new Set();
                    let count = 0;
                    trades.forEach(t => {
                      if (t.positionId) {
                        if (seen.has(t.positionId)) count++;
                        else seen.add(t.positionId);
                      }
                    });
                    return <span style={{ color: count > 0 ? 'var(--red)' : '#4ade80' }}>{count}</span>;
                  })()}
                </div>
              </div>
            </div>

            {/* Deduplication */}
            <div style={{ marginBottom:12, padding:'12px 14px', background:'var(--bg-hover)', borderRadius:8 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>🧹 Remove Duplicate Trades</div>
                  <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                    Finds trades with the same Position ID and removes the extras. Journal notes and account tags on the first occurrence are kept.
                  </div>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" style={{ flexShrink:0 }}
                  onClick={() => {
                    const seen = new Map(); // positionId → first trade id
                    const toDelete = [];
                    trades.forEach(t => {
                      if (!t.positionId) return;
                      if (seen.has(t.positionId)) {
                        toDelete.push(t.id);
                      } else {
                        seen.set(t.positionId, t.id);
                      }
                    });
                    if (toDelete.length === 0) {
                      setDedupResult({ removed: 0 });
                      showToast({ title: 'No duplicates found', message: 'All trades have unique position IDs' });
                      return;
                    }
                    if (window.confirm(`Found ${toDelete.length} duplicate trade${toDelete.length > 1 ? 's' : ''}. Remove them?`)) {
                      toDelete.forEach(id => deleteTrade(id));
                      setDedupResult({ removed: toDelete.length });
                      showToast({ title: `Removed ${toDelete.length} duplicate${toDelete.length > 1 ? 's' : ''}`, message: 'Trade history is now clean' });
                    }
                  }}>
                  🧹 Deduplicate
                </button>
              </div>
              {dedupResult !== null && (
                <div style={{ marginTop:8, fontSize:12, color: dedupResult.removed > 0 ? '#4ade80' : 'var(--text-muted)' }}>
                  {dedupResult.removed > 0
                    ? `✓ Removed ${dedupResult.removed} duplicate${dedupResult.removed > 1 ? 's' : ''}`
                    : '✓ No duplicates found'}
                </div>
              )}
            </div>

            {/* Backup & Restore */}
            <div style={{ marginBottom:12, padding:'12px 14px', background:'var(--bg-hover)', borderRadius:8 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>💾 Backup & Restore</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10 }}>
                Export all your data (trades, journal notes, settings, accounts) as a JSON file you can store safely.
                Restore it anytime — on this device or another.
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const backup = {};
                    ['tf_trades','tf_journal','tf_settings','tf_accounts','tf_playbooks','tf_broker'].forEach(k => {
                      const v = localStorage.getItem(k);
                      if (v) backup[k] = JSON.parse(v);
                    });
                    // Also include password hash so it transfers to new devices
                    const pw = localStorage.getItem('tf_pw_hash');
                    if (pw) backup._pw_hash = pw;
                    backup._meta = { exportedAt: new Date().toISOString(), version: '2.0' };
                    const blob = new Blob([JSON.stringify(backup, null, 2)], { type:'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `TradeFolio_Backup_${new Date().toISOString().slice(0,10)}.json`;
                    a.click();
                    showToast({ title: 'Backup exported', message: 'Save this file somewhere safe' });
                  }}>
                  ⬇ Export Backup
                </button>
                <label className="btn btn-secondary btn-sm" style={{ cursor:'pointer', margin:0 }}>
                  ⬆ Restore from Backup
                  <input type="file" accept=".json" style={{ display:'none' }}
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = async ev => {
                        try {
                          const backup = JSON.parse(ev.target.result);
                          if (!backup.tf_trades) { alert('Invalid backup file.'); return; }
                          if (!window.confirm(`This will REPLACE all your current data with the backup from ${backup._meta?.exportedAt?.slice(0,10) || 'unknown date'}. Continue?`)) return;
                          // Save to localStorage
                          ['tf_trades','tf_journal','tf_settings','tf_accounts','tf_playbooks','tf_broker'].forEach(k => {
                            if (backup[k] !== undefined) localStorage.setItem(k, JSON.stringify(backup[k]));
                          });
                          if (backup._pw_hash) localStorage.setItem('tf_pw_hash', backup._pw_hash);
                          // Also save directly to Supabase so other devices get the correct data
                          try {
                            const { getSupabaseClient: getSb } = await import('../lib/supabase');
                            const client = getSb();
                            if (client) {
                              const keys = ['tf_trades','tf_journal','tf_settings','tf_accounts','tf_playbooks'];
                              await Promise.all(keys.map(k => backup[k]
                                ? client.from('tf_data').upsert({ key: k, value: backup[k], updated_at: new Date().toISOString() }, { onConflict: 'key' })
                                : Promise.resolve()
                              ));
                              if (backup._pw_hash) {
                                await client.from('tf_data').upsert({ key: 'tf_pw_hash', value: backup._pw_hash, updated_at: new Date().toISOString() }, { onConflict: 'key' });
                              }
                            }
                          } catch (sbErr) { console.warn('Supabase backup sync failed:', sbErr); }
                          showToast({ title: 'Backup restored', message: 'Reloading...' });
                          setTimeout(() => window.location.reload(), 800);
                        } catch { alert('Could not read backup file.'); }
                      };
                      reader.readAsText(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>

            {/* New device setup guide */}
            <div style={{ marginBottom:12, padding:'12px 14px', background:'rgba(59,130,246,.06)', border:'1px solid rgba(59,130,246,.15)', borderRadius:8 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>📱 Setting up on a new device?</div>
              <div style={{ fontSize:12, color:'var(--text-muted)', lineHeight:1.8 }}>
                On every new device (phone, tablet, new computer) do these steps in order:
              </div>
              <ol style={{ fontSize:12, color:'var(--text-secondary)', margin:'8px 0 0 0', paddingLeft:18, lineHeight:2 }}>
                <li>Go to <strong>Settings → ☁ Cloud Sync</strong> and enter your Supabase URL and anon key → Connect</li>
                <li>Your trades and data will load automatically from the cloud</li>
                <li>Your password will also be restored — you'll be asked to log in next time</li>
              </ol>
              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:8 }}>
                💡 Save your Supabase URL and anon key somewhere safe (Notes app, Google Keep) so you always have them when setting up a new device.
              </div>
            </div>

            <button type="button" className="btn btn-danger" onClick={()=>{ if(window.confirm('Delete ALL data from all accounts? This cannot be undone.')){localStorage.clear();window.location.reload();} }}>🗑 Clear All Data (All Accounts)</button>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width:'100%', justifyContent:'center', padding:11 }}>{saved?'✓ Saved!':'Save Settings'}</button>
        </form>
      </div>
    </div>
  );
}
