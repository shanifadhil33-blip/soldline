import { fail } from '../../../server/http';
import { z } from 'zod';
import { assertCan } from '../../../server/permissions';
import { getMember } from '../../../server/session';
import { getOwnerServices } from '../../../server/db/runtime';
const operation=z.object({id:z.uuid(),operation:z.enum(['edit','delete','undo','approve']),text:z.string().optional()}).strict();
export async function GET(request:Request) {
  const member=await getMember(request);
  if(!member) return fail(401);
  const entries=await getOwnerServices().memory.list(member,true);
  return Response.json(entries.map(e=>({id:e.id,text:e.text,scope:e.scope,status:e.status,count:Number(e.based_on_count??0),deleted:!!e.deleted_at})));
}
export async function POST(request:Request) {
  const member=await getMember(request);
  if(!member) return fail(401);
  // The matrix supplies workspace access. The memory service rechecks personal ownership and admin rights.
  assertCan(member,'see_runs',{workspace_id:member.workspace_id,client_company_id:member.client_company_id,task_member_ids:[member.id]});
  const body=await request.json().catch(()=>null);
  if(body?.operation==='forget') {
    if(body.yes!==true) return fail(400, 'Confirm before clearing personal memory');
    return Response.json(await getOwnerServices().memory.forgetPersonal(member,true));
  }
  const data=operation.safeParse(body);
  try {
    if(data.success) return Response.json(await getOwnerServices().memory.change(member,data.data.id,data.data.operation,data.data.text));
    const saved=await getOwnerServices().memory.remember(member,body);
    return Response.json(member.roles.includes('client_reviewer')&&saved.scope==='org'?{id:saved.id,status:saved.status}:saved);
  } catch {return fail(400,member.roles.includes('client_reviewer')?'Memory access refused':'Check the memory and confirm before saving');}
}
