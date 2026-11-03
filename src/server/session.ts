import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getOwnerServices } from './db/runtime';
import { cookieName, readCookie, verifyDemo } from './demo/cookie';
import { saveMember, takeMember } from './demo/read-cache';
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
  if (!ticket) return null;
  const key = `${ticket.sandbox}:${ticket.persona}`;
  const cached = takeMember(key);
  if (cached) return cached;
  const member = await getOwnerServices().demo.member(ticket);
  if (member) saveMember(key, member);
  return member;
}

/** One member lookup shared by the layout and the page in the same render. */
export const getMemberFromCookies = cache(async () => getMember(await cookies()));
