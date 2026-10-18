import 'server-only';
import type { TransactionDriver } from './db/withMember';
import { can,type Member } from './permissions';
import { WorkerConnections } from './jobs/providers';
import { ClickUpClient } from './integrations/clickup';
export function runTaskReader(owner:TransactionDriver) {
  return async(member:Member,id:string)=>{
    const lists=await owner.transaction(async db=>{
      const stored=(await db.query<Member & Record<string,unknown>>(`SELECT m.*,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=$1 AND m.workspace_id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[member.id,member.workspace_id])).rows[0];
      if(!stored||stored.roles.includes('client_reviewer'))return null;
      const run=(await db.query<{id:string;workspace_id:string}>(`SELECT r.id,r.workspace_id FROM runs r WHERE r.id=$1 AND r.workspace_id=$2 AND ($3::text[] && ARRAY['admin','account_manager','delivery_lead']::text[] OR EXISTS(SELECT 1 FROM findings f WHERE f.run_id=r.id AND f.owner_member_id=$4) OR EXISTS(SELECT 1 FROM recovery_items i WHERE i.run_id=r.id AND i.owner_member_id=$4))`,[id,stored.workspace_id,stored.roles,stored.id])).rows[0];
      if(!run||!can(stored,'see_runs',{...run,task_member_ids:[stored.id]}))return null;
      return (await db.query<{external_id:string}>("SELECT DISTINCT external_id FROM external_effects WHERE workspace_id=$1 AND run_id=$2 AND action='create_list' AND state='succeeded' AND external_id IS NOT NULL",[stored.workspace_id,id])).rows;
    });
    if(!lists)return null;
    const client=new ClickUpClient({connections:new WorkerConnections(owner,member.workspace_id),deadline:Date.now()+25000});
    const tasks:Record<string,unknown>[]=[];
    for(const list of lists)for(let page=0;page<1000;page++) {
      const result=await client.getListTasks(list.external_id,page);
      tasks.push(...result.tasks);
      if(result.last_page===true||!result.tasks.length)break;
      if(page===999)throw new Error('Task pages need attention');
    }
    return {tasks,readAt:new Date().toISOString()};
  };
}
