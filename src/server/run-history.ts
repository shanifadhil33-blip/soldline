import 'server-only';
import type { TransactionDriver } from './db/withMember';
import type { Member } from './permissions';

/** Run history is visible to anyone who can already open the project. */
export function runHistory(owner: TransactionDriver) {
  return async (member: Member, runId: string) => owner.transaction(async db => {
    const visible = (await db.query('SELECT id FROM runs WHERE workspace_id=$1 AND id=$2', [member.workspace_id, runId])).rows[0];
    if (!visible) return [];
    return (await db.query("SELECT id,at,action,outcome,actor_name_at_event FROM audit_log WHERE workspace_id=$1 AND (target_id=$2 OR approval_id IN (SELECT id FROM approvals WHERE workspace_id=$1 AND run_id=$2::uuid)) ORDER BY id", [member.workspace_id, runId])).rows;
  });
}
