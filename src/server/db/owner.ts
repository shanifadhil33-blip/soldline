import 'server-only';
import { trustStore } from '../trust';
import { runTaskReader } from '../run-tasks';
import { monitorStore } from '../monitors/store';
import { memoryStore } from '../memory/store';
import { recoveryStore } from '../recovery/store';
import { approvalStore } from '../approvals/store';
import { scopeStore } from '../scope/store';
import { jobStore } from '../jobs/store';
import { systemProviders } from '../jobs/providers';
import { randomUUID } from 'node:crypto';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { Adapter } from 'next-auth/adapters';
import { can, type Member } from '../permissions';
import { verifyChain } from '../audit';
import type { SqlConnection, TransactionDriver } from './withMember';
import { authTables } from './authSchema';
import { demoStore } from '../demo/store';

function adapterFor(db: SqlConnection, workspace: string): Adapter {
  const client = drizzle(async (sql, params) => {
    if (!db.queryArrays) throw new Error('Owner adapter requires ordered database rows');
    return db.queryArrays(sql, params);
  });
  return DrizzleAdapter(client, authTables(workspace));
}
/** The owner driver is private. Consumers receive only the named demo and Auth.js operations. */
export function ownerServices(owner: TransactionDriver) {
  const lookup = async (db: SqlConnection, column: 'id' | 'email', value: string) => {
    const result = await db.query<{ workspace_id: string }>(`SELECT u.workspace_id FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.${column}=$1 AND coalesce(w.is_demo,false)=false`, [value]);
    return result.rows[0]?.workspace_id;
  };
  const authAdapter: Adapter = {
    createUser: data => owner.transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock(710182028)');
      const workspace = randomUUID();
      await db.query('INSERT INTO workspaces (id,workspace_id,name,is_demo) VALUES ($1,$1,$2,false)', [workspace, 'My workspace']);
      const user = await adapterFor(db, workspace).createUser!(data);
      await db.query("INSERT INTO members (workspace_id,user_id,display_name,roles) VALUES ($1,$2,$3,ARRAY['admin'])", [workspace, user.id, user.name ?? 'Member']);
      return user;
    }),
    getUser: id => owner.transaction(async db => { const ws = await lookup(db, 'id', id); return ws ? adapterFor(db, ws).getUser!(id) : null; }),
    getUserByEmail: email => owner.transaction(async db => { const ws = await lookup(db, 'email', email); return ws ? adapterFor(db, ws).getUserByEmail!(email) : null; }),
    getUserByAccount: account => owner.transaction(async db => {
      const rows = await db.query<{ workspace_id: string }>('SELECT a.workspace_id FROM accounts a JOIN workspaces w ON w.id=a.workspace_id WHERE provider=$1 AND provider_account_id=$2 AND coalesce(w.is_demo,false)=false', [account.provider, account.providerAccountId]);
      return rows.rows[0] ? adapterFor(db, rows.rows[0].workspace_id).getUserByAccount!(account) : null;
    }),
    updateUser: data => owner.transaction(async db => { const ws = await lookup(db, 'id', data.id); if (!ws) throw new Error('User not found'); return adapterFor(db, ws).updateUser!(data); }),
    linkAccount: data => owner.transaction(async db => {
      if (data.provider !== 'google') throw new Error('Provider refused');
      const ws = await lookup(db, 'id', data.userId); if (!ws) throw new Error('User not found');
      await adapterFor(db, ws).linkAccount!(data);
    }),
    createSession: data => owner.transaction(async db => { const ws = await lookup(db, 'id', data.userId); if (!ws) throw new Error('User not found'); return adapterFor(db, ws).createSession!(data); }),
    getSessionAndUser: token => owner.transaction(async db => {
      const result = await db.query<{ workspace_id: string }>('SELECT s.workspace_id FROM sessions s JOIN workspaces w ON w.id=s.workspace_id WHERE session_token=$1 AND coalesce(w.is_demo,false)=false', [token]);
      return result.rows[0] ? adapterFor(db, result.rows[0].workspace_id).getSessionAndUser!(token) : null;
    }),
    updateSession: data => owner.transaction(async db => {
      const result = await db.query<{ workspace_id: string; user_id: string }>('SELECT s.workspace_id,s.user_id FROM sessions s JOIN workspaces w ON w.id=s.workspace_id WHERE session_token=$1 AND coalesce(w.is_demo,false)=false', [data.sessionToken]);
      if (!result.rows[0] || (data.userId && data.userId !== result.rows[0].user_id)) return null;
      return adapterFor(db, result.rows[0].workspace_id).updateSession!(data);
    }),
    deleteSession: token => owner.transaction(async db => { await db.query('DELETE FROM sessions s USING workspaces w WHERE w.id=s.workspace_id AND coalesce(w.is_demo,false)=false AND session_token=$1', [token]); }),
  };
  return {
    trust: trustStore(owner), readRunTasks: runTaskReader(owner), monitors: monitorStore(owner), memory: memoryStore(owner), recovery: recoveryStore(owner), approvals: approvalStore(owner), scope: scopeStore(owner), demo: demoStore(owner), authAdapter, jobs: jobStore(owner), providers: systemProviders(owner),
    async auditRun(member:Member,runId:string) {
      return owner.transaction(async db=>{
        const actor=(await db.query<Member & Record<string,unknown>>("SELECT m.*,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())",[member.workspace_id,member.id])).rows[0];
        if(!actor) return null;
        const run=(await db.query<{workspace_id:string;owner_member_id:string|null}>("SELECT r.workspace_id,CASE WHEN ($3 AND r.delivery_lead_id=$4::uuid) OR ($5 AND d.owner_member_id=$4::uuid) THEN $4::uuid END AS owner_member_id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND r.id=$2",[actor.workspace_id,runId,actor.roles.includes('delivery_lead'),actor.id,actor.roles.includes('account_manager')])).rows[0];
        if(!run||!can(actor,'read_audit',run)) return null;
        const chain=await verifyChain(db,actor.workspace_id);
        const rows=(await db.query(`SELECT a.* FROM audit_log a WHERE a.workspace_id=$1 AND (a.target_id=$2::text OR a.approval_id IN (SELECT id FROM approvals WHERE workspace_id=$1 AND run_id=$2::uuid) OR a.target_id IN (SELECT v.id::text FROM scope_versions v JOIN runs r ON r.workspace_id=v.workspace_id AND r.deal_id=v.deal_id WHERE r.workspace_id=$1 AND r.id=$2::uuid UNION SELECT id::text FROM approvals WHERE workspace_id=$1 AND run_id=$2::uuid UNION SELECT id::text FROM jobs WHERE workspace_id=$1 AND run_id=$2::uuid UNION SELECT id::text FROM external_effects WHERE workspace_id=$1 AND run_id=$2::uuid UNION SELECT id::text FROM findings WHERE workspace_id=$1 AND run_id=$2::uuid UNION SELECT id::text FROM inbound_events WHERE workspace_id=$1 AND run_id=$2::uuid)) ORDER BY a.id`,[actor.workspace_id,runId])).rows;
        return {chain,rows};
      });
    },
    async sessionMember(token: string): Promise<Member | null> {
      return owner.transaction(async db => {
        const result = await db.query<Member & Record<string, unknown>>(`SELECT m.id,m.workspace_id,m.display_name,m.roles,m.client_company_id,false AS is_demo FROM sessions s JOIN members m ON m.user_id=s.user_id AND m.workspace_id=s.workspace_id JOIN workspaces w ON w.id=m.workspace_id WHERE s.session_token=$1 AND s.expires > now() AND m.archived_at IS NULL AND coalesce(w.is_demo,false)=false`, [token]);
        return result.rows[0] ?? null;
      });
    },
  };
}
