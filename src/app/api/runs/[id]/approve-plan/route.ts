import { withMemberRoute } from '../../../../../server/http';
import { assertCan, type Resource } from '../../../../../server/permissions';
import { append } from '../../../../../server/audit';
export const POST = withMemberRoute(async (_request, context, member, db) => {
  if (!member.is_demo) return Response.json({ error: 'not_found', message: 'This page is for the demo.' }, { status: 404 });
  const { id } = await context.params;
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return Response.json({ error: 'not_found', message: 'Run not found.' }, { status: 404 });
  const result = await db.query<Resource & Record<string, unknown>>('SELECT r.id,r.workspace_id,d.client_company_id,d.owner_member_id FROM runs r JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE r.id=$1', [id]);
  const run = result.rows[0];
  if (!run) return Response.json({ error: 'not_found', message: 'Run not found.' }, { status: 404 });
  assertCan(member, 'approve_plan', run);
  // P7 will implement the real approvals engine. This demo proof records no approval or external effect.
  await append(db, member.workspace_id, { action: 'approve_plan', outcome: 'allowed', target_type: 'run', target_id: run.id });
  return Response.json({ ok: true, message: 'Approval recorded' });
});
