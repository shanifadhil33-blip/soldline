import { assertCan } from '../../../../../server/permissions';
import { fail, type RouteContext } from '../../../../../server/http';
import { getMember } from '../../../../../server/session';
import { getOwnerServices } from '../../../../../server/db/runtime';
import { z } from 'zod';
export async function POST(r:Request,c:RouteContext){
 const m=await getMember(r);if(!m)return fail(401);
 const {id}=await c.params;if(!z.uuid().safeParse(id).success)return fail(404);
 const data=z.object({choice:z.enum(['yes','change']),note:z.string().trim().max(2000).optional()}).strict().safeParse(await r.json().catch(()=>null));
 if(!data.success)return fail(400);
 try{const {status,...result}=await getOwnerServices().agent.card(m,id,data.data.choice,data.data.note,(member,action,resource)=>assertCan(member,action,resource));return status>=400?fail(status):Response.json(result,{status});}catch{return fail(500);}
}
