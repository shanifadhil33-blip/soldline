import { getMember } from '../../../server/session';
import { getAppDriver, getOwnerServices } from '../../../server/db/runtime';
import { withMember } from '../../../server/db/withMember';
import { append } from '../../../server/audit';
import { assertCan, ForbiddenError } from '../../../server/permissions';
import { createSchema } from '../../../server/approvals/model';
export async function POST(request:Request) {
  const member=await getMember(request);
  if(!member) return Response.json({message:'Please sign in or try the demo.'},{status:401});
  const data=createSchema.safeParse(await request.json().catch(()=>null));
  if(!data.success || data.data.requestedByType!=='user' || (data.data.requestedByMemberId && data.data.requestedByMemberId!==member.id)) return Response.json({message:'Check the exact approval details'},{status:400});
  const access=await withMember(getAppDriver(),member.id,async db=>{
    const run=(await db.query<{id:string;workspace_id:string}>('SELECT id,workspace_id FROM runs WHERE id=$1',[data.data.runId])).rows[0];
    if(!run) return 404;
    try {assertCan(member,'propose_scope_change',{...run,intent:'propose'});return 200;}
    catch(error) {if(!(error instanceof ForbiddenError)) throw error;await append(db,member.workspace_id,{action:'approval_create',outcome:'denied',target_id:run.id});return 403;}
  });
  if(access!==200) return Response.json({message:access===404?'Record not found':'You do not have permission to request this approval'},{status:access});
  try {
    const {status,...result}=await getOwnerServices().approvals.createApproval(data.data,member);
    return Response.json(result,{status});
  } catch {return Response.json({message:'Check the exact approval details'},{status:400});}
}
