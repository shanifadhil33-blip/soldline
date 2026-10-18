import { createHmac, timingSafeEqual } from 'node:crypto';
import { personas, type Persona } from './seed';
export const cookieName = 'soldline_demo';
export const lifetime = 6 * 60 * 60;
export interface DemoTicket { sandbox: string; persona: Persona; expiry: number }
function signature(payload: string, key: string) { return createHmac('sha256', key).update(payload).digest('hex'); }
export function signDemo(ticket: DemoTicket, key: string): string {
  if (!key) throw new Error('Demo signing key is required');
  const payload = `${ticket.sandbox}.${ticket.persona}.${ticket.expiry}`;
  return `${payload}.${signature(payload, key)}`;
}
export function verifyDemo(value: string | undefined, key: string, now = Date.now()): DemoTicket | null {
  if (!value || !key) return null;
  const [sandbox, persona, rawExpiry, mac, ...extra] = value.split('.');
  if (extra.length || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(sandbox ?? '') || !Object.hasOwn(personas, persona ?? '') || !/^\d+$/.test(rawExpiry ?? '') || !/^[a-f0-9]{64}$/.test(mac ?? '')) return null;
  const expected = signature(`${sandbox}.${persona}.${rawExpiry}`, key);
  if (!timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(expected, 'hex'))) return null;
  const expiry = Number(rawExpiry);
  if (!Number.isSafeInteger(expiry) || expiry * 1000 <= now || expiry * 1000 > now + lifetime * 1000) return null;
  return { sandbox, persona: persona as Persona, expiry };
}
export function demoCookie(value: string, maxAge = lifetime, production = process.env.NODE_ENV === 'production') {
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${production ? '; Secure' : ''}`;
}
export function clearDemoCookie() { return demoCookie('', 0); }
export function readCookie(request: Request, name: string): string | undefined {
  return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
