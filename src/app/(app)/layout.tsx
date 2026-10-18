import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { demoPeople } from '../../lib/demo-personas';
import { getLanguage } from '../../lib/locale';
import { loadMessages } from '../../lib/i18n';
import { getMember } from '../../server/session';
import { getAppDriver } from '../../server/db/runtime';
import { withMember } from '../../server/db/withMember';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLanguage(); const m = loadMessages(locale);
  const member = await getMember(await cookies());
  if (!member) redirect('/sign-in');
  const workspace = await withMember(getAppDriver(), member.id, async db => {
    const result = await db.query<{ name: string }>('SELECT name FROM workspaces WHERE id=$1', [member.workspace_id]);
    return result.rows[0]?.name || m.shell.workspaceFallback;
  });
  // Ids stay in browser safe code. The session remains the source of role and identity.
  const persona = member.is_demo ? demoPeople.find(person => loadMessages('en').demo.people[person.id] === member.display_name)?.id : undefined;
  return <AppShell locale={locale} workspace={workspace} name={persona ? m.demo.people[persona] : member.display_name} isDemo={member.is_demo} reviewer={member.roles.includes('client_reviewer')} persona={persona}>{children}</AppShell>;
}
