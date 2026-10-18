import { z } from 'zod';
import { withMemberRoute } from '../../../../server/http';
const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).or(z.object({ all: z.literal(true) }));
export const POST = withMemberRoute(async (request, _context, member, db) => {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'invalid_request', message: 'Send the notification ids to mark as read, or all: true.' }, { status: 400 });
  const result = 'all' in parsed.data
    ? await db.query<{ id: string }>('UPDATE notifications SET read_at=now() WHERE member_id=$1 AND read_at IS NULL RETURNING id', [member.id])
    : await db.query<{ id: string }>('UPDATE notifications SET read_at=now() WHERE member_id=$1 AND id=ANY($2::uuid[]) AND read_at IS NULL RETURNING id', [member.id, parsed.data.ids]);
  return Response.json({ ok: true, marked: result.rows.length });
});
