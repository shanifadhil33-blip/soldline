import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
import { cookieName, demoCookie, signDemo, verifyDemo } from '../src/server/demo/cookie';
import { personas } from '../src/server/demo/seed';
const mocks = vi.hoisted(() => ({ services: vi.fn(), driver: vi.fn(), cookies: vi.fn() }));
vi.mock('../src/server/db/runtime', () => ({ getOwnerServices: mocks.services, getAppDriver: mocks.driver }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
import { POST } from '../src/app/api/demo/start/route';
import { getMember } from '../src/server/session';
import { authConfig, clearDemoOnSignIn } from '../src/auth';
let db: PGlite;
let runtime: ReturnType<typeof fixtureRuntime>;
const key = 'fixture signing key only';
beforeAll(async () => { db = new PGlite(); await migrate(db); runtime = fixtureRuntime(db); mocks.services.mockReturnValue(runtime.owner); mocks.driver.mockReturnValue(runtime.app); }, 60000);
beforeEach(() => { vi.stubEnv('DEMO_SIGNING_KEY', key); });
afterAll(async () => { vi.unstubAllEnvs(); await db?.close(); });
function start(persona = 'faisal', cookie?: string) {
  return POST(new Request('http://localhost/api/demo/start', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ persona }) }));
}
function responseCookie(response: Response) { return response.headers.get('set-cookie')!.split(';')[0]; }
it.each(Object.keys(personas))('Starts demo persona %s without users or accounts', async persona => {
  const response = await start(persona);
  expect(response.status).toBe(200);
  const body = await response.json();
  const member = await getMember(new Request('http://localhost', { headers: { cookie: responseCookie(response) } }));
  expect(member?.display_name).toBe(personas[persona as keyof typeof personas].name);
  expect(member?.roles).toEqual([personas[persona as keyof typeof personas].role]);
  expect(member?.is_demo).toBe(true);
  expect((await db.query('SELECT * FROM users WHERE workspace_id=$1', [body.sandbox])).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM accounts WHERE workspace_id=$1', [body.sandbox])).rows).toHaveLength(0);
});
it('Reuses a browser sandbox on repeat starts and persona switches without extending expiry', async () => {
  const first = await start('faisal'), cookie = responseCookie(first), initial = await first.json();
  const second = await start('faisal', cookie), switched = await start('ravi', cookie);
  expect((await second.json()).sandbox).toBe(initial.sandbox);
  expect((await switched.json()).sandbox).toBe(initial.sandbox);
  const a = verifyDemo(cookie.slice(cookieName.length + 1), key)!;
  const b = verifyDemo(responseCookie(switched).slice(cookieName.length + 1), key)!;
  expect(b.expiry).toBe(a.expiry);
  expect(b.persona).toBe('ravi');
  expect((await getMember(new Request('http://localhost', { headers: { cookie: responseCookie(switched) } })))?.display_name).toBe('Ravi Menon');
});
it('Returns 200 for 50 rapid starts through the route directly', async () => {
  const responses = await Promise.all(Array.from({ length: 50 }, () => start('omar')));
  expect(responses.map(r => r.status)).toEqual(Array(50).fill(200));
});
it('Caps live sandboxes at 60 and queues exactly one cleanup for the oldest', async () => {
  await db.query('UPDATE workspaces SET demo_expires_at=now() + interval \'6 hours\'');
  let count = Number((await db.query<{ count: number }>('SELECT count(*) AS count FROM workspaces WHERE is_demo=true AND demo_expires_at > now()')).rows[0].count);
  while (count++ < 60) expect((await start()).status).toBe(200);
  const oldest = (await db.query<{ id: string }>('SELECT id FROM workspaces WHERE is_demo=true ORDER BY created_at,id LIMIT 1')).rows[0].id;
  await db.query("UPDATE workspaces SET created_at=now() - interval '1 day' WHERE id=$1", [oldest]);
  const before = Number((await db.query<{ count: number }>("SELECT count(*) AS count FROM jobs WHERE kind='demo_cleanup'")).rows[0].count);
  expect((await start()).status).toBe(200);
  expect(Number((await db.query<{ count: number }>("SELECT count(*) AS count FROM jobs WHERE kind='demo_cleanup'")).rows[0].count)).toBe(before + 1);
  expect(Number((await db.query<{ count: number }>('SELECT count(*) AS count FROM workspaces WHERE is_demo=true AND demo_expires_at > now()')).rows[0].count)).toBe(60);
  const jobs = (await db.query<{ kind: string; payload: { clickup_folder_id: string; hubspot_deal_id: string } }>('SELECT kind,payload FROM jobs WHERE workspace_id=$1', [oldest])).rows;
  expect(jobs).toHaveLength(1);
  expect(jobs[0].kind).toBe('demo_cleanup');
  expect(jobs[0].payload).toEqual({});
  await start();
  expect((await db.query('SELECT * FROM jobs WHERE workspace_id=$1', [oldest])).rows).toHaveLength(1);
}, 60000);
it('Rejects tampered, expired, malformed and future cookies and expired database sandboxes', async () => {
  const response = await start(); const cookie = responseCookie(response); const value = cookie.slice(cookieName.length + 1); const ticket = verifyDemo(value, key)!;
  for (const bad of [value.replace('.faisal.', '.ravi.'), `${value}0`, signDemo({ ...ticket, expiry: Math.floor(Date.now() / 1000) - 1 }, key), signDemo({ ...ticket, expiry: Math.floor(Date.now() / 1000) + 30000 }, key), 'bad']) {
    expect(verifyDemo(bad, key)).toBeNull();
    expect(await getMember(new Request('http://localhost', { headers: { cookie: `${cookieName}=${bad}` } }))).toBeNull();
  }
  await db.query('UPDATE workspaces SET demo_expires_at=now() WHERE id=$1', [ticket.sandbox]);
  expect(await getMember(new Request('http://localhost', { headers: { cookie } }))).toBeNull();
});
it('Clears the demo cookie on a real Auth.js sign in event', async () => {
  const set = vi.fn(); mocks.cookies.mockResolvedValue({ set });
  expect(authConfig().session?.strategy).toBe('database');
  expect(authConfig().events?.signIn).toBe(clearDemoOnSignIn);
  await authConfig().events!.signIn!({ user: { id: 'real', email: 'faisal@example.test' }, account: null });
  expect(set).toHaveBeenCalledExactlyOnceWith('soldline_demo', '', expect.objectContaining({ maxAge: 0, httpOnly: true, sameSite: 'lax', path: '/' }));
});
it('Sets production cookie security and refuses invalid personas', async () => {
  expect(demoCookie('signed', 10, true)).toContain('; Secure');
  expect(demoCookie('signed', 10, false)).not.toContain('; Secure');
  expect((await start('unknown')).status).toBe(400);
  expect((await POST(new Request('http://localhost', { method: 'POST', body: '{' }))).status).toBe(400);
});
it('Seeds the exact scope, CRM package, document and onboarding inputs', async () => {
  const response = await start(); const { sandbox } = await response.json();
  expect((await db.query('SELECT title FROM scope_items WHERE workspace_id=$1', [sandbox])).rows).toHaveLength(8);
  expect((await db.query('SELECT name FROM line_items WHERE workspace_id=$1', [sandbox])).rows).toHaveLength(4);
  expect((await db.query('SELECT label FROM onboarding_inputs i JOIN runs r ON r.id=i.run_id WHERE i.workspace_id=$1 AND r.status=$2', [sandbox, 'waiting_approval'])).rows).toHaveLength(6);
  expect((await db.query('SELECT source,page_count FROM scope_documents WHERE workspace_id=$1', [sandbox])).rows).toEqual([{ source: 'hubspot_note', page_count: 3 }]);
});
