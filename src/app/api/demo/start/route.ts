import { getOwnerServices } from '../../../../server/db/runtime';
import { personas, type Persona } from '../../../../server/demo/seed';
import { cookieName, demoCookie, readCookie, signDemo, verifyDemo } from '../../../../server/demo/cookie';
// Permission guard exception: public demo creation has no member yet. Only the scoped owner demo store writes.
export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid_persona', message: 'Choose a demo persona.' }, { status: 400 }); }
  const persona = body && typeof body === 'object' && 'persona' in body ? body.persona : null;
  if (typeof persona !== 'string' || !Object.hasOwn(personas, persona)) return Response.json({ error: 'invalid_persona', message: 'Choose a demo persona.' }, { status: 400 });
  const key = process.env.DEMO_SIGNING_KEY;
  if (!key) throw new Error('Demo signing key is required');
  const previous = verifyDemo(readCookie(request, cookieName), key);
  const ticket = await getOwnerServices().demo.start(persona as Persona, previous);
  return Response.json({ ok: true, sandbox: ticket.sandbox, persona, message: 'Sample data' }, { headers: { 'Set-Cookie': demoCookie(signDemo(ticket, key), Math.max(0, ticket.expiry - Math.floor(Date.now() / 1000))) } });
}
