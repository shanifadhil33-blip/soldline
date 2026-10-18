import 'server-only';
import { getOwnerServices } from './db/runtime';
import { cookieName, readCookie, verifyDemo } from './demo/cookie';
import type { Member } from './permissions';
export interface CookieReader { get(name: string): { value: string } | undefined }
export async function getMember(source: Request | CookieReader): Promise<Member | null> {
  const value = (name: string) => source instanceof Request ? readCookie(source, name) : source.get(name)?.value;
  const token = value('__Secure-authjs.session-token') ?? value('authjs.session-token');
  if (token) {
    const real = await getOwnerServices().sessionMember(token);
    if (real) return real;
  }
  const ticket = verifyDemo(value(cookieName), process.env.DEMO_SIGNING_KEY ?? '');
  return ticket ? getOwnerServices().demo.member(ticket) : null;
}
