import Link from 'next/link';
import { screenData } from '../../../server/screens';
import { readToday } from '../../../server/today';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { demoPhrase, statusWord } from '../../../lib/plain';

type Row = { id: string; href: string; title: string; status: string; note: string };

export default async function Page() {
  const locale = await getLanguage(), m = loadMessages(locale), s = m.screens;
  const data = await screenData((db, member) => readToday(db, member), 'today');
  const label = (value: string) => demoPhrase(value, locale);
  const day = (value: string | null | undefined) => value ? new Intl.DateTimeFormat(`${locale}-u-nu-latn`, { dateStyle: 'medium' }).format(new Date(value)) : '';
  const run = (id: string) => data.runs.find(item => item.id === id);
  const deal = (id: string, fallback: string) => { const name = run(id)?.deal; return name ? label(name) : fallback; };
  const note = (template: string, value: string | null | undefined) => value ? template.replace('{date}', day(value)) : '';
  const groups: { title: string; rows: Row[] }[] = [
    { title: s.waiting, rows: data.approvals.map((a, i) => ({ id: `a${i}`, href: `/runs/${a.run_id}`, title: deal(a.run_id, s.approval), status: statusWord(a.status === 'pending' ? 'waiting_approval' : a.status, locale), note: note(s.decideBy, a.expires_at) })) },
    { title: s.blocked, rows: data.owned.map((r, i) => ({ id: `o${i}`, href: `/runs/${r.id}`, title: deal(r.id, s.blocked), status: statusWord(run(r.id)?.status ?? 'blocked', locale), note: note(s.won, run(r.id)?.won) })) },
    { title: s.recovery, rows: data.recovery.map((r, i) => ({ id: `r${i}`, href: '/recovery', title: label(r.title), status: statusWord('open', locale), note: note(s.opened, r.created_at) })) },
    { title: s.oldInputs, rows: data.inputs.map((x, i) => ({ id: `i${i}`, href: `/runs/${x.run_id}?tab=inputs`, title: label(x.label), status: statusWord('missing', locale), note: note(s.asked, x.requested_at) })) },
  ];
  const first = data.approvals[0];
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
  return <section className="screen">
    <div className="page-head"><h1>{m.nav.today}</h1>{first && <Link className="button primary" href={`/runs/${first.run_id}`} prefetch>{s.reviewPlan}</Link>}</div>
    {total === 0 && <p className="muted">{s.allClear}</p>}
    {groups.filter(group => group.rows.length > 0).map(group => <section className="list-group" key={group.title}>
      <h2 className="list-title">{group.title} <span className="count-badge" aria-label={String(group.rows.length)}>{new Intl.NumberFormat(`${locale}-u-nu-latn`).format(group.rows.length)}</span></h2>
      <ul className="record-list">{group.rows.map(row => <li key={row.id}><Link className="row-link" href={row.href} prefetch>
        <span className="row-text"><strong>{row.title}</strong>{row.note && <span className="muted">{row.note}</span>}</span>
        <span className="status-chip">{row.status}</span>
        <svg className="chevron go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </Link></li>)}</ul>
    </section>)}
  </section>;
}
