import { getMember } from '../../../../server/session';
import { getAppDriver,getOwnerServices } from '../../../../server/db/runtime';
import { withMember } from '../../../../server/db/withMember';
import { withMemberRoute, answer, fail } from '../../../../server/http';
import { clearDemoWorkspace } from '../../../../server/demo/read-cache';
import { assertCan } from '../../../../server/permissions';
export async function GET(request:Request,context:{params:Promise<Record<string,string>>}) {
  const member=await getMember(request);if(!member)return fail(401);
  const {id}=await context.params;
  const detail=await getOwnerServices().trust.deliverable(member,id);
  if(!detail) return Response.json({message:'Record not found'},{status:404});
  return Response.json({...detail,due:detail.due});
}

export async function POST(request:Request,context:{params:Promise<Record<string,string>>}) {
  const member=await getMember(request);if(!member)return fail(401);
  if(member.is_demo)clearDemoWorkspace(member.workspace_id);
  const {id}=await context.params;
  const visible=await withMember(getAppDriver(),member.id,async db=>(await db.query('SELECT task_id FROM monitor_tasks WHERE task_id=$1',[id])).rows.length>0);
  if(!visible)return fail(404);
  const body=await request.json().catch(()=>null) as {action?:string;note?:string}|null;
  if(body?.action==='changes'){
    const note=typeof body.note==='string'?body.note:'';
    if(!note.trim())return fail(400,'Write what needs to change.');
    const {status,title}=await getOwnerServices().trust.requestChanges(member,id,note,(actor,action,resource)=>assertCan(actor,action,resource)) as {status:number;title?:string};
    return status<400?Response.json({ok:true,message:'Changes requested',title},{status}):fail(status);
  }
  const {status,title}=await getOwnerServices().trust.approveDeliverable(member,id,(actor,action,resource)=>assertCan(actor,action,resource)) as {status:number;title?:string};
  return status<400?Response.json({ok:true,message:'Deliverable approved',title},{status}):fail(status);
}

export const PATCH=withMemberRoute(async(request,context,member)=>{
  const {id}=await context.params;
  const body=await request.json().catch(()=>null);
  if(body?.state!=='started'&&body?.state!=='review')return answer(400,'');
  const {status}=await getOwnerServices().trust.transitionDeliverable(member,id,body.state);
  return answer(status,'Task update queued');
});
