import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { demoPeople } from '../../lib/demo-personas';
import { getLanguage } from '../../lib/locale';
import { loadMessages } from '../../lib/i18n';
import { cookieName, verifyDemo } from '../../server/demo/cookie';
import { getMember } from '../../server/session';
import { getAppDriver } from '../../server/db/runtime';
import { withMember } from '../../server/db/withMember';
import { readDemoCache, writeDemoCache } from '../../server/demo/read-cache';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  const jar = await cookies();
  const ticket = verifyDemo(jar.get(cookieName)?.value, process.env.DEMO_SIGNING_KEY ?? '');
  if (ticket) {
    const persona = demoPeople.find(person => person.id === ticket.persona);
    const reviewer = persona?.role === 'client_reviewer';
    return <AppShell locale={locale} workspace="Northlight Studio" name={m.demo.people[ticket.persona]} isDemo reviewer={reviewer} persona={ticket.persona}>{children}</AppShell>;
  }
  const member = await getMember(jar);
  if (!member) redirect('/sign-in');
  const cached = readDemoCache<string>(member.workspace_id, 'workspace-name');
  const workspace = cached ?? await withMember(getAppDriver(), member.id, async db => {
    const result = await db.query<{ name: string }>('SELECT name FROM workspaces WHERE id=$1', [member.workspace_id]);
    return result.rows[0]?.name || m.shell.workspaceFallback;
  });
  if (member.is_demo && !cached) writeDemoCache(member.workspace_id, 'workspace-name', workspace, 60_000);
  const persona = member.is_demo ? demoPeople.find(person => loadMessages('en').demo.people[person.id] === member.display_name)?.id : undefined;
  return <AppShell locale={locale} workspace={workspace} name={persona ? m.demo.people[persona] : member.display_name} isDemo={member.is_demo} reviewer={member.roles.includes('client_reviewer')} persona={persona}>{children}</AppShell>;
}
