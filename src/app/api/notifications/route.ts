import { withMemberRoute } from '../../../server/http';
// Row level security limits notifications to the signed in member; the query also names the member.
export const GET = withMemberRoute(async (_request, _context, member, db) => {
  const rows = (await db.query<{ id: string; kind: string | null; body: string | null; link: string | null; read_at: string | null; created_at: string }>(
    'SELECT id,kind,body,link,read_at,created_at FROM notifications WHERE member_id=$1 ORDER BY created_at DESC,id LIMIT 50', [member.id])).rows;
  const unread = (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE member_id=$1 AND read_at IS NULL', [member.id])).rows[0].n;
  return Response.json({ notifications: rows, unread });
});
