import 'server-only';
import { z } from 'zod';
import { getMember } from '../session';
import { getAppDriver, getOwnerServices } from '../db/runtime';
import type { RouteContext } from '../http';
import { withMember } from '../db/withMember';
import { append } from '../audit';
import { ForbiddenError, type assertCan } from '../permissions';
import { actionSchema } from './store';
export async function recoveryRoute(request:Request,context:RouteContext,operation:'action'|'pause'|'cancel'|'undo',guard:typeof assertCan) {
  const member=await getMember(request);
  if(!member) return Response.json({message:'Please sign in or try the demo.'},{status:401});
  const {id}=await context.params;
  if(!z.uuid().safeParse(id).success) return Response.json({message:'Record not found'},{status:404});
  const access=await withMember(getAppDriver(),member.id,async db=>{
    const resource=(await db.query<{id:string;workspace_id:string;owner_member_id?:string|null}>(operation==='action'?'SELECT id,workspace_id,owner_member_id FROM recovery_items WHERE id=$1':'SELECT id,workspace_id FROM runs WHERE id=$1',[id])).rows[0];
    if(!resource) return 404;
    try {guard(member,operation==='action'?'resolve_recovery':operation==='undo'?'reverse_effect':'approve_plan',resource);return 200;}
    catch(error) {
      if(!(error instanceof ForbiddenError)) throw error;
      await append(db,member.workspace_id,{action:error.action,outcome:'denied',target_id:id});return 403;
    }
  });
  if(access!==200) return Response.json({message:access===403?'You do not have permission to perform this action.':'Record not found'},{status:access});
  const store=getOwnerServices().recovery;
  if(operation==='action') {
    const data=actionSchema.safeParse(await request.json().catch(()=>null));
    if(!data.success) {
      await withMember(getAppDriver(),member.id,db=>append(db,member.workspace_id,{action:'recovery_refused',outcome:'failed',target_id:id,after:{message:'The recovery request is invalid'}}));
      return Response.json({message:'Choose an available action and a plain note'},{status:400});
    }
    const {status,...result}=await store.act(member,id,data.data.option,data.data.note);return Response.json(result,{status});
  }
  const {status,...result}=operation==='undo'?await store.undo(member,id):await store.pause(member,id,operation==='pause'?'paused':'cancelled');
  return Response.json(result,{status});
}
