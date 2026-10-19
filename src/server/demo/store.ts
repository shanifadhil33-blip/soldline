import 'server-only';
import { randomUUID } from 'node:crypto';
import type { TransactionDriver } from '../db/withMember';
import type { Member } from '../permissions';
import { lifetime, type DemoTicket } from './cookie';
import { seedSandbox, personas, type Persona } from './seed';
/** Owner access is confined to creating and expiring demo workspaces. No caller supplied seed or SQL. */
export function demoStore(owner: TransactionDriver) {
  return {
    async start(persona: Persona, ticket: DemoTicket | null) {
      if (!Object.hasOwn(personas, persona)) throw new Error('Unknown demo persona');
      return owner.transaction(async db => {
        await db.query('SELECT pg_advisory_xact_lock(710182027)');
        if (ticket) {
          const existing = await db.query<{ id: string; expiry: number }>('SELECT id, extract(epoch FROM demo_expires_at)::bigint AS expiry FROM workspaces WHERE id=$1 AND is_demo=true AND demo_expires_at > now()', [ticket.sandbox]);
          if (existing.rows.length) return { sandbox: existing.rows[0].id, persona, expiry: Number(existing.rows[0].expiry) };
        }
        const live = await db.query<{ id: string }>('SELECT id FROM workspaces WHERE is_demo=true AND demo_expires_at > now() ORDER BY created_at,id');
        const expired = await db.query<{ id: string }>("SELECT id FROM workspaces w WHERE is_demo=true AND demo_expires_at <= now() AND NOT EXISTS (SELECT FROM jobs j WHERE j.workspace_id=w.id AND kind='demo_cleanup')");
        const recycle = [...expired.rows, ...(live.rows.length >= 60 ? live.rows.slice(0, live.rows.length - 59) : [])];
        for (const row of recycle) {
          // Guard both operations even though ids came from a demo only query.
          await db.query('UPDATE workspaces SET demo_expires_at=now() WHERE id=$1 AND is_demo=true', [row.id]);
          await db.query(`INSERT INTO jobs (workspace_id,kind,payload,dedupe_key,status)
            SELECT w.id,'demo_cleanup','{}'::jsonb,'demo_cleanup','queued'
            FROM workspaces w JOIN deals d ON d.workspace_id=w.id
            WHERE w.id=$1 AND w.is_demo=true ORDER BY (d.name LIKE 'Harbor Coffee Roasters%') DESC, d.name LIMIT 1
            ON CONFLICT (workspace_id,dedupe_key) DO NOTHING`, [row.id]);
        }
        const sandbox = randomUUID();
        const expiry = Math.floor(Date.now() / 1000) + lifetime;
        await seedSandbox(db, sandbox, new Date(expiry * 1000));
        return { sandbox, persona, expiry };
      });
    },
    async member(ticket: DemoTicket): Promise<Member | null> {
      return owner.transaction(async db => {
        const result = await db.query<Member & Record<string, unknown>>(`SELECT m.id,m.workspace_id,m.display_name,m.roles,m.client_company_id,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE w.id=$1 AND w.is_demo=true AND w.demo_expires_at > now() AND m.preferred_name=$2 AND m.user_id IS NULL AND m.archived_at IS NULL`, [ticket.sandbox, ticket.persona]);
        return result.rows[0] ?? null;
      });
    },
  };
}
