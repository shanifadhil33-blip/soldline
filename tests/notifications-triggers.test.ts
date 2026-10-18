import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, fixture, id } from './helpers/pglite';
let ctx: Awaited<ReturnType<typeof createDatabase>>;
const f = fixture(1), g = fixture(2);
beforeAll(async () => { ctx = await createDatabase(); }, 60000);
afterAll(async () => { await ctx?.db.close(); });
const kinds = async (member: string, kind: string) => (await ctx.db.query<{ body: string; link: string; actor_member_id: string | null }>('SELECT body,link,actor_member_id FROM notifications WHERE member_id=$1 AND kind=$2', [member, kind])).rows;

it('A new approval notifies every member who can approve it, never the requester or a client reviewer', async () => {
  await ctx.db.query("UPDATE runs SET delivery_lead_id=$2 WHERE id=$1", [f.runA, f.lead]);
  await ctx.db.query(`INSERT INTO approvals(id,workspace_id,run_id,kind,requested_by_type,requested_by_member_id,required_roles,status,payload,payload_hash,input_refs,input_hash,reversibility,expires_at)
    VALUES($1,$2,$3,'provision','user',$4,ARRAY['admin','delivery_lead','client_reviewer'],'pending','{}','x','[]','x','reversible',now()+interval '1 day')`, [id(1, 80), f.ws, f.runA, f.admin]);
  expect(await kinds(f.lead, 'approval')).toEqual([{ body: 'An approval is waiting for you', link: `/runs/${f.runA}`, actor_member_id: f.admin }]);
  expect(await kinds(f.admin, 'approval')).toEqual([]);
  expect(await kinds(f.reviewer, 'approval')).toEqual([]);
  expect(await kinds(g.lead, 'approval')).toEqual([]);
});

it('A decision notifies the requester and the account manager; stale notifies approvers once', async () => {
  await ctx.db.query("UPDATE approvals SET status='approved',decided_by=$2 WHERE id=$1", [id(1, 80), f.lead]);
  expect((await kinds(f.admin, 'approval_decided'))[0].body).toBe('Your approval request was approved');
  expect((await kinds(f.manager, 'approval_decided'))[0].body).toBe('An approval on your client was approved');
  expect(await kinds(f.lead, 'approval_decided')).toEqual([]);
  await ctx.db.query("UPDATE approvals SET status='stale' WHERE id=$1", [id(1, 80)]);
  await ctx.db.query("UPDATE approvals SET status='stale',stale_reason='again' WHERE id=$1", [id(1, 80)]);
  expect(await kinds(f.lead, 'approval_stale')).toHaveLength(1);
});

it('Recovery items notify the owner when opened and the account manager and delivery lead when resolved, in their language', async () => {
  await ctx.db.query("UPDATE members SET language='ar' WHERE id=$1", [f.manager]);
  await ctx.db.query("INSERT INTO recovery_items(id,workspace_id,run_id,kind,title,plain_reason,owner_member_id,status) VALUES($1,$2,$3,'job_failed','Retry tasks','ClickUp was down',$4,'open')", [id(1, 81), f.ws, f.runA, f.contributor]);
  expect(await kinds(f.contributor, 'recovery')).toHaveLength(1);
  await ctx.db.query("UPDATE recovery_items SET status='resolved',resolved_by=$2 WHERE id=$1", [id(1, 81), f.contributor]);
  expect((await kinds(f.manager, 'recovery_resolved'))[0].body).toBe('تم إصلاح أمر يخص عميلك');
  expect(await kinds(f.lead, 'recovery_resolved')).toHaveLength(1);
  expect(await kinds(f.contributor, 'recovery_resolved')).toEqual([]);
});

it('Client input, client review and a lost connection reach the right staff only', async () => {
  await ctx.db.query("UPDATE onboarding_inputs SET status='received' WHERE run_id=$1", [f.runA]);
  await ctx.db.query("UPDATE monitor_tasks SET client_approved_at=now(),client_approved_by=$2 WHERE run_id=$1", [f.runA, f.reviewer]);
  expect((await kinds(f.lead, 'client_step')).map(n => n.body).sort()).toEqual(['The client approved a deliverable', 'The client supplied an input']);
  expect(await kinds(f.reviewer, 'client_step')).toEqual([]);
  await ctx.db.query("UPDATE connections SET status='needs_reconnect' WHERE workspace_id=$1", [f.ws]);
  expect((await kinds(f.admin, 'connection'))[0].link).toBe('/connections');
  expect(await kinds(f.manager, 'connection')).toEqual([]);
});

it('Members read and mark only their own notifications', async () => {
  const seen = await ctx.asMember(f.lead, db => db.query<{ member_id: string }>('SELECT member_id FROM notifications'));
  expect(seen.rows.length).toBeGreaterThan(0); expect(seen.rows.every(r => r.member_id === f.lead)).toBe(true);
  const marked = await ctx.asMember(f.lead, db => db.query('UPDATE notifications SET read_at=now() WHERE read_at IS NULL RETURNING member_id'));
  expect(marked.rows.length).toBe(seen.rows.length);
  expect((await ctx.db.query('SELECT count(*)::int AS n FROM notifications WHERE member_id=$1 AND read_at IS NULL', [f.manager])).rows[0]).toEqual({ n: expect.any(Number) });
  expect(Number((await ctx.db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE member_id=$1 AND read_at IS NOT NULL', [f.manager])).rows[0].n)).toBe(0);
});
