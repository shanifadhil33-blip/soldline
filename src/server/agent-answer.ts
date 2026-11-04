import 'server-only';
import type { SqlConnection } from './db/withMember';
import type { Member } from './permissions';
import { loadMessages, type Language } from '../lib/i18n';
import { demoPhrase } from '../lib/plain';

export type DirectAnswer = { text: string; link: { href: string; label: string } };

/** A plain answer about one project, when the question names it: what is missing, what is open and what waits for a decision. Counts come from the same rules as Today. */
export async function directAnswer(db: SqlConnection, m: Member, question: string, language: Language): Promise<DirectAnswer | null> {
  if (m.roles.includes('client_reviewer')) return null;
  const text = question.toLowerCase();
  const runs = (await db.query<{ id: string; name: string }>('SELECT r.id,d.name FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 ORDER BY d.name', [m.workspace_id])).rows;
  const run = runs.find(r => { const first = r.name.toLowerCase().split(/\s+/)[0]; return text.includes(r.name.toLowerCase()) || (first.length > 2 && text.includes(first)); });
  if (!run) return null;
  const a = loadMessages(language).flow.agentAnswer;
  const list = new Intl.ListFormat(language, { style: 'long', type: 'conjunction' });
  const phrase = (value: string) => demoPhrase(value, language);
  const name = phrase(run.name);
  const missing = (await db.query<{ label: string }>("SELECT label FROM onboarding_inputs WHERE workspace_id=$1 AND run_id=$2 AND status='missing' ORDER BY label", [m.workspace_id, run.id])).rows.map(r => phrase(r.label));
  const fixes = (await db.query<{ title: string }>("SELECT title FROM recovery_items WHERE workspace_id=$1 AND run_id=$2 AND status IN ('open','retrying') ORDER BY created_at,id", [m.workspace_id, run.id])).rows.map(r => phrase(r.title));
  const waiting = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM approvals WHERE workspace_id=$1 AND run_id=$2 AND status IN ('pending','stale')", [m.workspace_id, run.id])).rows[0].n;
  const parts: string[] = [];
  if (missing.length) parts.push(a.inputs.replace('{list}', list.format(missing)));
  if (fixes.length) parts.push(a.fixes.replace('{list}', list.format(fixes)));
  if (waiting) parts.push(a.approval);
  const body = parts.length ? a.intro.replace('{project}', name) + ' ' + parts.join(' ') : a.none.replace('{project}', name);
  return { text: body, link: { href: `/runs/${run.id}`, label: a.open.replace('{project}', name) } };
}
