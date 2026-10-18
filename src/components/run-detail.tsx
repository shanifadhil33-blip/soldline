'use client';
import { useCallback,useEffect,useState } from 'react';
import { loadMessages,type Language } from '../lib/i18n';
import type { Approval } from '../server/approvals/model';
import { demoPeople } from '../lib/demo-personas';
import { ApprovalCard } from './approval-card';
type Finding={id:string;title:string;evidence:Record<string,unknown>|Record<string,unknown>[]|null};
type Detail={run:{id:string;status:string;plan:{tasks?:{title:string;owner:string;due:string}[]}|null};title:string;findings:Finding[];inputs:{id:string;label:string;status:string}[];items:{key:string;title:string;source_quote:string}[];approvals:Approval[];history:{id:string;at:string;action:string;actor_name_at_event:string;outcome:string}[];members:{id:string;display_name:string;clickup_user_id:string|null}[];isDemo:boolean};
type Tasks={tasks:{id:string;name:string;assignees?:({id:number;username?:string}|number)[];due_date?:string;status?:{status:string}}[];readAt:string};
const tabs=['plan','inputs','findings','clickup','emails','history'] as const;
type Tab=typeof tabs[number];
export function RunDetail({id,locale,initialTab='plan'}:{id:string;locale:Language;initialTab?:Tab}) {
  const m=loadMessages(locale).screens;
  const [data,setData]=useState<Detail|null>(null),[tab,setTab]=useState<Tab>(initialTab),[error,setError]=useState(''),[replay,setReplay]=useState(''),[busy,setBusy]=useState(false),[tasks,setTasks]=useState<Tasks|null>(null);
  const refresh=useCallback(async()=>{
    const response=await fetch(`/api/runs/${id}`,{cache:'no-store'});
    if(!response.ok)throw new Error();
    setData(localizeDetail(await response.json(),locale));
  },[id,locale]);
  useEffect(()=>{let active=true;void fetch(`/api/runs/${id}`,{cache:'no-store'}).then(async response=>{if(!response.ok)throw new Error();const body=await response.json();if(active)setData(localizeDetail(body,locale));}).catch(()=>{if(active)setError(m.error);});const timer=setInterval(()=>{void refresh().catch(()=>setError(m.error));},5000);return ()=>{active=false;clearInterval(timer);};},[id,locale,refresh,m.error]);
  useEffect(()=>{if(tab!=='clickup')return;let active=true;void fetch(`/api/runs/${id}/tasks`,{cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error();const body=await r.json();if(active)setTasks(body);}).catch(()=>{if(active)setError(m.error);});return ()=>{active=false;};},[tab,id,m.error]);
  function select(value:Tab) {setError('');setTasks(null);setTab(value);const url=new URL(location.href);url.searchParams.set('tab',value);history.replaceState(null,'',url);}
  const date=(value:string)=>new Intl.DateTimeFormat(`${locale}-u-nu-latn`,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  async function runReplay() {setBusy(true);try {const r=await fetch(`/api/runs/${id}/replay`,{method:'POST'});const body=await r.json();setReplay(body.message);await refresh();}catch{setError(m.error);}finally{setBusy(false);}}
  if(!data)return <p role="status">{error||m.loading}</p>;
  const findings=<div className="findings">{data.findings.map(f=><article className="finding" key={f.id}><h3>{f.title}</h3><dl>{(['source','quote','current','rule'] as const).map(key=><div key={key}><dt>{m[key]}</dt><dd>{key==='rule'?(m.rules[showEvidence(f.evidence,key,m.none).split('\n')[0] as keyof typeof m.rules]??showEvidence(f.evidence,key,m.none)):showEvidence(f.evidence,key,m.none)}</dd></div>)}</dl></article>)}{!data.findings.length&&<p>{m.empty}</p>}</div>;
  const timeline=<section><h2>{m.timeline}</h2>{data.history.map(h=><p className="timeline-row" key={h.id}><time>{date(h.at)}</time><span>{h.actor_name_at_event||'Agent'}</span><span>{m.events[h.action as keyof typeof m.events]??m.event}</span></p>)}{!data.history.length&&<p>{m.empty}</p>}</section>;
  return <section className="screen run-detail"><h1>{data.title}</h1><p>{m.statuses[data.run.status as keyof typeof m.statuses]??m.none}</p><nav className="run-tabs" aria-label={m.tabs.plan}>{tabs.map(key=><button key={key} aria-current={tab===key?'page':undefined} onClick={()=>select(key)}>{m.tabs[key]}</button>)}</nav>
    {error&&<p role="alert">{error}</p>}
    {tab==='plan'&&<div className="detail-columns"><div>{timeline}<section><h2>{m.findings}</h2>{findings}</section></div><div><section className="plan-diff"><h2>{m.planDiff}</h2>{data.run.plan?.tasks?.map((t,i)=>{const record=data.approvals.flatMap(a=>a.payload.effects).flatMap(e=>e.records).find(r=>r.fields.name?.after===t.title);return <dl key={i}><div><dt>{m.before}</dt><dd>{String(record?.fields.name.before??m.none)}</dd></div><div><dt>{m.after}</dt><dd>{t.title} · {data.members.find(x=>x.id===t.owner)?.display_name??m.unassigned} · {t.due?date(t.due):m.none}</dd></div></dl>;})}{!data.run.plan?.tasks?.length&&<p>{m.empty}</p>}</section>{data.approvals.filter(a=>a.kind!=='client_email').map(a=><ApprovalCard key={a.id} approval={a} locale={locale} onRefresh={refresh}/>)}</div></div>}
    {tab==='findings'&&findings}
    {tab==='inputs'&&<div>{data.inputs.map(i=><div className="input-row" key={i.id}><span>{i.label}</span><span>{m.statuses[i.status as keyof typeof m.statuses]??m.none}</span></div>)}</div>}
    {tab==='history'&&timeline}
    {tab==='emails'&&<div>{data.approvals.filter(a=>a.payload.effects.some(e=>e.message)).map(a=><ApprovalCard key={a.id} approval={a} locale={locale} onRefresh={refresh}/>)}{!data.approvals.some(a=>a.payload.effects.some(e=>e.message))&&<p>{m.empty}</p>}</div>}
    {tab==='clickup'&&<section><h2>{m.live}</h2>{tasks?<><p>{m.readAt}: <time>{date(tasks.readAt)}</time></p><div className="task-list">{tasks.tasks.map(t=><article key={t.id}><h3>{t.name}</h3><dl><div><dt>{m.tasks[1]}</dt><dd>{t.assignees?.map(a=>{const external=String(typeof a==='number'?a:a.id);return data.members.find(x=>x.clickup_user_id===external)?.display_name??(typeof a==='object'?a.username:null)??m.unassigned;}).join(', ')||m.unassigned}</dd></div><div><dt>{m.tasks[2]}</dt><dd>{t.due_date?date(new Date(Number(t.due_date)).toISOString()):m.none}</dd></div><div><dt>{m.tasks[3]}</dt><dd>{m.statuses[t.status?.status as keyof typeof m.statuses]??t.status?.status??m.none}</dd></div></dl></article>)}</div>{!tasks.tasks.length&&<p>{m.noTasks}</p>}</>:<p>{error||m.loading}</p>}</section>}
    {data.isDemo&&<section className="demo-controls"><h2>{m.demoControls}</h2><button className="button" disabled={busy} onClick={runReplay}>{m.replay}</button>{replay&&<p role="status">{replay}</p>}</section>}
  </section>;
}
function showEvidence(evidence:Record<string,unknown>|Record<string,unknown>[]|null,key:string,empty:string):string {
  if(Array.isArray(evidence))return evidence.map(row=>showEvidence(row,key,empty)).join('\n');
  const aliases:Record<string,string[]>= {source:['source','source_page','page'],quote:['quote','source_quote','pdfQuote'],current:['current','record_ref','hubspot','lineItems','actual'],rule:['rule','rule_id','reason']};
  const value=aliases[key].map(k=>evidence?.[k]).find(v=>v!==undefined);
  return value===undefined?empty:typeof value==='object'?JSON.stringify(value):String(value);
}

function localizeDetail(data:Detail,locale:Language):Detail {
  if(!data.isDemo)return data;
  const names=loadMessages(locale).demo.people,english=loadMessages('en').demo.people;
  function name(value:string) {const persona=demoPeople.find(person=>english[person.id]===value);return persona?names[persona.id]:value;}
  return {...data,members:data.members.map(member=>({...member,display_name:name(member.display_name)})),history:data.history.map(event=>({...event,actor_name_at_event:name(event.actor_name_at_event)}))};
}
