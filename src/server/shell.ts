import 'server-only';
import { cookies } from 'next/headers';
import { demoPeople, type DemoPersona } from '../lib/demo-personas';
import { getLanguage } from '../lib/locale';
import { loadMessages, type Language } from '../lib/i18n';
import { cookieName, verifyDemo } from './demo/cookie';
import { getMember } from './session';
import { getAppDriver } from './db/runtime';
import { withMember } from './db/withMember';
import { demoCached, readDemoCache, writeDemoCache } from './demo/read-cache';

export type ShellProps = { locale: Language; workspace: string; name: string; isDemo: boolean; reviewer: boolean; limited: boolean; persona?: DemoPersona };

/** Everything the app frame needs for the person who is signed in, or null when nobody is. */
export async function loadShell(): Promise<ShellProps | null> {
  const locale = await getLanguage();
  const m = loadMessages(locale);
  const jar = await cookies();
  const ticket = verifyDemo(jar.get(cookieName)?.value, process.env.DEMO_SIGNING_KEY ?? '');
  if (ticket) {
    const persona = demoPeople.find(person => person.id === ticket.persona);
    // A name saved in Settings shows straight away; until one is saved the sample person's own name is used.
    const own = await getMember(jar);
    const saved = own ? await demoCached(own.workspace_id, `${own.id}:saved-name`, () => withMember(getAppDriver(), own.id, async db => (await db.query<{ preferred_name: string | null }>('SELECT preferred_name FROM members WHERE id=$1', [own.id])).rows[0]?.preferred_name ?? '')) : '';
    const shown = saved && saved.toLowerCase() !== ticket.persona ? saved : m.demo.people[ticket.persona];
    return { locale, workspace: 'Northlight Studio', name: shown, isDemo: true, reviewer: persona?.role === 'client_reviewer', limited: persona?.role === 'contributor', persona: ticket.persona };
  }
  const member = await getMember(jar);
  if (!member) return null;
  const cached = readDemoCache<string>(member.workspace_id, 'workspace-name');
  const workspace = cached ?? await withMember(getAppDriver(), member.id, async db => {
    const result = await db.query<{ name: string }>('SELECT name FROM workspaces WHERE id=$1', [member.workspace_id]);
    return result.rows[0]?.name || m.shell.workspaceFallback;
  });
  if (member.is_demo && !cached) writeDemoCache(member.workspace_id, 'workspace-name', workspace, 60_000);
  const persona = member.is_demo ? demoPeople.find(person => loadMessages('en').demo.people[person.id] === member.display_name)?.id : undefined;
  return { locale, workspace, name: persona ? m.demo.people[persona] : member.display_name, isDemo: member.is_demo, reviewer: member.roles.includes('client_reviewer'), limited: member.roles.length === 1 && member.roles[0] === 'contributor', persona };
}
