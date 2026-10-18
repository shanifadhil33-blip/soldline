import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, fixture, tables, roles, id } from '../helpers/pglite';
import { migrate } from '../../src/server/db/migrate';

let context: Awaited<ReturnType<typeof createDatabase>>;
beforeAll(async () => { context = await createDatabase(); }, 60000);
afterAll(async () => { await context?.db.close(); });
const a = fixture(1), b = fixture(2);

it('Applies migrations again without changing the schema', async () => { await migrate(context.db); });
it('Forces row security on every public table and keeps the app role separate', async () => {
  const result = await context.db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean; owner: string }>(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')`);
  expect(result.rows.map(r => r.relname).sort()).toEqual([...tables].sort());
  for (const row of result.rows) { expect(row.relrowsecurity).toBe(true); expect(row.relforcerowsecurity).toBe(true); expect(row.owner).not.toBe('soldline_app'); }
  const role = await context.db.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = $1', ['soldline_app']);
  expect(role.rows).toEqual([{ rolbypassrls: false }]);
});
it.each(tables)('Isolates workspace records in %s and proves removal leaks', async (table) => {
  for (let n = 0; n < roles.length; n++) {
    await context.asMember(id(1,10+n), async db => {
      const result = await db.query(`SELECT * FROM ${table} WHERE workspace_id = $1`, [b.ws]);
      expect(result.rows).toHaveLength(0);
    });
  }
  // Scratch mutation proves this assertion detects a leak. Rollback restores both guards.
  const rollback = new Error('Scratch rollback');
  await expect(context.db.transaction(async db => {
    await db.query(`DROP POLICY workspace_guard ON ${table}`);
    await db.query(`DROP POLICY access_guard ON ${table}`);
    await db.query("SELECT set_config('app.member_id',$1,true)", [a.admin]);
    await db.query('SET LOCAL ROLE soldline_app');
    const leaked = await db.query(`SELECT * FROM ${table} WHERE workspace_id=$1`, [b.ws]);
    expect(leaked.rows.length).toBeGreaterThan(0);
    expect(() => expect(leaked.rows).toHaveLength(0)).toThrow();
    throw rollback;
  })).rejects.toBe(rollback);
  await context.asMember(a.admin, async db => { expect((await db.query(`SELECT * FROM ${table} WHERE workspace_id=$1`, [b.ws])).rows).toHaveLength(0); });
});
it.each(['runs','onboarding_inputs','findings'])('Limits client company records in %s and detects a missing guard', async table => {
  const filter = table === 'runs' ? 'id' : 'run_id';
  await context.asMember(a.reviewer, async db => {
    expect((await db.query(`SELECT * FROM ${table} WHERE ${filter}=$1`, [a.runB])).rows).toHaveLength(0);
    expect((await db.query(`SELECT * FROM ${table} WHERE ${filter}=$1`, [a.runA])).rows.length).toBeGreaterThan(0);
  });
  await expect(context.db.transaction(async db => {
    await db.query(`DROP POLICY access_guard ON ${table}`);
    await db.query("SELECT set_config('app.member_id',$1,true)", [a.reviewer]);
    await db.query('SET LOCAL ROLE soldline_app');
    expect((await db.query(`SELECT * FROM ${table} WHERE ${filter}=$1`, [a.runB])).rows.length).toBeGreaterThan(0);
    throw new Error('Scratch rollback');
  })).rejects.toThrow('Scratch rollback');
});
it.each(['audit_log','connections','jobs','inbound_events','external_effects','memories','findings'])('Hides client restricted records in %s', async table => {
  const where = table === 'memories' ? " WHERE scope='org'" : table === 'findings' ? " WHERE kind='unusual_instruction'" : '';
  await context.asMember(a.reviewer, async db => { expect((await db.query(`SELECT * FROM ${table}${where}`)).rows).toHaveLength(0); });
  await expect(context.db.transaction(async db => {
    await db.query(`DROP POLICY access_guard ON ${table}`);
    await db.query("SELECT set_config('app.member_id',$1,true)", [a.reviewer]);
    await db.query('SET LOCAL ROLE soldline_app');
    expect((await db.query(`SELECT * FROM ${table}${where}`)).rows.length).toBeGreaterThan(0);
    throw new Error('Scratch rollback');
  })).rejects.toThrow('Scratch rollback');
});
it.each(['agent_threads','agent_messages','memories','notifications'])('Keeps member records private in %s', async table => {
  await context.asMember(a.admin, async db => { expect((await db.query(`SELECT * FROM ${table} WHERE member_id=$1`,[a.other])).rows).toHaveLength(0); });
  await expect(context.db.transaction(async db => {
    await db.query(`DROP POLICY access_guard ON ${table}`);
    await db.query("SELECT set_config('app.member_id',$1,true)", [a.admin]);
    await db.query('SET LOCAL ROLE soldline_app');
    expect((await db.query(`SELECT * FROM ${table} WHERE member_id=$1`,[a.other])).rows.length).toBeGreaterThan(0);
    throw new Error('Scratch rollback');
  })).rejects.toThrow('Scratch rollback');
});
it('Limits contributors to runs with owned findings or recovery records', async () => {
  await context.asMember(a.contributor, async db => {
    expect((await db.query('SELECT id FROM runs')).rows).toEqual([{ id:a.runA }]);
  });
  await expect(context.db.transaction(async db => {
    await db.query('DROP POLICY access_guard ON runs');
    await db.query("SELECT set_config('app.member_id',$1,true)",[a.contributor]);
    await db.query('SET LOCAL ROLE soldline_app');
    expect((await db.query('SELECT * FROM runs')).rows).toHaveLength(3);
    throw new Error('Scratch rollback');
  })).rejects.toThrow('Scratch rollback');
});
it.each(tables)('Refuses archived and unknown members in %s', async table => {
  for (const member of [a.archived,id(9,9)]) {
    await context.asMember(member,async db => { expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0); });
    await expect(context.db.transaction(async db => {
      await db.query(`DROP POLICY workspace_guard ON ${table}`);
      await db.query(`DROP POLICY access_guard ON ${table}`);
      await db.query("SELECT set_config('app.member_id',$1,true)",[member]);
      await db.query('SET LOCAL ROLE soldline_app');
      expect((await db.query(`SELECT * FROM ${table}`)).rows.length).toBeGreaterThan(0);
      throw new Error('Scratch rollback');
    })).rejects.toThrow('Scratch rollback');
    await context.asMember(member,async db => { expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0); });
  }
});
it('Clears member and role settings after success and failure', async () => {
  await context.asMember(a.admin, async db => { expect((await db.query('SELECT app_member_id() AS id')).rows).toEqual([{id:a.admin}]); });
  await expect(context.asMember(a.admin, async () => { throw new Error('Stop'); })).rejects.toThrow('Stop');
  expect((await context.db.query("SELECT nullif(current_setting('app.member_id',true),'') AS member, current_user AS role")).rows).toEqual([{member:null,role:'postgres'}]);
});
it('Rejects references across workspaces', async () => {
  await expect(context.db.query('INSERT INTO onboarding_inputs (workspace_id,run_id) VALUES ($1,$2)',[a.ws,b.runA])).rejects.toThrow(/foreign key/);
});
it('Lets managers see audit records only for their runs', async () => {
  await context.asMember(a.admin, async db => {
    await db.query("SELECT audit_append($1,$2::jsonb)",[a.ws,JSON.stringify({action:'checked',outcome:'allowed',target_type:'run',target_id:a.runA})]);
  });
  await context.asMember(a.manager,async db => {
    const rows = (await db.query('SELECT target_id FROM audit_log')).rows;
    expect(rows).toEqual([{target_id:a.runA}]);
  });
  await expect(context.db.transaction(async db => {
    await db.query('DROP POLICY access_guard ON audit_log');
    await db.query("SELECT set_config('app.member_id',$1,true)",[a.manager]);
    await db.query('SET LOCAL ROLE soldline_app');
    expect((await db.query('SELECT * FROM audit_log')).rows.length).toBeGreaterThan(1);
    throw new Error('Scratch rollback');
  })).rejects.toThrow('Scratch rollback');
});
