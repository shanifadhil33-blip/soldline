import { assertCan,ForbiddenError } from '../../../../server/permissions';
import { z } from 'zod';
import { getMember } from '../../../../server/session';
import { getAppDriver,getOwnerServices } from '../../../../server/db/runtime';
import { withMember } from '../../../../server/db/withMember';
import { cookieName,readCookie,verifyDemo,signDemo } from '../../../../server/demo/cookie';
import { POST as approve } from '../../runs/[id]/approve-plan/route';
export async function POST(request:Request) {
  const member=await getMember(request);
  if(!member)return Response.json({},{status:401});
  if(!member.is_demo)return Response.json({},{status:403});
  const ticket=verifyDemo(readCookie(request,cookieName),process.env.DEMO_SIGNING_KEY??'');
  if(!ticket||ticket.sandbox!==member.workspace_id)return Response.json({},{status:403});
  const body=z.object({runId:z.uuid()}).strict().safeParse(await request.json().catch(()=>null));
  if(!body.success)return Response.json({},{status:400});
  const id=body.data.runId;
  const visible=await withMember(getAppDriver(),member.id,async db=>(await db.query('SELECT id FROM runs WHERE id=$1',[id])).rows.length>0);
  if(!visible)return Response.json({},{status:404});
  try{assertCan(member,'read_audit',{workspace_id:member.workspace_id,owner_member_id:member.id});}catch(error){if(!(error instanceof ForbiddenError))throw error;return Response.json({},{status:403});}
  const before=await getOwnerServices().trust.audit(member);
  if(before.status!==200)return Response.json({},{status:403});
  const previous=new Set(before.rows?.map(row=>String(row.id)));
  const path=`/api/runs/${id}/approve-plan`;
  const response=await approve(new Request(new URL(path,request.url),{method:'POST',headers:{cookie:`${cookieName}=${signDemo({...ticket,persona:'ravi'},process.env.DEMO_SIGNING_KEY!)}`}}),{params:Promise.resolve({id})});
  const result=await response.json();
  const audit=await getOwnerServices().trust.audit(member);
  const row=audit.rows?.find(row=>!previous.has(String(row.id))&&row.action==='approve_plan'&&row.outcome==='denied'&&row.target_id===id);
  if(!row)return Response.json({},{status:500});
  return Response.json({request:{method:'POST',path},status:response.status,message:result.message,row});
}
