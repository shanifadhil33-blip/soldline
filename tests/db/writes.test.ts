import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, fixture, id, roles, tables } from '../helpers/pglite';
import { demoStore } from '../../src/server/demo/store';
let context: Awaited<ReturnType<typeof createDatabase>>;
const a = fixture(1), b = fixture(2);
beforeAll(async () => { context = await createDatabase(); }, 60000);
afterAll(async () => { await context?.db.close(); });
it('Guards every public table write privilege through the catalog', async () => {
  const result = await context.db.query<{ relname: string; insert_ok: boolean; update_ok: boolean; delete_ok: boolean }>(`SELECT c.relname,has_table_privilege('soldline_app',c.oid,'INSERT') AS insert_ok,has_table_privilege('soldline_app',c.oid,'UPDATE') AS update_ok,has_table_privilege('soldline_app',c.oid,'DELETE') AS delete_ok FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`);
  expect(result.rows.map(row => row.relname).sort()).toEqual([...tables].sort());
  for (const row of result.rows) {
    expect(row.insert_ok, row.relname).toBe(row.relname === 'onboarding_inputs');
    expect(row.update_ok, row.relname).toBe(row.relname === 'onboarding_inputs');
    expect(row.delete_ok, row.relname).toBe(false);
  }
  expect((await context.db.query("SELECT policyname,with_check FROM pg_policies WHERE tablename='onboarding_inputs' AND policyname IN ('input_insert_guard','input_update_guard')")).rows).toHaveLength(2);
});
it.each(roles)('Refuses workspace insert and retarget writes for %s', async (_role) => {
  const member = id(1, 10 + roles.indexOf(_role));
  await expect(context.asMember(member, db => db.query('INSERT INTO onboarding_inputs (workspace_id,run_id) VALUES ($1,$2)', [b.ws, b.runA]))).rejects.toThrow(/row.level security/);
  await context.asMember(member, async db => {
    expect((await db.query("UPDATE onboarding_inputs SET status='received' WHERE workspace_id=$1 RETURNING id", [b.ws])).rows).toHaveLength(0);
  });
  await expect(context.asMember(member, db => db.query('UPDATE onboarding_inputs SET workspace_id=$1,run_id=$2 WHERE workspace_id=$3 AND run_id=$4', [b.ws,b.runA,a.ws,a.runA]))).rejects.toThrow(/row.level security/);
});
it('Allows every role to mark visible inputs and refuses other company inserts and retargets', async () => {
  for (const member of [a.admin,a.manager,a.lead,a.contributor,a.reviewer]) {
    await context.asMember(member, async db => {
      expect((await db.query("UPDATE onboarding_inputs SET status='received' WHERE run_id=$1 AND key='logo' RETURNING id", [a.runA])).rows).toHaveLength(1);
      expect((await db.query("INSERT INTO onboarding_inputs (workspace_id,run_id,key,status) VALUES ($1,$2,$3,'missing') RETURNING id", [a.ws,a.runA,member])).rows).toHaveLength(1);
    });
  }
  await expect(context.asMember(a.reviewer, db => db.query('INSERT INTO onboarding_inputs (workspace_id,run_id) VALUES ($1,$2)', [a.ws,a.runB]))).rejects.toThrow(/row.level security/);
  await expect(context.asMember(a.reviewer, db => db.query('UPDATE onboarding_inputs SET run_id=$1 WHERE run_id=$2', [a.runB,a.runA]))).rejects.toThrow(/row.level security/);
  await context.asMember(a.reviewer, async db => { expect((await db.query("UPDATE onboarding_inputs SET status='received' WHERE run_id=$1 RETURNING id", [a.runB])).rows).toHaveLength(0); });
  await expect(context.asMember(a.contributor, db => db.query('INSERT INTO onboarding_inputs (workspace_id,run_id) VALUES ($1,$2)', [a.ws,a.runB]))).rejects.toThrow(/row.level security/);
});
it.each(['workspaces','users','accounts','sessions','members','jobs'])('Cannot use the app role for owner writes on %s in a real workspace', async table => {
  await expect(context.asMember(a.admin, db => db.query(`UPDATE ${table} SET workspace_id=$1 WHERE workspace_id=$1`, [a.ws]))).rejects.toThrow(/permission denied/);
  await expect(context.asMember(a.admin, db => db.query(`INSERT INTO ${table} (workspace_id) VALUES ($1)`, [a.ws]))).rejects.toThrow(/permission denied/);
});
it('Does not expose the owner identity trigger function to the app role', async () => {
  expect((await context.db.query("SELECT has_function_privilege('soldline_app','identity_workspace_guard()','EXECUTE') AS allowed")).rows).toEqual([{ allowed: false }]);
});
it('Cannot use sandbox reuse to touch a real workspace', async () => {
  const before = (await context.db.query('SELECT * FROM workspaces WHERE id=$1', [a.ws])).rows;
  const sandbox = await demoStore(context.db).start('faisal', { sandbox: a.ws, persona: 'faisal', expiry: Math.floor(Date.now()/1000) + 60 });
  expect(sandbox.sandbox).not.toBe(a.ws);
  expect((await context.db.query('SELECT * FROM workspaces WHERE id=$1', [a.ws])).rows).toEqual(before);
  expect((await context.db.query("SELECT * FROM jobs WHERE workspace_id=$1 AND kind='demo_cleanup'", [a.ws])).rows).toHaveLength(0);
  await expect(demoStore({ transaction: work => context.asMember(a.admin, work) }).start('faisal', null)).rejects.toThrow(/permission denied/);
});
it('Combines roles for run access without weakening company limits for client only members', async () => {
  await context.db.query("UPDATE members SET roles=ARRAY['client_reviewer','delivery_lead'] WHERE id=$1", [a.reviewer]);
  await context.asMember(a.reviewer, async db => { expect((await db.query('SELECT id FROM runs WHERE id=$1', [a.runB])).rows).toHaveLength(1); });
  await context.db.query("UPDATE members SET roles=ARRAY['client_reviewer'] WHERE id=$1", [a.reviewer]);
  await context.asMember(a.reviewer, async db => { expect((await db.query('SELECT id FROM runs WHERE id=$1', [a.runB])).rows).toHaveLength(0); });
});
