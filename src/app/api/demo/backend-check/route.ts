import { fail } from '../../../../server/http';
import { assertCan,ForbiddenError } from '../../../../server/permissions';
import { z } from 'zod';
import { getMember } from '../../../../server/session';
import { getAppDriver,getOwnerServices } from '../../../../server/db/runtime';
import { withMember } from '../../../../server/db/withMember';
import { cookieName,readCookie,verifyDemo,signDemo } from '../../../../server/demo/cookie';
import { POST as approve } from '../../runs/[id]/approve-plan/route';
export async function POST(request:Request) {
  const member=await getMember(request);
  if(!member)return fail(401);
  if(!member.is_demo)return fail(403,'The backend check runs only inside the demo.');
  const ticket=verifyDemo(readCookie(request,cookieName),process.env.DEMO_SIGNING_KEY??'');
  if(!ticket||ticket.sandbox!==member.workspace_id)return fail(403,'Your demo session has ended. Start the demo again.');
  const body=z.object({runId:z.uuid()}).strict().safeParse(await request.json().catch(()=>null));
  if(!body.success)return fail(400,'Choose a run to check.');
  const id=body.data.runId;
  const visible=await withMember(getAppDriver(),member.id,async db=>(await db.query('SELECT id FROM runs WHERE id=$1',[id])).rows.length>0);
  if(!visible)return fail(404);
  try{assertCan(member,'read_audit',{workspace_id:member.workspace_id,owner_member_id:member.id});}catch(error){if(!(error instanceof ForbiddenError))throw error;return fail(403,'The backend check shows history, which your role cannot open. Switch to the agency director, account manager or delivery lead.');}
  const before=await getOwnerServices().trust.audit(member);
  if(before.status!==200)return fail(403,'History could not be read for this person.');
  const previous=new Set(before.rows?.map(row=>String(row.id)));
  const path=`/api/runs/${id}/approve-plan`;
  const response=await approve(new Request(new URL(path,request.url),{method:'POST',headers:{cookie:`${cookieName}=${signDemo({...ticket,persona:'ravi'},process.env.DEMO_SIGNING_KEY!)}`}}),{params:Promise.resolve({id})});
  const result=await response.json();
  const audit=await getOwnerServices().trust.audit(member);
  const row=audit.rows?.find(row=>!previous.has(String(row.id))&&row.action==='approve_plan'&&row.outcome==='denied'&&row.target_id===id);
  if(!row)return Response.json({message:'The refusal was saved, but it is not in the history you can see. Ask an admin to check History.'},{status:409});
  return Response.json({request:{method:'POST',path},status:response.status,message:result.message,row});
}
