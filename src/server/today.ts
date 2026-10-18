import 'server-only';
import type { SqlConnection } from './db/withMember';
import type { Member } from './permissions';
import { readRuns } from './screens';
import { runMetrics } from './metrics';
/** Today reads every queue with the same rules as run status, so counts and lists always agree. */
export async function readToday(db:SqlConnection,member:Member) {
  return {runs:await readRuns(db),metrics:await runMetrics(db,member.workspace_id),approvals:(await db.query<{run_id:string}>(`SELECT run_id FROM approvals WHERE status IN ('pending','approved','stale') AND required_roles && $1::text[] AND (requested_by_type='agent' OR requested_by_member_id IS DISTINCT FROM $2::uuid)`,[member.roles,member.id])).rows,recovery:(await db.query<{run_id:string;title:string}>("SELECT run_id,title FROM recovery_items WHERE owner_member_id=$1 AND status IN ('open','retrying')",[member.id])).rows,inputs:(await db.query<{run_id:string;label:string}>("SELECT i.run_id,i.label FROM onboarding_inputs i JOIN runs r ON r.id=i.run_id AND r.workspace_id=i.workspace_id JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE i.status='missing' AND i.requested_at<now()-interval '3 days' AND (r.delivery_lead_id=$1 OR d.owner_member_id=$1) ORDER BY i.requested_at,i.id",[member.id])).rows,member:member.id,owned:(await db.query<{id:string}>("SELECT r.id FROM runs r JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE (r.delivery_lead_id=$1 OR d.owner_member_id=$1) AND r.status IN ('blocked','partly_done')",[member.id])).rows};
}
