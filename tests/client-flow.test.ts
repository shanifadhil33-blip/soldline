import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase } from './helpers/pglite';
import { fixtureRuntime } from './helpers/runtime';
import { seedSandbox, personas, type Persona } from '../src/server/demo/seed';
import { readToday } from '../src/server/today';
import { readRuns } from '../src/server/screens';
import { clientRecords } from '../src/server/trust';
import type { Member } from '../src/server/permissions';
import { noteText } from '../src/lib/plain';
import { directAnswer } from '../src/server/agent-answer';

let ctx: Awaited<ReturnType<typeof createDatabase>>;
let services: ReturnType<typeof fixtureRuntime>['owner'];
const ws = randomUUID();
const people = {} as Record<Persona, Member>;
beforeAll(async () => {
  ctx = await createDatabase();
  services = fixtureRuntime(ctx.db).owner;
  await ctx.db.transaction(db => seedSandbox(db, ws, new Date(Date.now() + 6 * 3600000)));
  const rows = (await ctx.db.query<{ id: string; preferred_name: Persona; roles: Member['roles']; client_company_id: string | null }>('SELECT id,preferred_name,roles,client_company_id FROM members WHERE workspace_id=$1', [ws])).rows;
  for (const row of rows) people[row.preferred_name] = { id: row.id, workspace_id: ws, roles: row.roles, display_name: personas[row.preferred_name].name, client_company_id: row.client_company_id, is_demo: true };
}, 60000);
afterAll(async () => { await ctx?.db.close(); });
const today = (p: Persona) => ctx.asMember(people[p].id, db => readToday(db, people[p]));
const client = (p: Persona) => ctx.asMember(people[p].id, db => clientRecords(db, people[p]));
const brand = 'sample_task_brand';

it('A specialist sees the same fixes and their own tasks, and projects they work on', async () => {
  const ravi = await today('ravi');
  expect(ravi.tasks.map(t => t.id)).toContain('sample_task_blog');
  expect(ravi.recovery.every(r => r.mine)).toBe(true);
  const projects = await ctx.asMember(people.ravi.id, db => readRuns(db));
  expect(projects.length).toBeGreaterThan(0);
});

it('Agency leads see the same fixes on Today and on the Fixes list', async () => {
  const imran = await today('imran'), faisal = await today('faisal');
  expect(imran.recovery.length).toBe(3);
  expect(faisal.recovery.length).toBe(3);
  expect(faisal.approvals.length).toBe(new Set(faisal.approvals.map(a => a.run_id)).size);
});

it('Client asks for changes, the agency sees it, fixes it, and the client approves', async () => {
  const asked = await services.trust.requestChanges(people.karim, brand, 'Please make the logo larger.');
  expect(asked.status).toBe(200);
  expect((await client('karim')).deliverables.find(d => d.id === brand)?.status).toBe('changes requested');
  // A second ask while changes are being made is refused.
  expect((await services.trust.requestChanges(people.karim, brand, 'Again')).status).toBe(409);
  expect((await services.trust.requestChanges(people.karim, brand, '   ')).status).toBe(400);

  const imran = await today('imran');
  const item = imran.recovery.find(r => r.title === 'Karim Nasser asked for changes to Brand style refresh');
  expect(item).toBeTruthy();
  expect(imran.recovery.length).toBe(4);
  expect(imran.news.map(n => noteText(n.body, 'en'))).toContain('Karim Nasser asked for changes to Brand style refresh');
  expect(noteText(imran.news[0].body, 'ar')).toContain('كريم');
  // Ravi, who makes the work, hears about it too.
  expect((await today('ravi')).news.length).toBeGreaterThan(0);

  const detail = await services.trust.deliverable(people.imran, brand);
  expect(detail?.rounds[0].note).toBe('Please make the logo larger.');
  expect(detail?.canDecide).toBe(false);

  // Only the owner can mark it fixed, and a note is needed.
  expect((await services.recovery.act(people.ravi, item!.id, 'resolve_with_note', 'x')).status).toBe(403);
  expect((await services.recovery.act(people.imran, item!.id, 'resolve_with_note', '')).status).toBe(409);
  expect((await services.recovery.act(people.imran, item!.id, 'resolve_with_note', 'Logo is larger now.')).status).toBe(200);

  const back = (await client('karim')).deliverables.find(d => d.id === brand);
  expect(back?.status.toLowerCase()).toBe('client review');
  expect(back?.again).toBe(true);
  const karimNotes = (await ctx.db.query<{ body: string }>("SELECT body FROM notifications WHERE member_id=$1 AND kind='client_ready'", [people.karim.id])).rows;
  expect(noteText(karimNotes[0].body, 'en')).toBe('Brand style refresh is ready for your review again');

  const approved = await services.trust.approveDeliverable(people.karim, brand);
  expect(approved.status).toBe(200);
  expect((await client('karim')).deliverables.find(d => d.id === brand)?.status).toBe('approved');
  const after = await today('imran');
  expect(after.news.map(n => noteText(n.body, 'en'))).toContain('Karim Nasser approved Brand style refresh');
  expect(after.recovery.length).toBe(3);
  const done = await services.trust.deliverable(people.karim, brand);
  expect(done?.status).toBe('approved');
  expect(done?.rounds.length).toBe(1);
  // The other client cannot see this work.
  expect(await services.trust.deliverable(people.laith, brand)).toBeNull();
});

it('A specialist finishes a task and the client is asked to review it', async () => {
  expect((await services.trust.transitionDeliverable(people.ravi, 'sample_task_blog', 'review')).status).toBe(200);
  const blog = (await client('karim')).deliverables.find(d => d.id === 'sample_task_blog');
  expect(blog?.status.toLowerCase()).toBe('client review');
  expect((await today('ravi')).tasks.map(t => t.id)).not.toContain('sample_task_blog');
});

it('A client marks an input as sent and the agency confirms it', async () => {
  const input = (await client('karim')).inputs.find(i => i.status === 'missing')!;
  expect((await services.trust.markInputSent(people.karim, input.id)).status).toBe(200);
  expect((await client('karim')).inputs.find(i => i.id === input.id)?.sent).toBe(true);
  expect((await today('omar')).news.map(n => noteText(n.body, 'en')).some(t => t.startsWith('Karim Nasser sent'))).toBe(true);
});

it('Agent answers what is blocking a project by name, with a link, in both languages', async () => {
  for (const language of ['en', 'ar'] as const) {
    const answer = await ctx.asMember(people.imran.id, db => directAnswer(db, people.imran, 'What is blocking Cedar Line?', language));
    expect(answer).not.toBeNull();
    expect(answer!.link.href).toMatch(/^\/runs\//);
    expect(answer!.text).not.toMatch(/Projects \d/);
    if (language === 'en') expect(answer!.text.toLowerCase()).toContain('product photos');
  }
  const none = await ctx.asMember(people.imran.id, db => directAnswer(db, people.imran, 'hello', 'en'));
  expect(none).toBeNull();
});
