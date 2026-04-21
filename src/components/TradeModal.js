import React, { useState, useEffect } from 'react';
import { useTrades } from '../context/TradesContext';
import { useToast } from '../context/ToastContext';

const SETUPS = {
  '5 Min':  ['5 Min A+', '5 Min TJL1', '5 Min TJL2', '5 Min LVL 3', '5 Min LVL 4'],
  '15 Min': ['15 Min A+', '15 Min TJL1', '15 Min TJL2', '15 Min LVL 3', '15 Min LVL 4'],
  '1H':     ['1H A+', '1H TJL1', '1H TJL2', '1H LVL 3', '1H LVL 4'],
  '4H':     ['4H A+', '4H TJL1', '4H TJL2'],
  '1D':     ['1D A+', '1D TJL1', '1D TJL2'],
};
const TFS      = ['1m','2m','3m','5m','10m','15m','30m','1h','2h','4h','1D'];
const EMOTIONS = ['Confident','Calm','Excited','Anxious','Frustrated','Fearful','Greedy','Neutral','FOMO'];
const MISTAKES = ['Early Entry','Late Entry','Early Exit','Late Exit','Oversized','Ignored Stop','Ignored trend','Chasing','Revenge Trade','No plan'];

const today = new Date().toISOString().slice(0,10);

const defTrade = {
  symbol:'', side:'Long', status:'Win',
  entryDate: today, entryTime:'09:30',
  exitDate:  today, exitTime:'10:00',
  entryPrice:'', exitPrice:'', size:'', fees:'0',
  pnl:'', rMultiple:'', setup:'', timeframe:'5m',
  notes:'', tags:'', emotion:'Calm', mistakes:[],
  isWithdrawal: false,
};

const defWithdrawal = {
  symbol: 'WITHDRAWAL', side:'Long', status:'Breakeven',
  entryDate: today, entryTime:'', exitDate: today, exitTime:'',
  entryPrice:0, exitPrice:0, size:0, fees:0,
  pnl:'', rMultiple:0, setup:'', timeframe:'',
  notes:'', tags:'', emotion:'', mistakes:[],
  isWithdrawal: true,
};

export default function TradeModal({ trade, onClose, defaultTab }) {
  const { addTrade, updateTrade, settings, accounts, activeAccountId } = useTrades();
  const { showToast } = useToast();
  const isEdit = !!trade;

  const SETUPS_MERGED = {
    ...Object.fromEntries(
      Object.entries(SETUPS).map(([g, opts]) => [g, opts.filter(o => !(settings?.removedSetups||[]).includes(o))])
        .filter(([, opts]) => opts.length > 0)
    ),
    ...(settings?.customSetups?.length ? { 'Custom': settings.customSetups } : {}),
  };
  const MISTAKES_MERGED = [
    ...MISTAKES.filter(m => !(settings?.removedMistakes||[]).includes(m)),
    ...(settings?.customMistakes || []),
  ];
  const [mode, setMode] = useState(trade?.isWithdrawal ? 'withdrawal' : (defaultTab || 'trade'));

  const initForm = () => {
    if (trade) return { ...trade, tags:(trade.tags||[]).join(', '), mistakes:trade.mistakes||[] };
    return mode === 'withdrawal' ? { ...defWithdrawal } : { ...defTrade };
  };
  const [f, setF] = useState(initForm);
  const [auto, setAuto] = useState(!isEdit);

  const switchMode = (m) => {
    if (isEdit) return;
    setMode(m);
    setF(m === 'withdrawal' ? { ...defWithdrawal } : { ...defTrade });
    setAuto(true);
  };

  useEffect(()=>{
    if (mode !== 'trade') return;
    if (!auto||!f.entryPrice||!f.exitPrice||!f.size) return;
    const e=parseFloat(f.entryPrice),x=parseFloat(f.exitPrice),s=parseFloat(f.size),fee=parseFloat(f.fees)||0;
    if (isNaN(e)||isNaN(x)||isNaN(s)) return;
    const rawPnl = f.side==='Long'?(x-e)*s-fee:(e-x)*s-fee;
    const status = rawPnl>0.5?'Win':rawPnl<-0.5?'Loss':'Breakeven';
    setF(p=>({...p,pnl:rawPnl.toFixed(2),status}));
  },[f.entryPrice,f.exitPrice,f.size,f.fees,f.side,auto,mode]);

  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const [withdrawalAccountId, setWithdrawalAccountId] = useState(trade?.accountId || activeAccountId || '');
  const toggleMistake = m => setF(p=>({...p,mistakes:p.mistakes.includes(m)?p.mistakes.filter(x=>x!==m):[...p.mistakes,m]}));

  const submit = e => {
    e.preventDefault();
    const isW = mode === 'withdrawal';
    const chosenAccId = isW
      ? (withdrawalAccountId || activeAccountId || null)
      : (activeAccountId || null);
    const chosenAcc = chosenAccId ? accounts.find(a => a.id === chosenAccId) : null;
    const payload = {
      ...f,
      pnl:        isW ? -(Math.abs(parseFloat(f.pnl)||0)) : parseFloat(f.pnl)||0,
      rMultiple:  parseFloat(f.rMultiple)||0,
      entryPrice: parseFloat(f.entryPrice)||0,
      exitPrice:  parseFloat(f.exitPrice)||0,
      size:       parseFloat(f.size)||0,
      fees:       parseFloat(f.fees)||0,
      tags:       f.tags ? f.tags.split(',').map(t=>t.trim()).filter(Boolean) : [],
      isWithdrawal: isW,
      symbol:     isW ? 'WITHDRAWAL' : f.symbol,
      status:     isW ? 'Breakeven' : f.status,
      ...(chosenAccId ? { accountId: chosenAccId, source: chosenAcc?.source || chosenAcc?.name } : {}),
    };
    if (isEdit) updateTrade(trade.id, payload); else addTrade(payload);
    showToast({
      title: isEdit ? 'Changes saved' : (isW ? 'Withdrawal logged' : 'Trade logged'),
      message: isW ? `$${Math.abs(payload.pnl).toFixed(2)} on ${payload.entryDate}${chosenAcc ? ` · ${chosenAcc.name}` : ''}` : `${payload.symbol} ${payload.side} — ${payload.status}`,
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{isEdit ? 'Edit Trade' : 'Log New Entry'}</div>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        {!isEdit && (
          <div style={{display:'flex',borderBottom:'1px solid var(--border)',padding:'0 20px',background:'var(--bg-card)'}}>
            {[['trade','📈 Trade'],['withdrawal','💸 Withdrawal']].map(([m,l])=>(
              <button key={m} onClick={()=>switchMode(m)} style={{
                padding:'10px 16px',fontSize:13,fontWeight:600,
                color: mode===m?'var(--text-primary)':'var(--text-secondary)',
                background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font)',
                borderBottom:`2px solid ${mode===m?'var(--blue)':'transparent'}`,marginBottom:-1,
              }}>{l}</button>
            ))}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="modal-body">
            {mode === 'withdrawal' && (
              <div>
                <div style={{background:'rgba(239,68,68,.08)',border:'1px solid rgba(239,68,68,.2)',borderRadius:8,padding:'12px 14px',marginBottom:16,fontSize:13,color:'var(--text-secondary)'}}>
                  💸 A withdrawal will be recorded separately and will <strong style={{color:'var(--text-primary)'}}>not</strong> affect your win rate, trade count, or P&L stats. It is tracked for account balance purposes only.
                </div>
                <div className="form-row cols-2" style={{marginBottom:16}}>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Date</label>
                    <input className="form-control" type="date" value={f.entryDate} onChange={e=>{ set('entryDate',e.target.value); set('exitDate',e.target.value); }} required/>
                  </div>
                  <div className="form-group" style={{marginBottom:0}}>
                    <label className="form-label">Amount ($)</label>
                    <input className="form-control" type="number" step="0.01" min="0" placeholder="e.g. 500.00"
                      value={f.pnl ? Math.abs(parseFloat(f.pnl)) : ''}
                      onChange={e=>{ setAuto(false); set('pnl', e.target.value); }} required/>
                  </div>
                </div>
                <div className="form-group" style={{marginBottom:16}}>
                  <label className="form-label">Account {accounts.length > 0 && <span style={{color:'var(--red)',fontSize:10}}>*</span>}</label>
                  {accounts.length > 0 ? (
                    <select className="form-control" value={withdrawalAccountId} onChange={e=>setWithdrawalAccountId(e.target.value)}>
                      <option value="">— Select account —</option>
                      {accounts.map(a => (
                        <option key={a.id} value={a.id}>{a.name}{a.accountNumber ? ` #${a.accountNumber}` : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <div style={{fontSize:12,color:'var(--text-muted)',padding:'8px 0'}}>Add accounts in Settings to assign withdrawals to specific accounts.</div>
                  )}
                </div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Notes (optional)</label>
                  <input className="form-control" placeholder="e.g. Moving to savings..." value={f.notes} onChange={e=>set('notes',e.target.value)}/>
                </div>
              </div>
            )}

            {mode === 'trade' && (<>
              <div className="form-row cols-4" style={{marginBottom:16}}>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">Symbol *</label><input className="form-control" placeholder="XAUUSD" value={f.symbol} onChange={e=>set('symbol',e.target.value.toUpperCase())} required/></div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">Side</label><select className="form-control" value={f.side} onChange={e=>set('side',e.target.value)}><option>Long</option><option>Short</option></select></div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">Size / Lots *</label><input className="form-control" type="number" step="0.01" placeholder="0.5" value={f.size} onChange={e=>set('size',e.target.value)} required/></div>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Status</label>
                  <select className="form-control" value={f.status} onChange={e=>{ setAuto(false); set('status',e.target.value); }}>
                    <option>Win</option><option>Loss</option>
                    <option value="Breakeven">Breakeven (no W/L count)</option>
                  </select>
                </div>
              </div>
              <div className="form-row cols-2" style={{marginBottom:16}}>
                <div>
                  <div className="form-label" style={{marginBottom:8,color:'var(--blue-bright)'}}>📍 Entry</div>
                  <div className="form-row cols-2"><div className="form-group" style={{marginBottom:8}}><label className="form-label">Date</label><input className="form-control" type="date" value={f.entryDate} onChange={e=>set('entryDate',e.target.value)}/></div><div className="form-group" style={{marginBottom:8}}><label className="form-label">Time</label><input className="form-control" type="time" value={f.entryTime} onChange={e=>set('entryTime',e.target.value)}/></div></div>
                  <div className="form-group" style={{marginBottom:0}}><label className="form-label">Entry Price *</label><input className="form-control" type="number" step="0.00001" placeholder="4786.99" value={f.entryPrice} onChange={e=>set('entryPrice',e.target.value)} required/></div>
                </div>
                <div>
                  <div className="form-label" style={{marginBottom:8,color:'var(--text-secondary)'}}>🏁 Exit</div>
                  <div className="form-row cols-2"><div className="form-group" style={{marginBottom:8}}><label className="form-label">Date</label><input className="form-control" type="date" value={f.exitDate} onChange={e=>set('exitDate',e.target.value)}/></div><div className="form-group" style={{marginBottom:8}}><label className="form-label">Time</label><input className="form-control" type="time" value={f.exitTime} onChange={e=>set('exitTime',e.target.value)}/></div></div>
                  <div className="form-group" style={{marginBottom:0}}><label className="form-label">Exit Price *</label><input className="form-control" type="number" step="0.00001" placeholder="4782.79" value={f.exitPrice} onChange={e=>set('exitPrice',e.target.value)} required/></div>
                </div>
              </div>
              <div className="form-row cols-3" style={{marginBottom:16}}>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">Commission ($)</label><input className="form-control" type="number" step="0.01" value={f.fees} onChange={e=>set('fees',e.target.value)}/></div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">P&L ($) {auto&&<span style={{color:'var(--blue)',fontSize:10}}>AUTO</span>}</label><input className="form-control" type="number" step="0.01" value={f.pnl} onChange={e=>{setAuto(false);set('pnl',e.target.value);}}/></div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">R Multiple</label><input className="form-control" type="number" step="0.1" placeholder="1.5" value={f.rMultiple} onChange={e=>set('rMultiple',e.target.value)}/></div>
              </div>
              <div className="divider"/>
              <div className="form-row cols-3" style={{marginBottom:16}}>
                <div className="form-group" style={{marginBottom:0}}>
                  <label className="form-label">Setup</label>
                  <select className="form-control" value={f.setup} onChange={e=>set('setup',e.target.value)}>
                    <option value="">Select...</option>
                    {Object.entries(SETUPS_MERGED).map(([group, options]) => (
                      <optgroup key={group} label={`── ${group} ──`}>
                        {options.map(s => <option key={s} value={s}>{s}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">Timeframe</label><select className="form-control" value={f.timeframe} onChange={e=>set('timeframe',e.target.value)}>{TFS.map(t=><option key={t}>{t}</option>)}</select></div>
                <div className="form-group" style={{marginBottom:0}}><label className="form-label">Emotion</label><select className="form-control" value={f.emotion} onChange={e=>set('emotion',e.target.value)}>{EMOTIONS.map(em=><option key={em}>{em}</option>)}</select></div>
              </div>
              <div className="form-group" style={{marginBottom:16}}><label className="form-label">Tags (comma separated)</label><input className="form-control" placeholder="breakout, london, momentum" value={f.tags} onChange={e=>set('tags',e.target.value)}/></div>
              <div className="form-group" style={{marginBottom:16}}>
                <label className="form-label">Mistakes</label>
                <div style={{display:'flex',flexWrap:'wrap',gap:5,marginTop:4}}>
                  {MISTAKES_MERGED.map(m=><button type="button" key={m} onClick={()=>toggleMistake(m)} style={{padding:'4px 10px',borderRadius:20,fontSize:11,cursor:'pointer',border:'1px solid',background:f.mistakes.includes(m)?'var(--red-dim)':'var(--bg-hover)',color:f.mistakes.includes(m)?'var(--red)':'var(--text-secondary)',borderColor:f.mistakes.includes(m)?'rgba(239,68,68,.3)':'var(--border)'}}>{m}</button>)}
                </div>
              </div>
              <div className="form-group" style={{marginBottom:0}}><label className="form-label">Notes</label><textarea className="form-control" rows={3} placeholder="What happened? Key observations..." value={f.notes} onChange={e=>set('notes',e.target.value)}/></div>
            </>)}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">{isEdit?'Save Changes': mode==='withdrawal'?'Log Withdrawal':'Log Trade'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
