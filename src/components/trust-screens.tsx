'use client';
import Link from 'next/link';
import { useCallback,useEffect,useState } from 'react';
import { loadMessages,type Language } from '../lib/i18n';
type Copy=ReturnType<typeof loadMessages>['trust'];
function useRead<T>(url:string|null) {
  const [data,setData]=useState<T|null>(null),[failed,setFailed]=useState(false),[refused,setRefused]=useState(false);
  const read=useCallback(async()=>{if(!url)return;try{const response=await fetch(url,{cache:'no-store'});setFailed(false);setRefused(response.status===403);if(!response.ok)throw new Error();setData(await response.json());}catch{setFailed(true);}},[url]);
  useEffect(()=>{if(!url)return;const controller=new AbortController();void fetch(url,{cache:'no-store',signal:controller.signal}).then(async response=>{setRefused(response.status===403);if(!response.ok)throw new Error();setData(await response.json());setFailed(false);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});return ()=>controller.abort();},[url]);
  return {data,failed,refused,read};
}
function ErrorState({m,retry,refused=false}:{m:Copy;retry:()=>void;refused?:boolean}) {return <div className="trust-error" role="alert"><strong>{refused?m.refused:m.error}</strong><button className="button" onClick={retry}>{m.retry}</button></div>;}
export function RecoveryScreen({locale}:{locale:Language}) {
  const m=loadMessages(locale).trust;
  type Item={id:string;run_id:string;title:string;plain_reason:string;allowed_options:string[];reversible:boolean};
  const {data,failed,read}=useRead<{rows:Item[]}>('/api/recovery');
  const [selected,setSelected]=useState(''),[note,setNote]=useState(''),[invalid,setInvalid]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[feedback,setFeedback]=useState(''),[undo,setUndo]=useState('');
  const [retryAction,setRetryAction]=useState<(()=>void)|null>(null);
  const item=data?.rows.find(i=>i.id===selected)??data?.rows[0];
  useEffect(()=>{if(!undo)return;const timer=setTimeout(()=>setUndo(''),8000);return ()=>clearTimeout(timer);},[undo]);
  async function act(option:string) {
    if(!item)return;
    setRetryAction(()=>()=>void act(option));
    if(option==='resolve_with_note'&&!note.trim()){setInvalid(true);document.getElementById('resolution-note')?.focus();return;}
    setBusy(true);setError(false);setFeedback('');
    try{const response=await fetch(`/api/recovery/${item.id}/actions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({option,note})});if(!response.ok)throw new Error();
      const index=data!.rows.indexOf(item);setSelected(data!.rows[index+1]?.id??data!.rows.find(i=>i.id!==item.id)?.id??'');setNote('');setInvalid(false);setFeedback(m.done);if(item.reversible)setUndo(item.run_id);await read();
    }catch{setError(true);}finally{setBusy(false);}
  }
  async function reverse(){setRetryAction(()=>()=>void reverse());setBusy(true);try{const response=await fetch(`/api/runs/${undo}/undo`,{method:'POST'});if(!response.ok)throw new Error();setFeedback(m.undoReady);setUndo('');}catch{setError(true);}finally{setBusy(false);}}
  return <section className="screen"><h1>{m.recovery}</h1>{failed&&<ErrorState m={m} retry={read}/>}{feedback&&<p role="status">{feedback}</p>}{undo&&<aside className="undo-toast" role="status"><p>{m.undoHint}</p><button className="button" disabled={busy} onClick={reverse}>{m.undo}</button></aside>}
    {!data&&!failed&&<p role="status">{m.loading}</p>}{data&&<div className="recovery-columns"><nav aria-label={m.recovery} className="recovery-list">{data.rows.map(i=><button key={i.id} aria-current={i.id===item?.id?'true':undefined} onClick={()=>{setSelected(i.id);setNote('');setInvalid(false);setError(false);}}>{i.title||m.recovery}</button>)}{!data.rows.length&&<p>{m.empty}</p>}</nav><article className="trust-card recovery-detail">{item?<><h2>{item.title||m.recovery}</h2><p>{item.plain_reason}</p><label htmlFor="resolution-note">{m.note}<textarea id="resolution-note" value={note} aria-invalid={invalid} aria-describedby={invalid?'note-error':undefined} onChange={e=>{setNote(e.target.value);setInvalid(false);}}/></label>{invalid&&<p id="note-error" role="alert">{m.noteRequired}</p>}<div className="trust-actions">{item.allowed_options.filter(o=>o in m.options).map(option=><button className="button" key={option} disabled={busy} onClick={()=>act(option)}>{m.options[option as keyof typeof m.options]}</button>)}</div></>:<p>{m.empty}</p>}{error&&<ErrorState m={m} retry={()=>retryAction?.()}/>}</article></div>}
  </section>;
}
type AuditRow={id:number;at:string;actor_name_at_event:string|null;actor_roles_at_event:string[]|null;action:string;outcome:string;target_id:string;run_id?:string;after?:{title?:string}};
export function AuditScreen({locale,initialFilters={},refusedOnServer=false}:{locale:Language;initialFilters?:Record<string,string>;refusedOnServer?:boolean}) {
  const all=loadMessages(locale),m=all.trust;
  const {data,failed,refused,read}=useRead<{chain:{ok:boolean;brokenAtId:number|null};rows:AuditRow[]}>(refusedOnServer?null:'/api/audit');
  const [filters,setFilters]=useState<Record<string,string>>(initialFilters);
  const rows=data?.rows.filter(row=>(!filters.actor||row.actor_name_at_event?.toLowerCase().includes(filters.actor.toLowerCase()))&&(!filters.action||row.action===filters.action)&&(!filters.outcome||row.outcome===filters.outcome)&&(!filters.run||row.run_id===filters.run||row.target_id===filters.run)&&(!filters.date||new Date(row.at).toISOString().slice(0,10)===filters.date));
  const label=(action:string)=>m.eventActions[action as keyof typeof m.eventActions]??all.screens.events[action as keyof typeof all.screens.events]??m.event;
  return <section className="screen"><h1>{m.audit}</h1>{refusedOnServer?<ErrorState m={m} refused retry={()=>location.reload()}/>:failed?<ErrorState m={m} retry={read} refused={refused}/>:!data?<p role="status">{m.loading}</p>:<>
    <p className="chain-status" role="status">{data.chain.ok?m.chainOk:m.chainBroken.replace('{id}',String(data.chain.brokenAtId))}</p>
    <form className="screen-toolbar" onSubmit={e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget)) as Record<string,string>;const params=new URLSearchParams(Object.entries(values).filter(([,v])=>v));history.replaceState(null,'',`${location.pathname}?${params}`);setFilters(values);}}>
      <label>{m.actor}<input name="actor" defaultValue={filters.actor??''}/></label><label>{m.action}<select name="action" value={filters.action??''} onChange={e=>setFilters({...filters,action:e.target.value})}><option value="">{m.all}</option>{[...new Set(data.rows.map(r=>r.action))].map(a=><option key={a} value={a}>{label(a)}</option>)}</select></label>
      <label>{m.outcome}<select name="outcome" value={filters.outcome??''} onChange={e=>setFilters({...filters,outcome:e.target.value})}><option value="">{m.all}</option>{Object.entries(m.outcomes).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
      <label>{m.run}<input name="run" defaultValue={filters.run??''}/></label><label>{m.date}<input name="date" type="date" defaultValue={filters.date??''}/></label><button className="button" type="submit">{m.apply}</button>
    </form>
    <div className="audit-rows">{rows?.map(row=><article className={`audit-row ${row.outcome==='denied'?'denied-row':''}`} key={row.id} data-audit-id={row.id}><span>{row.id}</span><dl><div><dt>{m.date}</dt><dd>{new Intl.DateTimeFormat(`${locale}-u-nu-latn`,{dateStyle:'medium',timeStyle:'short'}).format(new Date(row.at))}</dd></div><div><dt>{m.actor}</dt><dd>{row.actor_name_at_event??m.agent}</dd></div><div><dt>{m.roles}</dt><dd>{row.actor_roles_at_event?.map(role=>all.demo.roles[role as keyof typeof all.demo.roles]??role.replaceAll('_',' ')).join(', ')}</dd></div><div><dt>{m.action}</dt><dd>{label(row.action)}{typeof row.after?.title==='string'&&<p>{row.after.title}</p>}</dd></div><div><dt>{m.outcome}</dt><dd>{m.outcomes[row.outcome as keyof typeof m.outcomes]}</dd></div>{row.run_id&&<div><dt>{m.run}</dt><dd><Link href={`/runs/${row.run_id}`}>{m.run}</Link></dd></div>}</dl></article>)}</div>{!rows?.length&&<p>{m.empty}</p>}
  </>}</section>;
}
export function ConnectionsScreen({locale}:{locale:Language}) {
  const m=loadMessages(locale).trust;
  type Connection={provider:'hubspot'|'clickup'|'mail';status:keyof Copy['health'];scopes:string[]|null;allowed_actions:string[]|Record<string,unknown>|null};
  const {data,failed,read}=useRead<{rows:Connection[];editable:boolean}>('/api/connections');
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[feedback,setFeedback]=useState(''),[reconnect,setReconnect]=useState('');
  const [retryAction,setRetryAction]=useState<(()=>void)|null>(null);
  async function change(provider:string,operation:string,credential?:{token:string;account:string}) {setRetryAction(()=>()=>void change(provider,operation,credential));setBusy(true);setError(false);setFeedback('');try{const response=await fetch('/api/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,operation,...credential})});if(!response.ok)throw new Error();setFeedback(m.saved);setReconnect('');await read();}catch{setError(true);}finally{setBusy(false);}}
  return <section className="screen"><h1>{m.connections}</h1>{failed&&<ErrorState m={m} retry={read}/>} {!data&&!failed&&<p role="status">{m.loading}</p>}{feedback&&<p role="status">{feedback}</p>}{error&&<ErrorState m={m} retry={()=>retryAction?.()}/>}
    {data&&(['hubspot','clickup','mail'] as const).map(provider=>{const row=data.rows.find(r=>r.provider===provider);const actions=Array.isArray(row?.allowed_actions)?row.allowed_actions:Object.keys(row?.allowed_actions??{}).filter(key=>(row!.allowed_actions as Record<string,unknown>)[key]===true);
      return <article className="trust-card" key={provider} data-provider={provider}><h2>{m.providers[provider]}</h2><p>{m.health[row?.status??'needs_reconnect']}</p><h3>{m.scopes}</h3><ul>{row?.scopes?.length?row.scopes.map(scope=><li key={scope}>{m.scopeNames[scope as keyof typeof m.scopeNames]??m.scopeOther}</li>):<li>{m.noScope}</li>}</ul><h3>{m.mayDo}</h3><ul>{actions.length?actions.map(action=><li key={action}>{m.actionNames[action as keyof typeof m.actionNames]??m.actionOther}</li>):<li>{m.noActions}</li>}</ul>
      {data.editable?<><div className="trust-actions"><button className="button" disabled={busy} onClick={()=>setReconnect(provider)}>{m.reconnect}</button><button className="button" disabled={busy||!row} onClick={()=>change(provider,row?.status==='paused'?'resume':'pause')}>{row?.status==='paused'?m.resume:m.pause}</button></div>{reconnect===provider&&<form className="screen" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);void change(provider,'reconnect',{token:String(form.get('token')),account:String(form.get('account'))});}}><label>{m.token}<input name="token" type="password" required autoComplete="off"/></label><label>{m.account}<input name="account" required/></label><button className="button" disabled={busy}>{m.reconnect}</button></form>}</>:<p>{m.readOnly}</p>}</article>;
    })}
  </section>;
}
type ClientData={runs:{id:string;name:string}[];inputs:{id:string;run_id:string;label:string;status:string}[];deliverables:{id:string;run_id:string;title:string;status:string}[]};
export function ClientScreen({locale,inputsOnly=false}:{locale:Language;inputsOnly?:boolean}) {
  const m=loadMessages(locale).trust;const {data,failed,read}=useRead<ClientData>('/api/client');
  const [busy,setBusy]=useState(false),[error,setError]=useState(false),[feedback,setFeedback]=useState('');
  const [retryAction,setRetryAction]=useState<(()=>void)|null>(null);
  async function act(url:string,body?:unknown){setRetryAction(()=>()=>void act(url,body));setBusy(true);setError(false);try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body??{})});if(!response.ok)throw new Error();setFeedback(m.saved);await read();}catch{setError(true);}finally{setBusy(false);}}
  return <section className="screen"><h1>{inputsOnly?m.inputs:m.home}</h1>{failed&&<ErrorState m={m} retry={read}/>} {!data&&!failed&&<p role="status">{m.loading}</p>}{feedback&&<p role="status">{feedback}</p>}{error&&<ErrorState m={m} retry={()=>retryAction?.()}/>}{data&&<>
    {!inputsOnly&&<section><h2>{m.deliverables}</h2>{data.deliverables.map(d=><article className="trust-card" key={d.id}><h3><Link href={`/deliverables/${encodeURIComponent(d.id)}`}>{d.title||m.deliverables}</Link></h3><p>{data.runs.find(r=>r.id===d.run_id)?.name}</p><p>{d.status.toLowerCase()==='client review'?m.review:d.status==='approved'?m.approved:d.status.replaceAll('_',' ').replaceAll('-',' ')}</p>{d.status.toLowerCase()==='client review'&&<button className="button" disabled={busy} onClick={()=>act(`/api/deliverables/${encodeURIComponent(d.id)}`)}>{m.approve}</button>}</article>)}{!data.deliverables.length&&<p>{m.empty}</p>}</section>}
    <section><h2>{m.inputs}</h2>{data.inputs.map(i=><article className="trust-card" key={i.id}><h3>{i.label||m.inputs}</h3><p>{data.runs.find(r=>r.id===i.run_id)?.name}</p><p>{i.status==='received'?m.received:m.missing}</p>{i.status!=='received'&&<button className="button" disabled={busy} onClick={()=>act(`/api/inputs/${i.id}`,{confirm:true})}>{m.confirmInput}</button>}</article>)}{!data.inputs.length&&<p>{m.empty}</p>}</section>
  </>}</section>;
}
export function BackendCheck({id,locale}:{id:string;locale:Language}) {
  const m=loadMessages(locale).trust;
  const [result,setResult]=useState<{status:number;message:string;request:{method:string;path:string};row:AuditRow}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  async function check(){setBusy(true);setError(false);try{const response=await fetch('/api/demo/backend-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({runId:id})});if(!response.ok)throw new Error();setResult(await response.json());}catch{setError(true);}finally{setBusy(false);}}
  return <section className="backend-check"><h3>{m.backend}</h3><button className="button" disabled={busy} onClick={check}>{m.tryRavi}</button>{error&&<ErrorState m={m} retry={check}/>} {result&&<dl aria-live="polite"><div><dt>{m.request}</dt><dd data-request-path={result.request.path}>{m.requestLabel}</dd></div><div><dt>{m.response}</dt><dd>{result.status}</dd></div><div><dt>{m.message}</dt><dd>{result.message}</dd></div><div><dt>{m.auditRow}</dt><dd data-audit-id={result.row.id}>{result.row.id} {result.row.actor_name_at_event} {m.eventActions.approve_plan} {m.outcomes[result.row.outcome as keyof typeof m.outcomes]}</dd></div></dl>}</section>;
}
