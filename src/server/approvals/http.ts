import 'server-only';
import { z } from 'zod';
import { getMember } from '../session';
import { getAppDriver, getOwnerServices } from '../db/runtime';
import { withMember } from '../db/withMember';
import { append } from '../audit';
import { ForbiddenError, type assertCan } from '../permissions';
import type { RouteContext } from '../http';
import { actions, type Approval } from './model';
const decisionSchema=z.object({decision:z.enum(['approve','reject']),note:z.string().max(10000).default('')}).strict();
export async function approvalRoute(request:Request,context:RouteContext,operation:'decide'|'confirm'|'execute'|'plan',guard:typeof assertCan) {
  const member=await getMember(request);
  if(!member) return Response.json({message:'Please sign in or try the demo.'},{status:401});
  const {id}=await context.params;
  if(!z.uuid().safeParse(id).success) return Response.json({message:'Approval not found'},{status:404});
  const lookup=await withMember(getAppDriver(),member.id,async db=>{
    try {
      if(operation==='plan') {
        guard(member,'approve_plan',{id,workspace_id:member.workspace_id});
        const run=(await db.query<{id:string;workspace_id:string}>('SELECT id,workspace_id FROM runs WHERE id=$1',[id])).rows[0];
        if(!run) return {status:404,message:'Run not found'};
        guard(member,'approve_plan',run);
      }
      const a=(await db.query<Approval>(operation==='plan'
        ? "SELECT * FROM approvals WHERE run_id=$1 AND kind IN ('plan_correction','provision') AND status='pending' ORDER BY expires_at,id LIMIT 1"
        : 'SELECT * FROM approvals WHERE id=$1',[id])).rows[0];
      if(!a) return {status:404,message:'Approval not found'};
      guard(member,actions[a.kind],a);
      return {status:200,message:'Approval found',id:a.id};
    } catch(error) {
      if(!(error instanceof ForbiddenError)) throw error;
      await append(db,member.workspace_id,{action:error.action,outcome:'denied',target_type:operation==='plan'?'run':'approval',target_id:error.resource.id,...(operation==='plan'?{}:{approval_id:error.resource.id})});
      return {status:403,message:error.message};
    }
  });
  if(!lookup.id) return Response.json({error:lookup.status===403?'not_allowed':'not_found',message:lookup.message},{status:lookup.status});
  let decision:{decision:'approve'|'reject';note:string}={decision:'approve',note:''};
  if(operation==='decide') {
    const parsed=decisionSchema.safeParse(await request.json().catch(()=>null));
    if(!parsed.success) {
      await withMember(getAppDriver(),member.id,db=>append(db,member.workspace_id,{action:'approval_decide',outcome:'failed',target_type:'approval',target_id:lookup.id,approval_id:lookup.id,after:{message:'The decision request is invalid'}}));
      return Response.json({message:'Choose approve or reject and provide a plain note'},{status:400});
    }
    decision=parsed.data;
  }
  const store=getOwnerServices().approvals;
  const result=operation==='decide'||operation==='plan' ? await store.decide(lookup.id,member,decision.decision,decision.note) : await store[operation](lookup.id,member);
  const {status,...body}=result;
  return Response.json(body,{status});
}
