import { language } from '../../../../lib/i18n';
import { z } from 'zod';
import { fail } from '../../../../server/http';
import { getMember } from '../../../../server/session';
import { readRunDetail } from '../../../../server/run-detail';
import type { RouteContext } from '../../../../server/http';

export async function GET(request: Request, context: RouteContext) {
  const member = await getMember(request);
  if (!member) return Response.json({ error: 'not_authenticated', message: 'Please sign in or try the demo.' }, { status: 401 });
  const { id } = await context.params;
  const missing = () => Response.json({ message: 'Record not found' }, { status: 404 });
  if (!z.uuid().safeParse(id).success) return missing();
  try {
    const result = await readRunDetail(member, id, language(request.headers.get('x-soldline-language') ?? undefined));
    if (result.status === 404) return missing();
    if (result.status === 403) return Response.json({ error: 'not_allowed', message: result.message }, { status: 403 });
    return Response.json(result.body);
  } catch {
    return fail(500);
  }
}
