import { getMember } from '../../../../../server/session';
import { getOwnerServices } from '../../../../../server/db/runtime';
import { assertCan } from '../../../../../server/permissions';
import type { RouteContext } from '../../../../../server/http';
export async function POST(request:Request,context:RouteContext) {
  const member=await getMember(request);
  if(!member) return Response.json({message:'Please sign in or try the demo.'},{status:401});
  const {id}=await context.params;
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) return Response.json({message:'Run not found'},{status:404});
  // The named service checks the stored role, including the demo Omar exception.
  assertCan(member,'see_runs',{workspace_id:member.workspace_id,client_company_id:member.client_company_id,task_member_ids:[member.id]});
  const {status,...result}=await getOwnerServices().jobs.replay(member,id);
  return Response.json(result,{status});
}
