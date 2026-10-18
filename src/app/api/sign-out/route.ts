import { signOutRequest } from '../../../server/sign-out';
// Permission guard exception: signing out needs no permission, only a same site POST
// GET never signs out.
export async function POST(request: Request) { return signOutRequest(request); }
export async function GET() {
  return Response.json({ ok: false, error: { code: 'method_not_allowed', message: 'Use the Sign out button to sign out.' } }, { status: 405, headers: { Allow: 'POST' } });
}
