import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { filesUnder } from './helpers/source';
const mocks = vi.hoisted(() => ({ member: vi.fn() }));
vi.mock('../src/server/session', () => ({ getMember: mocks.member }));
vi.mock('../src/server/db/runtime', () => ({ getAppDriver: () => ({ transaction: async () => { throw new Error('connection reset by peer at 10.0.0.1'); } }) }));
import { answer, fail, withMemberRoute } from '../src/server/http';

it('Gives every error status a code and a plain sentence', async () => {
  for (const status of [400, 401, 403, 404, 405, 409, 429, 500, 502, 503, 418, 504]) {
    const body = await fail(status).json();
    expect(body.error).toMatch(/^[a-z_]+$/); expect(body.message.length).toBeGreaterThan(5);
  }
  expect(await fail(400, 'Choose a run to check.').json()).toEqual({ error: 'invalid_request', message: 'Choose a run to check.' });
  expect(await answer(200, 'Saved').json()).toEqual({ ok: true, message: 'Saved' });
  expect((await answer(409, 'Saved').json()).error).toBe('conflict');
});

it('Answers an unexpected failure with words and no internal details', async () => {
  mocks.member.mockResolvedValue({ id: 'm1', workspace_id: 'w1', roles: ['admin'] });
  const route = withMemberRoute(async () => Response.json({ ok: true }));
  const response = await route(new Request('http://localhost/api/x'), { params: Promise.resolve({}) });
  expect(response.status).toBe(500);
  const text = await response.text();
  expect(JSON.parse(text)).toEqual({ error: 'server_error', message: 'Something went wrong on our side. Try again in a minute.' });
  expect(text).not.toContain('10.0.0.1');
});

it('Has no empty error bodies in any API route', () => {
  for (const file of [...filesUnder('src/app/api'), ...filesUnder('src/server')].filter(f => f.endsWith('.ts'))) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toMatch(/Response\.json\(\s*\{\s*\}\s*,/);
    expect(text, file).not.toMatch(/Response\.json\(\s*\w+\s*\?\?\s*\{\s*\}/);
    expect(text, file).not.toMatch(/new Response\(\s*(null|''|"")\s*,\s*\{\s*status:\s*[45]/);
  }
});
