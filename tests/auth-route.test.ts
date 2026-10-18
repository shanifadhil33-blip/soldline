import { generateKeyPairSync, sign } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from './fixtures/http';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
const mocks = vi.hoisted(() => ({ services: vi.fn(), cookies: vi.fn() }));
vi.mock('../src/server/db/runtime', () => ({ getOwnerServices: mocks.services }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
import { GET, POST } from '../src/app/api/auth/[...nextauth]/route';
let db: PGlite;
const cookieSet = vi.fn();
beforeAll(async () => {
  vi.stubEnv('AUTH_SECRET', 'fixture auth secret with sufficient length');
  vi.stubEnv('AUTH_GOOGLE_ID', 'fixture_google_client');
  vi.stubEnv('AUTH_GOOGLE_SECRET', 'fixture_google_secret');
  vi.stubEnv('AUTH_TRUST_HOST', 'true');
  db = new PGlite(); await migrate(db); mocks.services.mockReturnValue(fixtureRuntime(db).owner);
  mocks.cookies.mockResolvedValue({ set: cookieSet });
}, 60000);
afterAll(async () => { vi.unstubAllEnvs(); await db?.close(); });
function cookieHeader(responses: Response[]) {
  return responses.flatMap(response => response.headers.getSetCookie()).map(value => value.split(';')[0]).join('; ');
}
it('Completes Google OAuth with MSW fixtures using the exported handlers and an original NextRequest', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture_key', alg: 'RS256', use: 'sig' };
  const issuer = 'https://accounts.google.com';
  server.use(
    http.get(`${issuer}/.well-known/openid-configuration`, () => HttpResponse.json({ issuer, authorization_endpoint: `${issuer}/o/oauth2/v2/auth`, token_endpoint: 'https://oauth2.googleapis.com/token', jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs', userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo', response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'] })),
    http.get('https://www.googleapis.com/oauth2/v3/certs', () => HttpResponse.json({ keys: [jwk] })),
    http.post('https://oauth2.googleapis.com/token', async ({ request }) => {
      const data = new URLSearchParams(await request.text());
      expect(data.get('code')).toBe('fixture_code');
      expect(data.get('code_verifier')).toBeTruthy();
      const now = Math.floor(Date.now()/1000);
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture_key' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: 'fixture_google_client', sub: 'fixture_omar', name: 'Omar Haddad', email: 'omar@example.test', email_verified: true, iat: now, exp: now + 3600, ...(nonce ? { nonce } : {}) })).toString('base64url');
      const signed = `${header}.${payload}`;
      const idToken = `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
      return HttpResponse.json({ access_token: 'fixture_access', token_type: 'Bearer', expires_in: 3600, id_token: idToken });
    }),
  );
  const csrf = await GET(new NextRequest('http://localhost/api/auth/csrf'));
  const { csrfToken } = await csrf.json();
  const signin = await POST(new NextRequest('http://localhost/api/auth/signin/google', { method: 'POST', headers: { cookie: cookieHeader([csrf]), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, callbackUrl: 'http://localhost/' }) }));
  expect(signin.status).toBe(302);
  const authorization = new URL(signin.headers.get('location')!);
  expect(authorization.origin).toBe(issuer);
  expect(authorization.searchParams.get('prompt')).toBe('select_account');
  expect(authorization.searchParams.get('code_challenge')).toBeTruthy();
  const nonce = authorization.searchParams.get('nonce') ?? undefined;
  const callbackUrl = new URL('http://localhost/api/auth/callback/google');
  callbackUrl.searchParams.set('code', 'fixture_code');
  if (authorization.searchParams.has('state')) callbackUrl.searchParams.set('state', authorization.searchParams.get('state')!);
  const callback = await GET(new NextRequest(callbackUrl, { headers: { cookie: `${cookieHeader([csrf, signin])}; soldline_demo=fixture_old_demo_cookie` } }));
  expect(callback.status).toBe(302);
  expect(callback.headers.get('location')).toBe('http://localhost');
  expect(callback.headers.getSetCookie().some(value => value.startsWith('authjs.session-token='))).toBe(true);
  expect(cookieSet).toHaveBeenCalledExactlyOnceWith('soldline_demo', '', expect.objectContaining({ maxAge: 0 }));
  expect((await db.query('SELECT provider FROM accounts')).rows).toEqual([{ provider: 'google' }]);
  expect((await db.query('SELECT * FROM sessions')).rows).toHaveLength(1);
});
it('Uses branded pages for sign in and provider errors', async () => {
  const signin = await GET(new NextRequest('http://localhost/api/auth/signin'));
  expect(signin.headers.get('location')).toContain('/sign-in');
  const error = await GET(new NextRequest('http://localhost/api/auth/error?error=AccessDenied'));
  expect(error.headers.get('location')).toContain('/auth/error');
});
