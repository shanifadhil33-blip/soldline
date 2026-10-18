import type { SqlConnection } from './db/withMember';

export interface AuditEvent {
  action: string;
  outcome: 'allowed' | 'denied' | 'succeeded' | 'failed';
  target_type?: string;
  target_id?: string;
  before?: unknown;
  after?: unknown;
  approval_id?: string;
  effect_id?: string;
  request_id?: string;
}
export async function append(db: SqlConnection, workspaceId: string, event: AuditEvent): Promise<number> {
  const result = await db.query<{ id: number }>('SELECT audit_append($1::uuid, $2::jsonb) AS id', [workspaceId, JSON.stringify(event)]);
  return Number(result.rows[0].id);
}

/** Use an owner connection for a complete chain. Request connections require admin visibility. */
export async function verifyChain(db: SqlConnection, workspaceId: string): Promise<{ ok: boolean; brokenAtId: number | null }> {
  const permission = await db.query<{ allowed: boolean }>(`SELECT current_user <> 'soldline_app' OR ('admin' = ANY(app_roles($1::uuid)) AND NOT ('client_reviewer' = ANY(app_roles($1::uuid)))) AS allowed`, [workspaceId]);
  if (!permission.rows[0].allowed) throw new Error('Audit access refused');
  const result = await db.query<{ id: number; prev_hash: string | null; row_hash: string; expected: string }>(
    'SELECT id, prev_hash, row_hash, audit_row_hash(audit_log) AS expected FROM audit_log WHERE workspace_id = $1 ORDER BY id', [workspaceId]);
  let previous: string | null = null;
  for (const row of result.rows) {
    if (row.prev_hash !== previous || row.row_hash !== row.expected) return { ok: false, brokenAtId: Number(row.id) };
    previous = row.row_hash;
  }
  return { ok: true, brokenAtId: null };
}
