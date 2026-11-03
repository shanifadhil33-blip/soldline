import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
import { createDatabase, fixture } from './helpers/pglite';
import { settings } from '../src/server/backend-a5';
import { postMessage } from '../src/server/agent';
import { decisionAllowed } from '../src/server/approvals/access';
import { clockFace, demoPhrase, plainPlace, plainValue, preparePersonalPatch, shouldRunAfterApprove } from '../src/lib/plain';
import { personalSettings } from '../src/server/backend-a5';
import { loadMessages } from '../src/lib/i18n';
import type { Member } from '../src/server/permissions';

it('Normalizes a saved morning time to hours and minutes', () => {
  expect(clockFace('09:00:00')).toBe('09:00');
  expect(preparePersonalPatch({ digestTime: '09:00:00', language: 'ar' })).toEqual({ digestTime: '09:00', language: 'ar' });
  expect(personalSettings.safeParse(preparePersonalPatch({ digestTime: '09:00:00' })).success).toBe(true);
  expect(personalSettings.safeParse({ digestTime: '09:00:00' }).success).toBe(false);
});

it('Hides raw plan values and keeps friendly names', () => {
  const names = { '42': 'Ravi Menon' };
  expect(plainValue('due_date', 1793795169030, 'en', names)).toMatch(/2026|2027/);
  expect(plainValue('assignees', [42], 'en', names)).toBe('Ravi Menon');
  expect(plainValue('name', null, 'en')).toBeNull();
  expect(plainPlace('90149400327', 'en')).toBeNull();
  expect(plainPlace('@folder', 'en')).toBeNull();
  expect(plainPlace('@list:Setup', 'en')).toBeNull();
  expect(plainPlace('sample_deal', 'en')).toBeNull();
  expect(demoPhrase('Brand style refresh', 'ar')).toBe('تحديث الهوية');
});

it('Runs a reversible approval straight after the decision', () => {
  expect(shouldRunAfterApprove('reversible', 'Decision recorded')).toBe(true);
  expect(shouldRunAfterApprove('irreversible', 'Decision recorded')).toBe(false);
  expect(shouldRunAfterApprove('reversible', 'Another approval is needed')).toBe(false);
});

it('Refuses plan approval for a specialist', () => {
  const ravi: Member = { id: '00000000-0000-4000-8000-000000000013', workspace_id: '00000000-0000-4000-8000-000000000001', display_name: 'Ravi Menon', roles: ['contributor'], client_company_id: null, is_demo: true };
  const imran: Member = { ...ravi, roles: ['delivery_lead'] };
  expect(decisionAllowed(ravi, { kind: 'provision', requested_by_type: 'agent', requested_by_member_id: null })).toBe(false);
  expect(decisionAllowed(imran, { kind: 'provision', requested_by_type: 'agent', requested_by_member_id: null })).toBe(true);
});

it('Saves an unchanged settings time that arrived with seconds', async () => {
  const database = await createDatabase();
  const f = fixture(1);
  const admin: Member = { id: f.admin, workspace_id: f.ws, display_name: 'Adhil', roles: ['admin'], client_company_id: null, is_demo: false };
  await database.db.query("UPDATE members SET digest_time='09:00:00', preferred_name='Adhil', language='en', agent_name='Helper', voice=false WHERE id=$1", [f.admin]);
  await database.db.query("SELECT set_config('app.member_id',$1,false)", [f.admin]);
  const loaded = await settings(database.db, admin, false) as { digestTime: string };
  expect(loaded.digestTime).toBe('09:00');
  const saved = await settings(database.db, admin, false, { digestTime: '09:00' }) as { digestTime: string };
  expect(saved.digestTime).toBe('09:00');
  await database.db.close();
});

let db: PGlite;
let runtime: ReturnType<typeof fixtureRuntime>;
beforeAll(async () => { db = new PGlite(); await migrate(db); runtime = fixtureRuntime(db); }, 60000);
afterAll(async () => { await db?.close(); });

it('Answers in the active language and shows the seeded plan without a live connection', async () => {
  vi.stubEnv('AI_PROVIDERS', '');
  const ticket = await runtime.owner.demo.start('imran', null);
  const imran = (await runtime.owner.demo.member(ticket))!;
  const answer = await postMessage(db, imran, { message: 'What is waiting', language: 'ar' });
  expect(answer?.intro).toBe(loadMessages('ar').backendA5.summary);
  expect(answer?.rows.find(row => row.label === loadMessages('ar').backendA5.recovery)?.count).toBe(3);
  const run = (await db.query<{ id: string }>("SELECT r.id FROM runs r JOIN deals d ON d.id=r.deal_id WHERE r.workspace_id=$1 AND d.name LIKE 'Harbor%'", [ticket.sandbox])).rows[0];
  const history = await runtime.owner.readRunHistory(imran, run.id);
  expect(history.length).toBeGreaterThan(0);
  expect(history.some(row => row.actor_name_at_event === 'Omar Haddad')).toBe(true);
  const tasks = await runtime.owner.readRunTasks(imran, run.id);
  expect(tasks?.tasks).toHaveLength(8);
  expect(tasks && 'simulated' in tasks && tasks.simulated).toBe(true);
  vi.unstubAllEnvs();
});
