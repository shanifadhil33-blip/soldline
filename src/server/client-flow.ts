import 'server-only';
import type { SqlConnection } from './db/withMember';
import { loadMessages, type Language } from '../lib/i18n';
import { demoPhrase, personName } from '../lib/plain';

export type NotifyKey = 'approved' | 'changes' | 'again' | 'inputSent' | 'doneTask';

export function sentence(language: Language, key: NotifyKey, values: { name?: string; title?: string }) {
  const template = loadMessages(language).flow.notify[key];
  return template.replace('{name}', personName(values.name ?? '', language)).replace('{title}', demoPhrase(values.title ?? '', language));
}

/** Writes one notification per person, in that person's own language. Owner access only. */
export async function tellMembers(db: SqlConnection, ws: string, memberIds: (string | null | undefined)[], note: { kind: string; en: string; ar: string; link: string; dedupe: string }, actor: string | null = null) {
  const ids = [...new Set(memberIds.filter((id): id is string => !!id && id !== actor))];
  if (!ids.length) return;
  await db.query(
    `INSERT INTO notifications(workspace_id,member_id,kind,body,link,dedupe_key,actor_member_id)
     SELECT $1,m.id,$3,CASE WHEN m.language='ar' THEN $5 ELSE $4 END,$6,$7,$8 FROM members m
     WHERE m.workspace_id=$1 AND m.id=ANY($2::uuid[]) AND m.archived_at IS NULL ON CONFLICT DO NOTHING`,
    [ws, ids, note.kind, note.en, note.ar, note.link, note.dedupe, actor]);
}

/** Everyone on the agency side who looks after one project: the account manager, the delivery lead and the assigned specialists. */
export async function agencyPeopleFor(db: SqlConnection, ws: string, runId: string, taskId?: string) {
  const people = (await db.query<{ manager: string | null; lead: string | null }>(
    'SELECT d.owner_member_id AS manager, r.delivery_lead_id AS lead FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND r.id=$2', [ws, runId])).rows[0];
  const assigned = taskId ? (await db.query<{ id: string }>(
    `SELECT m.id FROM monitor_tasks t JOIN members m ON m.workspace_id=t.workspace_id AND (m.clickup_user_id=ANY(t.assignee_ids) OR m.preferred_name=ANY(t.assignee_ids))
     WHERE t.workspace_id=$1 AND t.run_id=$2 AND t.task_id=$3`, [ws, runId, taskId])).rows.map(row => row.id) : [];
  return [people?.manager, people?.lead, ...assigned];
}

export async function clientPeopleFor(db: SqlConnection, ws: string, runId: string) {
  return (await db.query<{ id: string }>(
    `SELECT m.id FROM members m JOIN deals d ON d.workspace_id=m.workspace_id AND d.client_company_id=m.client_company_id
     JOIN runs r ON r.workspace_id=d.workspace_id AND r.deal_id=d.id WHERE r.workspace_id=$1 AND r.id=$2 AND m.archived_at IS NULL`, [ws, runId])).rows.map(row => row.id);
}

/** The owner has fixed what the client asked for: the work goes back to the client as ready to review again. */
export async function sendBackForReview(db: SqlConnection, ws: string, itemKind: string | null, runId: string | null, actor: string) {
  if (!itemKind?.startsWith('client_changes:') || !runId) return false;
  const taskId = itemKind.slice('client_changes:'.length);
  const task = (await db.query<{ title: string | null }>(
    `UPDATE monitor_tasks t SET status='client review',review_since=now(),client_approved_at=NULL,client_approved_by=NULL
     WHERE t.workspace_id=$1 AND t.run_id=$2 AND t.task_id=$3 RETURNING (SELECT s.title FROM scope_items s WHERE s.workspace_id=t.workspace_id AND s.id=t.scope_item_id) AS title`, [ws, runId, taskId])).rows[0];
  if (!task) return false;
  const title = task.title ?? '';
  await tellMembers(db, ws, await clientPeopleFor(db, ws, runId), {
    kind: 'client_ready', en: sentence('en', 'again', { title }), ar: sentence('ar', 'again', { title }),
    link: `/deliverables/${encodeURIComponent(taskId)}`, dedupe: `ready:${taskId}:${Date.now()}`,
  }, actor);
  return true;
}
