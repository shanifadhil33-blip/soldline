import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from './helpers/pglite';
import { seedSandbox, personas, type Persona } from '../src/server/demo/seed';
import { readToday } from '../src/server/today';
import { clientRecords } from '../src/server/trust';
import type { Member } from '../src/server/permissions';
let ctx: Awaited<ReturnType<typeof createDatabase>>;
const ws = randomUUID();
const people = {} as Record<Persona, Member>;
beforeAll(async () => {
  ctx = await createDatabase();
  await ctx.db.transaction(db => seedSandbox(db, ws, new Date(Date.now() + 6 * 3600000)));
  const rows = (await ctx.db.query<{ id: string; preferred_name: Persona; roles: Member['roles']; client_company_id: string | null }>('SELECT id,preferred_name,roles,client_company_id FROM members WHERE workspace_id=$1', [ws])).rows;
  for (const row of rows) people[row.preferred_name] = { id: row.id, workspace_id: ws, roles: row.roles, display_name: personas[row.preferred_name].name, client_company_id: row.client_company_id, is_demo: true };
}, 60000);
afterAll(async () => { await ctx?.db.close(); });
const today = (p: Persona) => ctx.asMember(people[p].id, db => readToday(db, people[p]));

it('Every run has a delivery lead and a won date, and the finished run has a ready date', async () => {
  const runs = (await today('faisal')).runs;
  expect(runs.length).toBe(3);
  for (const run of runs) { expect(run.owner).toBe('Imran Shaikh'); expect(run.won).toBeTruthy(); }
  expect(runs.find(r => r.status === 'ready')?.ready).toBeTruthy();
});

it('A run waiting for approval shows in the approver queue with the same count', async () => {
  for (const p of ['imran', 'faisal'] as const) {
    const data = await today(p);
    const waiting = data.runs.filter(r => r.status === 'waiting_approval').map(r => r.id);
    expect(waiting.length).toBe(1);
    expect(data.approvals.some(a => a.run_id === waiting[0])).toBe(true);
  }
});

it('Each staff person has something waiting in Today', async () => {
  const imran = await today('imran'), omar = await today('omar'), faisal = await today('faisal'), ravi = await today('ravi');
  expect(imran.approvals.length).toBe(1); expect(imran.owned.length).toBe(1); expect(imran.inputs.length).toBeGreaterThan(0);
  expect(omar.approvals.length).toBe(1); expect(omar.owned.length).toBe(1); expect(omar.recovery.length).toBe(1); expect(omar.inputs.length).toBe(2);
  expect(faisal.approvals.length).toBe(2); expect(faisal.recovery.length).toBe(1);
  expect(ravi.approvals.length).toBe(0); expect(ravi.recovery.length).toBe(1);
});

it('Clients see only their own company, with a review or an input waiting', async () => {
  const karim = await ctx.asMember(people.karim.id, db => clientRecords(db, people.karim));
  expect(karim.runs.map(r => r.name)).toEqual(['Harbor Coffee Roasters, growth retainer']);
  expect(karim.deliverables.some(d => d.status === 'client review' && d.title === 'Brand style refresh')).toBe(true);
  expect(karim.inputs.some(i => i.status === 'missing')).toBe(true);
  const laith = await ctx.asMember(people.laith.id, db => clientRecords(db, people.laith));
  expect(laith.runs.map(r => r.name)).toEqual(['Cedar Line Furniture']);
  expect(laith.inputs.filter(i => i.status === 'missing').length).toBe(2);
});

it('Seeded approvals notify their approvers', async () => {
  const notes = (await ctx.db.query<{ member_id: string }>("SELECT member_id FROM notifications WHERE workspace_id=$1 AND kind='approval'", [ws])).rows.map(r => r.member_id).sort();
  expect(notes).toEqual([people.faisal.id, people.faisal.id, people.imran.id, people.omar.id].sort());
});
