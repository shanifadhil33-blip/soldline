import { z } from 'zod';
import { withMemberRoute } from '../../../../server/http';
import { assertCan } from '../../../../server/permissions';
export const GET=withMemberRoute(async (_request,context,member,db)=>{
  const {id}=await context.params;
  const missing=()=>Response.json({message:'Record not found'},{status:404});
  if(!z.uuid().safeParse(id).success) return missing();
  const run=(await db.query<{id:string;workspace_id:string;scope_version_id:string|null;plan:unknown;status:string}>('SELECT id,workspace_id,scope_version_id,plan,status FROM runs WHERE id=$1',[id])).rows[0];
  if(!run) return missing();
  const company=(await db.query<{client_company_id:string}>('SELECT d.client_company_id FROM deals d JOIN runs r ON r.workspace_id=d.workspace_id AND r.deal_id=d.id WHERE r.id=$1',[id])).rows[0];
  assertCan(member,'see_runs',{...run,client_company_id:company?.client_company_id,task_member_ids:[member.id]});
  const items=(await db.query('SELECT key,title,quantity,cadence,source_page,source_quote FROM scope_items WHERE scope_version_id=$1 ORDER BY key',[run.scope_version_id])).rows;
  const inputs=(await db.query('SELECT id,key,label,status,evidence FROM onboarding_inputs WHERE run_id=$1 ORDER BY id',[id])).rows;
  if(member.roles.includes('client_reviewer')) return Response.json({run:{id:run.id,status:run.status},items,inputs});
  const scope=(await db.query('SELECT id,version,status,items_hash FROM scope_versions WHERE id=$1',[run.scope_version_id])).rows[0]??null;
  const findings=(await db.query('SELECT id,kind,severity,title,evidence,status FROM findings WHERE run_id=$1 ORDER BY id',[id])).rows;
  return Response.json({run,scope,items,inputs,findings});
});
