import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
const mocks = vi.hoisted(() => ({ services: vi.fn(), driver: vi.fn() }));
vi.mock('../src/server/db/runtime', () => ({ getOwnerServices: mocks.services, getAppDriver: mocks.driver }));
import { POST as start } from '../src/app/api/demo/start/route';
import { POST } from '../src/app/api/runs/[id]/approve-plan/route';
let db: PGlite;
beforeAll(async () => {
  vi.stubEnv('DEMO_SIGNING_KEY', 'fixture signing key only');
  db = new PGlite(); await migrate(db); const runtime = fixtureRuntime(db);
  mocks.services.mockReturnValue(runtime.owner); mocks.driver.mockReturnValue(runtime.app);
}, 60000);
afterAll(async () => { vi.unstubAllEnvs(); await db?.close(); });
it.each([{ persona: 'ravi', status: 403, outcome: 'denied', name: 'Ravi Menon', role: 'contributor' }, { persona: 'imran', status: 200, outcome: 'allowed', name: 'Imran Shaikh', role: 'delivery_lead' }])('Records exactly one audit row for $persona', async ({ persona, status, outcome, name, role }) => {
  const response = await start(new Request('http://localhost/api/demo/start', { method: 'POST', body: JSON.stringify({ persona }) }));
  const { sandbox } = await response.json();
  const run = (await db.query<{ id: string }>("SELECT id FROM runs WHERE workspace_id=$1 AND status='waiting_approval'", [sandbox])).rows[0].id;
  const result = await POST(new Request(`http://localhost/api/runs/${run}/approve-plan`, { method: 'POST', headers: { cookie: response.headers.get('set-cookie')!.split(';')[0] } }), { params: Promise.resolve({ id: run }) });
  expect(result.status).toBe(status);
  expect(await result.json()).toEqual(status === 403 ? { error: 'not_allowed', message: 'Contributors cannot approve delivery plans.' } : { ok: true, message: 'Approval recorded' });
  expect((await db.query('SELECT outcome,action,target_type,target_id,actor_name_at_event,actor_roles_at_event FROM audit_log WHERE workspace_id=$1', [sandbox])).rows).toEqual([{ outcome, action: 'approve_plan', target_type: 'run', target_id: run, actor_name_at_event: name, actor_roles_at_event: [role] }]);
  expect((await db.query('SELECT * FROM approvals WHERE workspace_id=$1', [sandbox])).rows).toHaveLength(0);
});
it('Refuses missing authentication before writes', async () => {
  const response = await POST(new Request('http://localhost', { method: 'POST' }), { params: Promise.resolve({ id: 'missing' }) });
  expect(response.status).toBe(401);
});
