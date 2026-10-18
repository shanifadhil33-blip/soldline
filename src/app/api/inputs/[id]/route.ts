import { z } from 'zod';
import { withMemberRoute, fail } from '../../../../server/http';
import { assertCan } from '../../../../server/permissions';
import { append } from '../../../../server/audit';
export const POST=withMemberRoute(async(request,context,member,db)=>{
  const {id}=await context.params;if(!z.uuid().safeParse(id).success)return fail(404);
  const row=(await db.query<{id:string;workspace_id:string;client_company_id:string}>(`SELECT i.id,i.workspace_id,d.client_company_id FROM onboarding_inputs i JOIN runs r ON r.workspace_id=i.workspace_id AND r.id=i.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE i.id=$1`,[id])).rows[0];
  if(!row)return fail(404);
  if(member.roles.includes('client_reviewer')&&(!member.client_company_id||row.client_company_id!==member.client_company_id))return fail(404);
  assertCan(member,'mark_input_received',row);
  const body=z.object({confirm:z.literal(true)}).strict().safeParse(await request.json().catch(()=>null));
  if(!body.success)return fail(400,'Confirm that the input was received.');
  await db.query("UPDATE onboarding_inputs SET status='received',received_at=now() WHERE id=$1",[id]);
  await append(db,member.workspace_id,{action:'input_received',outcome:'succeeded',target_id:id});
  return Response.json({ok:true,message:'Input marked as received'});
});
