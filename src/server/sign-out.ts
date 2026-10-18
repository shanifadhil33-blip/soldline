import 'server-only';
// Permission guard exception: signing out needs no permission, only a same site POST
import { getOwnerServices, getAppDriver } from './db/runtime';
import { withMember } from './db/withMember';
import { append } from './audit';
import { getMember } from './session';
import { cookieName, readCookie } from './demo/cookie';

const sessionCookies = ['__Secure-authjs.session-token', 'authjs.session-token'];

function expired(name: string, secure: boolean) {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

/** A sign out is only accepted from this site, so another site cannot sign a person out. */
export function sameSite(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin';
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function signOutRequest(request: Request): Promise<Response> {
  if (!sameSite(request)) return Response.json({ ok: false, error: { code: 'not_allowed', message: 'Sign out from inside Soldline.' } }, { status: 403 });
  const member = await getMember(request);
  if (member) {
    await withMember(getAppDriver(), member.id, db => append(db, member.workspace_id, { action: 'sign_out', outcome: 'succeeded', target_type: 'member', target_id: member.id }));
  }
  for (const name of sessionCookies) {
    const token = readCookie(request, name);
    if (token) await getOwnerServices().authAdapter.deleteSession?.(token);
  }
  const secure = new URL(request.url).protocol === 'https:';
  const headers = new Headers();
  for (const name of [...sessionCookies, cookieName]) headers.append('Set-Cookie', expired(name, secure || name.startsWith('__Secure-')));
  const form = (request.headers.get('content-type') ?? '').includes('form') || (request.headers.get('accept') ?? '').includes('text/html');
  if (form) { headers.set('Location', '/'); return new Response(null, { status: 303, headers }); }
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ ok: true, message: 'You are signed out.' }), { status: 200, headers });
}
