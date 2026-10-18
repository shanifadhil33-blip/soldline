import { withMemberRoute } from '../../../../server/http';
import { assertCan } from '../../../../server/permissions';
export const GET=withMemberRoute(async (_request,context,member,db)=>{
  const {id}=await context.params;
  const row=(await db.query<{workspace_id:string;client_company_id:string;task_id:string;status:string;due_at:string|null;title:string|null}>(`SELECT t.workspace_id,d.client_company_id,t.task_id,t.status,t.due_at,s.title FROM monitor_tasks t JOIN runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id LEFT JOIN scope_items s ON s.workspace_id=t.workspace_id AND s.id=t.scope_item_id WHERE t.task_id=$1 ORDER BY t.observed_at DESC LIMIT 1`,[id])).rows[0];
  if(!row) return Response.json({message:'Record not found'},{status:404});
  assertCan(member,'see_runs',{...row,task_member_ids:[member.id]});
  return Response.json({id:row.task_id,title:row.title,status:row.status,due:row.due_at});
});
