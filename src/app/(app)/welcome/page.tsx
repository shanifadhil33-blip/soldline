import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { demoPeople } from '../../../lib/demo-personas';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { cookieName, verifyDemo } from '../../../server/demo/cookie';
import { getMemberFromCookies } from '../../../server/session';
import { readRuns, screenData } from '../../../server/screens';
import { capitalise } from '../../../lib/plain';

/** After choosing a person: who you are, and exactly one thing to do next. */
export default async function Page() {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  const w = m.welcome;
  const jar = await cookies();
  const ticket = verifyDemo(jar.get(cookieName)?.value, process.env.DEMO_SIGNING_KEY ?? '');
  const persona = ticket ? demoPeople.find(person => person.id === ticket.persona) : null;
  const member = persona ? null : await getMemberFromCookies();
  if (!persona && !member) redirect('/sign-in');
  const reviewer = persona ? persona.role === 'client_reviewer' : member!.roles.includes('client_reviewer');
  const name = persona ? m.demo.people[persona.id] : capitalise(member!.display_name);
  const first = name.split(' ')[0];
  const role = persona ? m.demo.roles[persona.role] : m.shell.workspace;
  let href = reviewer ? '/home' : '/today';
  let action = reviewer ? w.reviewer.action : w.worker.action;
  let lead = reviewer ? w.reviewer.lead : w.worker.lead;
  if (persona && !reviewer && persona.role !== 'contributor') {
    const runs = await screenData(readRuns, 'runs');
    const harbor = runs.find(run => run.deal.startsWith('Harbor'));
    if (harbor) { href = `/runs/${harbor.id}`; action = w.lead.action; lead = w.lead.lead; }
  }
  return <section className="screen welcome">
    {persona && <img className="welcome-photo" src={`/people/${persona.id}.svg`} alt="" width={96} height={96} />}
    <p className="muted">{role}</p>
    <h1>{m.demo.hello.replace('{name}', first)}</h1>
    <p className="welcome-lead">{lead}</p>
    <Link className="button primary welcome-go" href={href} prefetch>{action}</Link>
  </section>;
}
