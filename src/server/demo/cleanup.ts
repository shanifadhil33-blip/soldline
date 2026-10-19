import 'server-only';
import type { TransactionDriver } from '../db/withMember';
import type { Job } from '../jobs/store';
import { systemAudit } from '../jobs/store';
import { ClickUpClient } from '../integrations/clickup';
import { HubSpotClient } from '../integrations/hubspot';
import { WorkerConnections } from '../jobs/providers';
/** Payload ids are deliberately ignored. Only the sandbox resource ledger authorizes remote cleanup. */
export async function cleanupSandbox(owner:TransactionDriver,job:Job,deadline:number) {
  const ws=job.workspace_id;
  const expired=await owner.transaction(async db=>(await db.query(`SELECT id FROM workspaces WHERE id=$1 AND is_demo AND (demo_expires_at<=now() OR created_at<=now()-interval '6 hours')`,[ws])).rows.length>0);
  if(!expired)return;
  const resources=await owner.transaction(async db=>(await db.query<{id:string;provider:string;external_id:string;seed_state:{dealstage?:string}}>('SELECT * FROM demo_resources WHERE workspace_id=$1 AND cleaned_at IS NULL ORDER BY provider,id',[ws])).rows);
  const options={connections:new WorkerConnections(owner,ws),deadline};
  try{
    for(const resource of resources){
      if(resource.external_id.startsWith('sample_')||resource.external_id==='355638664953')throw new Error('Cleanup resource refused');
      if(resource.provider==='clickup')await new ClickUpClient(options).deleteFolder(resource.external_id);
      else {
        if(!resource.seed_state.dealstage)throw new Error('Sandbox seed stage is missing');
        await new HubSpotClient(options).patchDemoDeal(resource.external_id,{dealstage:resource.seed_state.dealstage,soldline_delivery_status:'Not started',soldline_plan_url:'',soldline_run_ref:''});
      }
      await owner.transaction(async db=>{
        await db.query('UPDATE demo_resources SET cleaned_at=now() WHERE workspace_id=$1 AND id=$2',[ws,resource.id]);
        await systemAudit(db,ws,'schedule','demo_resource_cleaned',resource.id);
      });
    }
    await owner.transaction(async db=>{
      await systemAudit(db,ws,'schedule','demo_cleanup_completed',job.id);
      await db.query(`DELETE FROM workspaces WHERE id=$1 AND is_demo AND (demo_expires_at<=now() OR created_at<=now()-interval '6 hours')`,[ws]);
    });
  }catch(error){
    await owner.transaction(async db=>{
      await db.query(`INSERT INTO recovery_items(workspace_id,job_id,kind,title,plain_reason,status,allowed_options,owner_member_id) SELECT $1,$2,'demo_cleanup','Sample sandbox cleanup needs attention','Cleanup will retry on the next tick','open',ARRAY['retry'],m.id FROM members m WHERE m.workspace_id=$1 AND 'admin'=ANY(m.roles) ORDER BY m.id LIMIT 1 ON CONFLICT(workspace_id,job_id) WHERE job_id IS NOT NULL DO UPDATE SET plain_reason=excluded.plain_reason,status='open'`,[ws,job.id]);
      await systemAudit(db,ws,'schedule','demo_cleanup_failed',job.id);
    });
    throw error;
  }
}
