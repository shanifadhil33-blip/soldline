import Link from 'next/link';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { PathTour } from '../../../components/path-tour';
import { demoPeople } from '../../../lib/demo-personas';
import { getLanguage } from '../../../lib/locale';
import { loadMessages } from '../../../lib/i18n';
import { cookieName, verifyDemo } from '../../../server/demo/cookie';
import { getMemberFromCookies } from '../../../server/session';

export default async function Page() {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  const jar = await cookies();
  const ticket = verifyDemo(jar.get(cookieName)?.value, process.env.DEMO_SIGNING_KEY ?? '');
  const persona = ticket ? demoPeople.find(person => person.id === ticket.persona) : null;
  const member = persona ? null : await getMemberFromCookies();
  if (!persona && !member) redirect('/sign-in');
  const reviewer = persona ? persona.role === 'client_reviewer' : member!.roles.includes('client_reviewer');
  const name = persona ? m.demo.people[persona.id] : member!.display_name;
  const steps = reviewer ? m.demo.stepsReviewer : m.demo.stepsStaff;
  const pastels = ['welcome-clay', 'welcome-sage', 'welcome-sky'];
  return <section className="screen welcome">
    <p className="muted">{reviewer ? m.demo.roles.client_reviewer : persona ? m.demo.roles[persona.role] : m.shell.workspace}</p>
    <h1>{m.demo.hello.replace('{name}', name)}</h1>
    <p className="welcome-lead">{reviewer ? m.demo.welcomeReviewer : m.demo.welcomeStaff}</p>
    <ol className="welcome-steps">
      {steps.map((step, index) => <li key={step} className={pastels[index]}><span>{index + 1}</span><p>{step}</p></li>)}
    </ol>
    <Link className="button primary welcome-go" data-tour="start" prefetch href={reviewer ? '/home' : '/today'}>{reviewer ? m.demo.seeHandover : m.demo.open}</Link>
    <PathTour locale={locale} reviewer={reviewer} />
  </section>;
}
