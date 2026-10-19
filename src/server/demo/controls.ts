import 'server-only';
import { loadMessages } from '../../lib/i18n';
const copy=loadMessages('en').backendA4;
import { randomUUID } from 'node:crypto';
import type { TransactionDriver } from '../db/withMember';
import type { Member } from '../permissions';
import { append } from '../audit';
import { HubSpotClient } from '../integrations/hubspot';
import { WorkerConnections } from '../jobs/providers';
import { jobStore, type Connection } from '../jobs/store';
import { SampleInboxProvider } from '../integrations/sample-inbox';
export const demoCommands=['mark_won','replay','change_line_item','clickup_outage','sample_email','revoke_inbox'] as const;
export type DemoCommand=typeof demoCommands[number];
export function demoControls(owner:TransactionDriver) {
  return {async run(member:Member,runId:string,command:DemoCommand,count=3) {
    const context=await owner.transaction(async db=>{
      const actor=(await db.query<Member & Record<string,unknown>>(`SELECT m.*,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.id=$2 AND m.archived_at IS NULL AND w.is_demo AND w.demo_expires_at>now() AND m.roles && ARRAY['admin','account_manager','delivery_lead']`,[member.workspace_id,member.id])).rows[0];
      if(!actor)return null;
      const run=(await db.query<{id:string;deal_id:string;hubspot_deal_id:string;snapshot:Record<string,unknown>}>(`SELECT r.id,r.deal_id,d.hubspot_deal_id,d.snapshot FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND r.id=$2`,[actor.workspace_id,runId])).rows[0];
      if(!run)return null;
      const connection=(await db.query<Connection & {token_ciphertext:string|null}>("SELECT * FROM connections WHERE workspace_id=$1 AND provider='hubspot'",[actor.workspace_id])).rows[0];
      return {actor,run,connection};
    });
    if(!context)return {status:403,message:copy.accessRefused};
    const {actor,run}=context,ws=actor.workspace_id;
    if(!demoCommands.includes(command))return {status:400,message:copy.chooseControl};
    if(command==='replay'){
      const result=await jobStore(owner).replay(actor,runId);
      if(result.status!==404)return result;
      await owner.transaction(async db=>{await db.query("SELECT set_config('app.member_id',$1,true)",[actor.id]);await append(db,ws,{action:'demo_replay',outcome:'succeeded',target_id:runId,after:{newActions:0,stored_event:false}});});
      return {status:200,newActions:0,message:'No stored HubSpot event in this sample yet'};
    }
    if(command==='mark_won') {
      let connection=context.connection;
      // Only a deal explicitly recorded as belonging to this sandbox may be patched.
      const live=!!connection?.token_ciphertext;
      if(live) {
        const client=new HubSpotClient({connections:new WorkerConnections(owner,ws)});
        if(run.snapshot?.demo_sandbox!==ws||run.hubspot_deal_id==='355638664953'||run.hubspot_deal_id.startsWith('sample_')) {
          const created=await client.createDemoDeal('Sample Harbor Coffee Roasters '+ws);
          if(created.id==='355638664953')throw new Error('Sandbox deal refused');
          await owner.transaction(async db=>{
            await db.query(`INSERT INTO demo_resources(workspace_id,provider,external_id,seed_state) VALUES($1,'hubspot',$2,$3) ON CONFLICT DO NOTHING`,[ws,created.id,JSON.stringify({dealstage:created.properties.dealstage??'appointmentscheduled'})]);
            await db.query(`UPDATE deals SET hubspot_deal_id=$3,snapshot=coalesce(snapshot,'{}'::jsonb)||jsonb_build_object('demo_sandbox',$1::text) WHERE workspace_id=$1 AND id=$2`,[ws,run.deal_id,created.id]);
          });
          run.hubspot_deal_id=created.id;
        }
        const current=await client.getDeal(run.hubspot_deal_id);
        await owner.transaction(async db=>{
          await db.query(`INSERT INTO demo_resources(workspace_id,provider,external_id,seed_state) VALUES($1,'hubspot',$2,$3) ON CONFLICT DO NOTHING`,[ws,run.hubspot_deal_id,JSON.stringify({dealstage:current.properties.dealstage??'appointmentscheduled'})]);
        });
        await client.patchDemoDeal(run.hubspot_deal_id,{dealstage:connection.won_stage_id??'closedwon'});
      }
      await owner.transaction(async db=>{
        if(!connection){connection=(await db.query<Connection & {token_ciphertext:string|null}>(`INSERT INTO connections(workspace_id,provider,status,external_account_id,won_stage_id) VALUES($1,'hubspot','paused',$2,'closedwon') RETURNING *`,[ws,'sample:'+ws])).rows[0];}
        await db.query("SELECT set_config('app.member_id',$1,true)",[actor.id]);
        await append(db,ws,{action:'demo_mark_won',outcome:'succeeded',target_id:runId,after:{simulated:!live,label:live?copy.hubspotSandbox:copy.simulatedEventLabel}});
      });
      const jobs=jobStore(owner);
      await jobs.ingestHubspot(connection!,[{portalId:connection!.external_account_id,eventId:'demo_won:'+run.deal_id,objectId:run.hubspot_deal_id,subscriptionType:'deal.propertyChange',propertyName:'dealstage',propertyValue:connection!.won_stage_id??'closedwon',simulated:!live}],'replay');
      const event=await owner.transaction(async db=>(await db.query<{id:string}>("SELECT id FROM inbound_events WHERE workspace_id=$1 AND dedupe_key=$2",[ws,'hubspot:'+connection!.external_account_id+':demo_won:'+run.deal_id])).rows[0]);
      if(event){await jobs.handleEvent(ws,event.id);await owner.transaction(async db=>{await db.query('UPDATE runs SET trigger_event_id=$3 WHERE workspace_id=$1 AND id=$2',[ws,runId,event.id]);});}
      return {status:200,message:live?copy.sandboxWon:copy.simulatedEvent};
    }
    if(command==='sample_email') {
      const connection=await owner.transaction(async db=>(await db.query<Connection>("SELECT * FROM connections WHERE workspace_id=$1 AND provider='mail'",[ws])).rows[0]);
      if(!connection)return {status:409,message:copy.inboxAttention};
      const mail=new SampleInboxProvider(owner,ws,runId);
      const page=await mail.listMessagesSince(new Date(0).toISOString());
      await jobStore(owner).saveMail(connection,page.messages,new Date().toISOString());
    }
    let remoteLine:{id:string;quantity:number}|undefined;
    if(command==='change_line_item'&&context.connection?.token_ciphertext&&run.snapshot?.demo_sandbox===ws){
      const line=await owner.transaction(async db=>(await db.query<{id:string;hubspot_line_item_id:string|null}>('SELECT id,hubspot_line_item_id FROM line_items WHERE workspace_id=$1 AND deal_id=$2 ORDER BY id LIMIT 1',[ws,run.deal_id])).rows[0]);
      if(line?.hubspot_line_item_id){
        const client=new HubSpotClient({connections:new WorkerConnections(owner,ws)});
        const current=await client.getDemoLineItem(line.hubspot_line_item_id);
        const links=current.associations?.deals?.results??[];
        if(links.length!==1||links[0].id!==run.hubspot_deal_id||run.hubspot_deal_id==='355638664953')throw new Error('Sandbox line item refused');
        const quantity=Number(current.properties.quantity??'1')+1;
        if(!Number.isFinite(quantity)||quantity<1)throw new Error('Sandbox quantity refused');
        await client.patchDemoLineItem(line.hubspot_line_item_id,quantity);
        remoteLine={id:line.id,quantity};
      }
    }
    await owner.transaction(async db=>{
      await db.query("SELECT set_config('app.member_id',$1,true)",[actor.id]);
      if(command==='change_line_item') {
        if(remoteLine)await db.query('UPDATE line_items SET quantity=$3 WHERE workspace_id=$1 AND id=$2',[ws,remoteLine.id,remoteLine.quantity]);
        else await db.query(`UPDATE line_items SET quantity=coalesce(quantity,1)+1 WHERE workspace_id=$1 AND id=(SELECT id FROM line_items WHERE workspace_id=$1 AND deal_id=$2 ORDER BY id LIMIT 1)`,[ws,run.deal_id]);
        await db.query(`UPDATE approvals SET status='stale',stale_reason='A sample line item changed' WHERE workspace_id=$1 AND run_id=$2 AND status IN ('pending','approved')`,[ws,runId]);
      }
      if(command==='clickup_outage') {
        const n=Number.isSafeInteger(count)?Math.max(1,Math.min(20,count)):3;
        await db.query(`INSERT INTO demo_faults(workspace_id,provider,mode,fail_next,operation) VALUES($1,'clickup','outage',$2,'task_create') ON CONFLICT(workspace_id,provider) DO UPDATE SET mode='outage',fail_next=$2,operation='task_create'`,[ws,n]);
      }
      if(command==='revoke_inbox') {
        await db.query("UPDATE connections SET status='needs_reconnect',last_error_code='simulated_revoked' WHERE workspace_id=$1 AND provider='mail'",[ws]);
        await db.query(`INSERT INTO recovery_items(workspace_id,run_id,kind,title,plain_reason,owner_member_id,status,allowed_options) SELECT $1,$2,'connection',$3,$4,m.id,'open',ARRAY['resolve_with_note'] FROM members m WHERE m.workspace_id=$1 AND 'admin'=ANY(m.roles) AND NOT EXISTS(SELECT 1 FROM recovery_items WHERE workspace_id=$1 AND plain_reason=$4 AND status='open') ORDER BY m.id LIMIT 1`,[ws,runId,copy.inboxAttention,copy.inboxRevoked]);
      }
      await append(db,ws,{action:'demo_'+command,outcome:'succeeded',target_id:runId,after:{sample:true,request_id:randomUUID()}});
    });
    if(command==='sample_email')await jobStore(owner).monitor({workspace_id:ws,payload:{},run_id:runId} as Parameters<ReturnType<typeof jobStore>['monitor']>[0],Date.now()+25000);
    return {status:200,message:command==='change_line_item'?(remoteLine?copy.sandboxLineChanged:copy.lineChanged):command==='clickup_outage'?copy.outageConfigured:command==='sample_email'?copy.emailReceived:copy.inboxRevoked};
  }};
}
