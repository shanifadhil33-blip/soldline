import { z } from 'zod';
import { getMember } from '../../../../server/session';
import { clearDemoWorkspace } from '../../../../server/demo/read-cache';
import { withMemberRoute, fail } from '../../../../server/http';
import { assertCan } from '../../../../server/permissions';
import { append } from '../../../../server/audit';
import { getOwnerServices } from '../../../../server/db/runtime';
const agencyPost=withMemberRoute(async(request,context,member,db)=>{
  const {id}=await context.params;if(!z.uuid().safeParse(id).success)return fail(404);
  const row=(await db.query<{id:string;workspace_id:string;client_company_id:string}>(`SELECT i.id,i.workspace_id,d.client_company_id FROM onboarding_inputs i JOIN runs r ON r.workspace_id=i.workspace_id AND r.id=i.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE i.id=$1`,[id])).rows[0];
  if(!row)return fail(404);
  if(member.roles.includes('client_reviewer')&&(!member.client_company_id||row.client_company_id!==member.client_company_id))return fail(404);
  assertCan(member,'mark_input_received',row);
  const body=z.object({confirm:z.literal(true)}).strict().or(z.object({sent:z.literal(true)}).strict()).safeParse(await request.json().catch(()=>null));
  if(!body.success)return fail(400,'Confirm that the input was received.');
  await db.query("UPDATE onboarding_inputs SET status='received',received_at=now() WHERE id=$1",[id]);
  await append(db,member.workspace_id,{action:'input_received',outcome:'succeeded',target_id:id});
  return Response.json({ok:true,message:'Input marked as received'});
});

/** A client marks an input as sent. This runs outside the shared transaction so the owner write never waits on it. */
export async function POST(request:Request,context:{params:Promise<Record<string,string>>}) {
  const member=await getMember(request);
  if(member?.roles.includes('client_reviewer')){
    if(member.is_demo)clearDemoWorkspace(member.workspace_id);
    const {id}=await context.params;if(!z.uuid().safeParse(id).success)return fail(404);
    const body=z.object({confirm:z.literal(true)}).strict().or(z.object({sent:z.literal(true)}).strict()).safeParse(await request.json().catch(()=>null));
    if(!body.success)return fail(400,'Confirm that the input was sent.');
    assertCan(member,'mark_input_received',{workspace_id:member.workspace_id,client_company_id:member.client_company_id});
    const sent=await getOwnerServices().trust.markInputSent(member,id) as {status:number;title?:string};
    return sent.status<400?Response.json({ok:true,message:'Input marked as sent',title:sent.title}):fail(sent.status);
  }
  return agencyPost(request,context);
}
