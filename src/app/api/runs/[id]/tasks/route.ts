import { z } from 'zod';
import { getMember } from '../../../../../server/session';
import { assertCan } from '../../../../../server/permissions';
import { getOwnerServices } from '../../../../../server/db/runtime';
import type { RouteContext } from '../../../../../server/http';
export async function GET(request:Request,context:RouteContext) {
  const member=await getMember(request);
  if(!member)return Response.json({message:'Please sign in or try the demo.'},{status:401});
  const {id}=await context.params;
  if(!z.uuid().safeParse(id).success)return Response.json({message:'Record not found'},{status:404});
  if(member.roles.includes('client_reviewer'))return Response.json({message:'This view is for the team'},{status:403});
  assertCan(member,'see_runs',{id,workspace_id:member.workspace_id,task_member_ids:[member.id]});
  try {
    const result=await getOwnerServices().readRunTasks(member,id);
    return result?Response.json(result):Response.json({message:'Record not found'},{status:404});
  } catch {return Response.json({message:'Tasks could not be read'},{status:503});}
}
