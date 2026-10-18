import Link from 'next/link';
import { screenData,readRuns } from '../../../server/screens';
import { runMetrics } from '../../../server/metrics';
import { getLanguage } from '../../../lib/locale';
import { loadMessages,formatNumber } from '../../../lib/i18n';
export default async function Page() {
  const locale=await getLanguage(),m=loadMessages(locale),s=m.screens;
  const data=await screenData(async(db,member)=>({runs:await readRuns(db),metrics:await runMetrics(db,member.workspace_id),approvals:(await db.query<{run_id:string}>(`SELECT run_id FROM approvals WHERE status IN ('pending','approved','stale') AND required_roles && $1::text[] AND (requested_by_type='agent' OR requested_by_member_id IS DISTINCT FROM $2::uuid)`,[member.roles,member.id])).rows,recovery:(await db.query<{run_id:string;title:string}>("SELECT run_id,title FROM recovery_items WHERE owner_member_id=$1 AND status IN ('open','retrying')",[member.id])).rows,inputs:(await db.query<{run_id:string;label:string}>("SELECT i.run_id,i.label FROM onboarding_inputs i JOIN runs r ON r.id=i.run_id WHERE i.status='missing' AND i.requested_at<now()-interval '2 days' AND r.delivery_lead_id=$1",[member.id])).rows,member:member.id,owned:(await db.query<{id:string}>("SELECT id FROM runs WHERE delivery_lead_id=$1 AND status IN ('blocked','partly_done')",[member.id])).rows}));
  const groups=[{title:s.waiting,items:data.approvals.map(a=>({id:a.run_id,label:data.runs.find(r=>r.id===a.run_id)?.deal??s.approval}))},{title:s.blocked,items:data.owned.map(r=>({id:r.id,label:data.runs.find(x=>x.id===r.id)?.deal??s.blocked}))},{title:s.recovery,items:data.recovery.map(r=>({id:r.run_id,label:r.title}))},{title:s.oldInputs,items:data.inputs.map(i=>({id:i.run_id,label:i.label}))}];
  const hours=data.metrics.map(x=>Number(x.won_to_ready_hours)).filter(x=>x>0);
  const metrics=[data.runs.length,data.approvals.length,data.owned.length,hours.length?Math.round(hours.reduce((a,b)=>a+b,0)/hours.length):0];
  return <section className="screen"><h1>{m.nav.today}</h1><div className="metric-strip">{metrics.map((n,i)=><div key={i}><strong>{formatNumber(n,locale)}</strong><span>{s.metrics[i]}</span></div>)}</div><h2>{s.needsAction}</h2>{groups.map(g=><section className="action-group" key={g.title}><h3>{g.title}</h3>{g.items.length?g.items.map((item,i)=><Link key={i} href={`/runs/${item.id}`}>{item.label}</Link>):<p className="muted">{s.allClear}</p>}</section>)}</section>;
}
