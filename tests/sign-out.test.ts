import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ member: vi.fn(), deleteSession: vi.fn(), append: vi.fn() }));
vi.mock('../src/server/session', () => ({ getMember: mocks.member }));
vi.mock('../src/server/db/runtime', () => ({ getOwnerServices: () => ({ authAdapter: { deleteSession: mocks.deleteSession } }), getAppDriver: () => ({}) }));
vi.mock('../src/server/db/withMember', () => ({ withMember: (_d: unknown, _id: string, fn: (db: unknown) => unknown) => fn({}) }));
vi.mock('../src/server/audit', () => ({ append: mocks.append }));
import { GET, POST } from '../src/app/api/sign-out/route';
const url = 'https://soldline.test/api/sign-out';
beforeEach(() => { vi.clearAllMocks(); mocks.member.mockResolvedValue({ id: 'm1', workspace_id: 'w1', roles: ['admin'] }); });

it('Signs out a same site POST: deletes the session, clears every cookie and writes an audit row', async () => {
  const response = await POST(new Request(url, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin', cookie: '__Secure-authjs.session-token=tok; soldline_demo=x' } }));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ok: true });
  expect(mocks.deleteSession).toHaveBeenCalledWith('tok');
  expect(mocks.append).toHaveBeenCalledWith({}, 'w1', expect.objectContaining({ action: 'sign_out', outcome: 'succeeded' }));
  const cleared = response.headers.getSetCookie().join('\n');
  for (const name of ['__Secure-authjs.session-token=;', 'authjs.session-token=;', 'soldline_demo=;']) expect(cleared).toContain(name);
  expect(cleared).toContain('Max-Age=0');
});

it('Redirects a form post home with 303', async () => {
  const response = await POST(new Request(url, { method: 'POST', headers: { origin: 'https://soldline.test', 'content-type': 'application/x-www-form-urlencoded' } }));
  expect(response.status).toBe(303); expect(response.headers.get('location')).toBe('/');
});

it('Refuses a cross site POST and never signs out on GET', async () => {
  const cross = await POST(new Request(url, { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', cookie: 'authjs.session-token=tok' } }));
  expect(cross.status).toBe(403); expect(await cross.json()).toMatchObject({ error: 'not_allowed' });
  const get = await GET();
  expect(get.status).toBe(405); expect((await get.json()).message).toBeTruthy();
  expect(mocks.deleteSession).not.toHaveBeenCalled();
});
