'use client';
import { useEffect,useState } from 'react';
import type { Approval } from '../server/approvals/model';
import { loadMessages,formatNumber,type Language } from '../lib/i18n';
export function staleText(reason:string|undefined,locale:Language) {
  const m=loadMessages(locale).screens;
  const match=reason?.match(/^(.*?) (?:changed when checked at|changed at|when checked at) (.*)$/);
  const raw=match?`${match[1]} changed`:reason||m.unknownChange;
  const translations:Record<string,string>={'HubSpot deal changed':m.changed.hubspot,'HubSpot line item changed':m.changed.hubspot_line_item,'Scope version changed':m.changed.scope,'ClickUp target list changed':m.changed.clickup};
  const what=translations[raw]??raw;
  const observed=match?.[2]?new Date(match[2]):null;
  const when=observed&&Number.isFinite(observed.getTime()) ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`,{dateStyle:'medium',timeStyle:'medium'}).format(observed) : match?.[2]??'';
  return m.stale.replace('{what}',what).replace('{when}',when).replace(/ +\./g,'.');
}
export function ApprovalCard({approval:a,locale,onRefresh}:{approval:Approval;locale:Language;onRefresh:()=>Promise<void>}) {
  const m=loadMessages(locale).screens;
  const [clock,setClock]=useState<number|null>(null),[busy,setBusy]=useState(false),[mode,setMode]=useState<'reject'|'change'|null>(null),[reason,setReason]=useState(''),[result,setResult]=useState('');
  useEffect(()=>{const tick=()=>setClock(Date.now());tick();const interval=setInterval(tick,1000);return ()=>clearInterval(interval);},[]);
  const expires=new Date(a.expires_at).getTime(),expired=clock===null||clock>=expires;
  const date=(value:string)=>new Intl.DateTimeFormat(`${locale}-u-nu-latn`,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(value));
  async function act(operation:'decide'|'confirm'|'execute',decision:'approve'|'reject'='approve') {
    if(busy)return;
    if(decision==='reject'&&!reason.trim()){setResult(m.reasonRequired);return;}
    setBusy(true);setResult('');
    try {
      const response=await fetch(`/api/approvals/${a.id}/${operation==='execute'?'run':operation}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision,note:reason.trim()})});
      setResult(response.ok?operation==='execute'?m.queued:m.saved:m.refused);
      await onRefresh();
      if(response.ok)setMode(null);
    } catch {setResult(m.error);} finally {setBusy(false);}
  }
  const value=(v:unknown):string=>v===null?m.none:typeof v==='object'?JSON.stringify(v):String(v);
  return <section className="approval-card" aria-label={m.approval} data-approval-id={a.id}>
    <h2>{m.approval}</h2><p>{m.statuses[a.status as keyof typeof m.statuses]??m.none}</p>
    <span className="sample-badge">{m.reversibility[a.reversibility]}</span>
    {a.status==='stale'&&<p role="alert" className="stale-notice">{staleText(a.stale_reason as string|undefined,locale)}</p>}
    <div className="approval-effects">{a.payload.effects.map((effect,i)=><section key={i}><h3>{m.destination}: {effect.system==='clickup'?'ClickUp':effect.system==='hubspot'?'HubSpot':effect.system==='soldline'?'Soldline':m.tabs.emails}</h3><p className="record-value">{effect.location}</p>{effect.records.map((record,j)=><div key={j} className="effect-record"><p>{m.record}: <span className="record-value">{record.id}</span></p>{Object.entries(record.fields).map(([field,change])=><dl className="field-diff" key={field}><div><dt>{m.field}</dt><dd>{m.fields[field as keyof typeof m.fields]??field.replaceAll('_',' ')}</dd></div><div><dt>{m.before}</dt><dd>{value(change.before)}</dd></div><div><dt>{m.after}</dt><dd>{value(change.after)}</dd></div></dl>)}</div>)}{Object.keys(effect.amounts).length>0&&<div><h3>{m.amounts}</h3>{Object.entries(effect.amounts).map(([key,n])=><p key={key}>{key}: {formatNumber(n,locale)}</p>)}</div>}{effect.message&&<div className="full-message"><h3>{m.message}</h3><p>{m.to}: {effect.message.to.join(', ')}</p><p>{m.subject}: {effect.message.subject}</p><p>{effect.message.body}</p></div>}</section>)}</div>
    <p>{m.expires}: <time dateTime={a.expires_at} suppressHydrationWarning>{clock===null?m.loading:date(a.expires_at)}</time></p>
    <p>{m.remaining}: {clock===null?m.loading:formatNumber(Math.max(0,Math.ceil((expires-clock)/1000)),locale)}</p>
    <div className="screen-toolbar"><button className="button primary" disabled={busy||expired||a.status!=='pending'} onClick={()=>act('decide')}>{m.approve}</button><button className="button" disabled={busy||expired||a.status!=='pending'} onClick={()=>setMode('change')}>{m.change}</button><button className="button" disabled={busy||expired||a.status!=='pending'} onClick={()=>setMode('reject')}>{m.reject}</button></div>
    {mode&&<form onSubmit={e=>{e.preventDefault();void act('decide','reject');}}>{mode==='change'&&<p>{m.changeHelp}</p>}<label>{m.reason}<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label><button className="button" disabled={busy}>{mode==='change'?m.submitChange:m.reject}</button></form>}
    {a.status==='approved'&&a.reversibility==='irreversible'&&!a.confirmed_at&&<button className="button" disabled={busy||expired} onClick={()=>act('confirm')}>{m.confirm}</button>}
    {a.status==='approved'&&<button className="button primary" disabled={busy||expired||(a.reversibility==='irreversible'&&!a.confirmed_at)} onClick={()=>act('execute')}>{m.execute}</button>}
    {result&&<p role="status">{result}</p>}
  </section>;
}
