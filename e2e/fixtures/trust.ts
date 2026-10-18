import { randomUUID } from 'node:crypto';
import type { TransactionDriver } from '@/server/db/withMember';
export async function prepareTrust(owner:TransactionDriver,ws:string) {
  await owner.transaction(async db=>{
    const members=(await db.query<{id:string;preferred_name:string}>('SELECT id,preferred_name FROM members WHERE workspace_id=$1',[ws])).rows;
    const lead=members.find(m=>m.preferred_name==='imran')!.id;
    const runs=(await db.query<{id:string;deal_id:string;scope_version_id:string|null;name:string}>('SELECT r.*,d.name FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1',[ws])).rows;
    const harbor=runs.find(r=>r.name.startsWith('Harbor'))!,cedar=runs.find(r=>r.name.startsWith('Cedar'))!;
    await db.query('UPDATE runs SET delivery_lead_id=$2 WHERE workspace_id=$1',[ws,lead]);
    const version=randomUUID(),item=randomUUID();
    await db.query("INSERT INTO scope_versions(id,workspace_id,deal_id,version,status) VALUES($1,$2,$3,1,'accepted')",[version,ws,cedar.deal_id]);
    await db.query("INSERT INTO scope_items(id,workspace_id,scope_version_id,key,title) VALUES($1,$2,$3,'1','Cedar launch design')",[item,ws,version]);
    await db.query('UPDATE runs SET scope_version_id=$2 WHERE id=$1',[cedar.id,version]);
    await db.query("INSERT INTO onboarding_inputs(workspace_id,run_id,key,label,status) VALUES($1,$2,'brand_files','Cedar brand files','missing')",[ws,cedar.id]);
    const harborItem=(await db.query<{id:string}>('SELECT id FROM scope_items WHERE scope_version_id=$1 ORDER BY key LIMIT 1',[harbor.scope_version_id])).rows[0].id;
    for(const [run,scope,prefix] of [[harbor,harborItem,'harbor'],[cedar,item,'cedar']] as const)await db.query("INSERT INTO monitor_tasks(workspace_id,run_id,task_id,scope_item_id,status,review_since,observed_at) VALUES($1,$2,$3,$4,'Client review',now(),now())",[ws,run.id,prefix+ws,scope]);
    for(const [index,option] of ['resolve_with_note','retry_now','reconcile','cancel_remaining'].entries()) {
      const job=randomUUID();
      await db.query("INSERT INTO jobs(id,workspace_id,run_id,kind,status,attempts,payload) VALUES($1,$2,$3,'analyse_deal','dead',5,'{}')",[job,ws,harbor.id]);
      await db.query("INSERT INTO recovery_items(workspace_id,run_id,job_id,owner_member_id,title,plain_reason,status,allowed_options,created_at) VALUES($1,$2,$3,$4,$5,'Review the recorded issue before continuing','open',$6,now()+($7::text||' seconds')::interval)",[ws,harbor.id,job,lead,['Review delivery note','Retry delivery work','Check sent mail','Cancel remaining work'][index],[option],index]);
    }
    await db.query("INSERT INTO connections(workspace_id,provider,status,scopes,allowed_actions) VALUES($1,'mail','needs_reconnect',ARRAY['mail:read','mail:send'],'[\"send_message\"]')",[ws]);
    await db.query("UPDATE connections SET scopes=ARRAY['crm.objects.deals.read','crm.objects.deals.write'],allowed_actions='[\"patch_deal_properties\"]' WHERE workspace_id=$1 AND provider='hubspot'",[ws]);
    await db.query("UPDATE connections SET scopes=ARRAY['tasks:read','tasks:write'],allowed_actions='[\"create_task\",\"create_list\"]' WHERE workspace_id=$1 AND provider='clickup'",[ws]);
  });
}
