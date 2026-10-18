import { z } from 'zod';
import { getMember } from '../../../../server/session';
import { getOwnerServices } from '../../../../server/db/runtime';
import { assertCan, ForbiddenError } from '../../../../server/permissions';
const input=z.object({findingId:z.uuid(),to:z.array(z.email()).min(1),body:z.string().trim().min(1).max(10000).refine(s=>!/[\u2013\u2014-]/.test(s),'Use plain words')}).strict();
export async function POST(request:Request) {
  const member=await getMember(request);
  if(!member) return Response.json({message:'Please sign in or try the demo.'},{status:401});
  try {assertCan(member,'approve_client_email',{workspace_id:member.workspace_id});}
  catch(error) {if(!(error instanceof ForbiddenError)) throw error;return Response.json({message:'You do not have permission to draft this reminder'},{status:403});}
  const data=input.safeParse(await request.json().catch(()=>null));
  if(!data.success) return Response.json({message:'Check the reminder details'},{status:400});
  try {
    const {status,...result}=await getOwnerServices().monitors.draftReminder(member,data.data.findingId,data.data.to,data.data.body);
    return Response.json(result,{status});
  } catch {return Response.json({message:'The reminder needs a review first'},{status:409});}
}
