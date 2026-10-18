import Link from 'next/link';
import { demoPeople } from '../lib/demo-personas';
import type { RunRow } from '../server/screens';
import { loadMessages, type Language } from '../lib/i18n';
export function RunList({runs,locale}:{runs:RunRow[];locale:Language}) {
  const m=loadMessages(locale).screens;
  const date=(value:string|null)=>value?new Intl.DateTimeFormat(`${locale}-u-nu-latn`,{dateStyle:'medium'}).format(new Date(value)):m.none;
  const owner=(run:RunRow)=>{const persona=run.is_demo?demoPeople.find(person=>loadMessages('en').demo.people[person.id]===run.owner):undefined;return persona?loadMessages(locale).demo.people[persona.id]:run.owner??m.unassigned;};
  const cells=(run:RunRow)=>[run.client,run.deal,m.statuses[run.status as keyof typeof m.statuses]??m.none,date(run.won),date(run.ready),owner(run)];
  return <><table className="runs-table"><thead><tr>{m.columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{runs.map(run=><tr key={run.id}>{cells(run).map((cell,i)=><td key={i}>{i===1?<Link href={`/runs/${run.id}`}>{cell}</Link>:cell}</td>)}</tr>)}</tbody></table><div className="runs-phone">{runs.map(run=><article key={run.id}><Link href={`/runs/${run.id}`}>{run.deal}</Link><dl>{cells(run).map((cell,i)=><div key={i}><dt>{m.columns[i]}</dt><dd>{cell}</dd></div>)}</dl></article>)}</div>{!runs.length&&<p>{m.noRuns}</p>}</>;
}
