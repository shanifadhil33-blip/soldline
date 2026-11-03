import Link from 'next/link';
import { screenData } from '../../../server/screens';
import { readToday } from '../../../server/today';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { AgentPanel } from '../../../components/agent-panel';
export default async function Page() {
  const locale=await getLanguage(),m=loadMessages(locale),s=m.screens;
  const data=await screenData((db,member)=>readToday(db,member));
  const groups=[{title:s.waiting,items:data.approvals.map(a=>({id:a.run_id,label:data.runs.find(r=>r.id===a.run_id)?.deal??s.approval}))},{title:s.blocked,items:data.owned.map(r=>({id:r.id,label:data.runs.find(x=>x.id===r.id)?.deal??s.blocked}))},{title:s.recovery,items:data.recovery.map(r=>({id:r.run_id,label:r.title}))},{title:s.oldInputs,items:data.inputs.map(i=>({id:i.run_id,label:i.label}))}];
  return <section className="screen"><h1>{m.nav.today}</h1><h2 id="needs">{s.needsAction}</h2>{groups.map(g=><section className="action-group" key={g.title}><h3>{g.title}</h3>{g.items.length?g.items.map((item,i)=><Link key={i} href={`/runs/${item.id}`}>{item.label}</Link>):<p className="muted">{s.allClear}</p>}</section>)}<AgentPanel locale={locale} /></section>;
}
