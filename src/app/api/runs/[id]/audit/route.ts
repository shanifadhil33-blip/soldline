import { z } from 'zod';
import { withMemberRoute } from '../../../../../server/http';
import { assertCan } from '../../../../../server/permissions';
import { getOwnerServices } from '../../../../../server/db/runtime';
import { getMember } from '../../../../../server/session';
// Release the member transaction before the named complete chain check.
const lookup=withMemberRoute(async (_request,context,member,db)=>{
  const {id}=await context.params;
  if(!z.uuid().safeParse(id).success) return Response.json({message:'Record not found'},{status:404});
  const run=(await db.query<{id:string;workspace_id:string;owner_member_id:string|null}>(`SELECT r.id,r.workspace_id,CASE WHEN ('delivery_lead'=ANY(app_roles(r.workspace_id)) AND r.delivery_lead_id=app_member_id()) OR ('account_manager'=ANY(app_roles(r.workspace_id)) AND d.owner_member_id=app_member_id()) THEN app_member_id() END AS owner_member_id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.id=$1`,[id])).rows[0];
  if(!run) return Response.json({message:'Record not found'},{status:404});
  assertCan(member,'read_audit',run);
  return Response.json({ok:true});
});
export async function GET(request:Request,context:Parameters<typeof lookup>[1]) {
  const access=await lookup(request,context);if(!access.ok) return access;
  const member=await getMember(request);if(!member) return Response.json({message:'Please sign in or try the demo.'},{status:401});
  const {id}=await context.params;
  const result=await getOwnerServices().auditRun(member,id);
  return Response.json(result??{message:'Record not found'},{status:result?200:404});
}
