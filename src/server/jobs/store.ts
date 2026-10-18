import 'server-only';
import { monitorStore } from '../monitors/store';
import { executorStore } from '../executor/store';
import { executorProviders } from '../executor/providers';
import { executeEffects } from '../executor/worker';
import { scopeStore } from '../scope/store';
import { createHash, randomUUID } from 'node:crypto';
import type { SqlConnection, TransactionDriver } from '../db/withMember';
import { hubspotEvent, type HubspotEvent, type ReceivedVia } from '../events/model';
import type { MailMessage } from '../integrations/mail';
import type { CrmObject } from '../integrations/hubspot';
import type { Member } from '../permissions';
export type Actor = 'webhook' | 'schedule' | 'system';
export async function systemAudit(db: SqlConnection, ws: string, actor: Actor, action: string, target?: string, after?: unknown) {
  await db.query('SELECT audit_system_append($1,$2,$3::jsonb)', [ws, actor, JSON.stringify({ action, outcome: /(?:failed|dead)$/.test(action) ? 'failed' : 'succeeded', target_id: target, after })]);
}
export type Connection = { id: string; workspace_id: string; provider: string; external_account_id: string; poll_cursor: string | null; won_stage_id: string | null; delivery_lead_id: string | null; webhook_secrets: Record<string,string> };
export type Job = { id: string; workspace_id: string; kind: string; payload: Record<string,string>; run_id: string | null; attempts: number; lock_token: string; exhausted?: boolean };
const delays = [30000,120000,600000,1800000,7200000];
async function enqueue(db: SqlConnection, ws: string, kind: string, key: string, payload: unknown, actor: Actor, run?: string) {
  const result = await db.query<{id:string}>(`INSERT INTO jobs(workspace_id,kind,dedupe_key,payload,run_id,status,attempts,max_attempts,next_attempt_at) VALUES($1,$2,$3,$4,$5,'queued',0,5,now()) ON CONFLICT(workspace_id,dedupe_key) DO NOTHING RETURNING id`, [ws,kind,key,JSON.stringify(payload),run ?? null]);
  if (result.rows[0]) await systemAudit(db,ws,actor,'job_queued',result.rows[0].id);
  return result.rows.length;
}
async function ingest(db: SqlConnection, connection: Connection, event: HubspotEvent, via: ReceivedVia) {
  const actor = via === 'webhook' ? 'webhook' : via === 'reconcile' ? 'schedule' : 'system';
  const key = `hubspot:${event.portalId}:${event.eventId}`;
  const result = await db.query<{id:string}>(`INSERT INTO inbound_events(workspace_id,source,dedupe_key,event_type,external_object_id,raw,signature_ok,received_via,received_at) VALUES($1,'hubspot',$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(workspace_id,dedupe_key) DO NOTHING RETURNING id`, [connection.workspace_id,key,event.subscriptionType,event.objectId,JSON.stringify(event),via==='webhook',via]);
  const row = result.rows[0];
  if (!row) return 0;
  await systemAudit(db,connection.workspace_id,actor,'event_received',row.id,{received_via:via});
  await enqueue(db,connection.workspace_id,'process_event',`event:${row.id}`,{eventId:row.id},actor);
  return 1;
}
async function handle(db: SqlConnection, ws: string, eventId: string, via?: 'replay') {
  const result = await db.query<{raw:unknown}>("SELECT raw FROM inbound_events WHERE workspace_id=$1 AND id=$2 AND source='hubspot'", [ws,eventId]);
  if (!result.rows[0]) return 0;
  const event = hubspotEvent.parse(result.rows[0].raw);
  const config = await db.query<Connection>("SELECT * FROM connections WHERE workspace_id=$1 AND provider='hubspot'", [ws]);
  const connection = config.rows[0];
  if (!connection?.won_stage_id) throw new Error('Won stage needs setup');
  let count = 0;
  if (event.subscriptionType==='deal.propertyChange' && event.propertyName==='dealstage' && event.propertyValue===connection.won_stage_id) {
    count = await enqueue(db,ws,'analyse_deal',`deal:${event.objectId}:analyse`,{eventId,dealId:event.objectId},'system');
  }
  await db.query('UPDATE inbound_events SET processed_at=now(),result=$3 WHERE workspace_id=$1 AND id=$2', [ws,eventId,count ? 'Job queued' : 'No new actions']);
  await systemAudit(db,ws,'system','event_processed',eventId,{received_via:via ?? 'worker',newActions:count});
  return count;
}
/** The owner driver stays in this closure. All methods implement fixed, workspace scoped operations. */
export function jobStore(owner: TransactionDriver) {
  return {
    async executeEffect(job:Job,deadline=Date.now()+25000) {
      const store=executorStore(owner);
      const data=await store.load(job);
      if(data) await executeEffects(store,job,executorProviders(owner,job.workspace_id,data.inbox,deadline),job.payload.reconcileOnly==='true',(ws,id)=>monitorStore(owner).memberName(ws,id));
    },
    async monitor(job:Job,deadline:number) {
      const monitors=monitorStore(owner);
      const runs=await owner.transaction(async db=>(await db.query<{id:string}>("SELECT id FROM runs WHERE workspace_id=$1 AND status NOT IN ('paused','cancelled')",[job.workspace_id])).rows);
      for(const run of runs) await monitors.refreshTasks(job.workspace_id,run.id,Date.now(),deadline);
      await monitors.scan(job.workspace_id);
    },
    async hubspotConnections(portal: string) {
      return owner.transaction(async db => (await db.query<Connection>("SELECT c.* FROM connections c JOIN workspaces w ON w.id=c.workspace_id WHERE provider='hubspot' AND status='connected' AND external_account_id=$1 AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())",[portal])).rows);
    },
    async clickupConnections() {
      return owner.transaction(async db => (await db.query<Connection>("SELECT c.* FROM connections c JOIN workspaces w ON w.id=c.workspace_id WHERE provider='clickup' AND status='connected' AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())")).rows);
    },
    ingestHubspot(connection: Connection, events: HubspotEvent[], via: ReceivedVia) {
      return owner.transaction(async db => { let count=0; for(const event of events) { if(event.portalId!==connection.external_account_id) throw new Error('Portal refused'); count+=await ingest(db,connection,event,via); } return count; });
    },
    ingestClickup(connection: Connection, webhook: string, event: string, task: string | undefined, items: {id:string}[], raw: unknown) {
      return owner.transaction(async db => {
        let count=0;
        for(const item of items) {
          const r=await db.query<{id:string}>(`INSERT INTO inbound_events(workspace_id,source,dedupe_key,event_type,external_object_id,raw,signature_ok,received_via,received_at,processed_at,result) VALUES($1,'clickup',$2,$3,$4,$5,true,'webhook',now(),now(),'Recorded') ON CONFLICT(workspace_id,dedupe_key) DO NOTHING RETURNING id`,[connection.workspace_id,`clickup:${webhook}:${item.id}`,event,task ?? null,JSON.stringify(raw)]);
          count+=r.rows.length;
          if(r.rows[0]) await systemAudit(db,connection.workspace_id,'webhook','event_received',r.rows[0].id);
        }
        return count;
      });
    },
    schedule(now: number, daily=false) {
      return owner.transaction(async db => {
        const rows=await db.query<Connection>("SELECT c.* FROM connections c JOIN workspaces w ON w.id=c.workspace_id WHERE c.status='connected' AND c.provider IN ('mail','hubspot') AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())");
        if(!daily) {
          const workspaces=await db.query<{id:string}>("SELECT id FROM workspaces WHERE NOT coalesce(is_demo,false) OR demo_expires_at>now()");
          for(const ws of workspaces.rows) await enqueue(db,ws.id,'monitor_workspace',`monitor:${Math.floor(now/300000)}`,{},'schedule');
        }
        for(const c of rows.rows) {
          if(c.provider==='mail' && daily) continue;
          const kind=c.provider==='mail'?'mail_poll':'reconcile_hubspot';
          await enqueue(db,c.workspace_id,kind,`${kind}:${c.id}:${Math.floor(now/300000)}`,{connectionId:c.id},'schedule');
          if(daily && c.provider==='hubspot') await enqueue(db,c.workspace_id,'hubspot_keep_alive',`keep_alive:${c.id}:${Math.floor(now/86400000)}`,{connectionId:c.id},'schedule');
        }
      });
    },
    claim(now: number) {
      return owner.transaction(async db => {
        const r=await db.query<Job>(`WITH candidate AS (SELECT id,coalesce(attempts,0) AS previous_attempts FROM jobs WHERE NOT EXISTS(SELECT 1 FROM jobs busy WHERE busy.workspace_id=jobs.workspace_id AND busy.run_id=jobs.run_id AND busy.id<>jobs.id AND busy.kind='execute_approval_effect' AND jobs.kind='execute_approval_effect' AND busy.status='running' AND busy.locked_until>$1) AND kind IN ('process_event','analyse_deal','mail_poll','reconcile_hubspot','hubspot_keep_alive','execute_approval_effect','monitor_workspace') AND ((status IN ('queued','failed') AND coalesce(next_attempt_at,'epoch') <= $1) OR (status='running' AND locked_until <= $1)) ORDER BY next_attempt_at NULLS FIRST,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs j SET status='running',attempts=least(coalesce(attempts,0)+1,5),locked_until=$2,lock_token=$3 FROM candidate c WHERE j.id=c.id RETURNING j.*,c.previous_attempts>=5 AS exhausted`,[new Date(now).toISOString(),new Date(now+120000).toISOString(),randomUUID()]);
        const job=r.rows[0];
        if(job) await systemAudit(db,job.workspace_id,'system','job_claimed',job.id);
        return job;
      });
    },
    finish(job: Job, ok: boolean, now: number) {
      return owner.transaction(async db => {
        const rows=await db.query<{id:string}>(`UPDATE jobs SET status=$4,locked_until=NULL,lock_token=NULL,next_attempt_at=$5,last_error_code=$6 WHERE workspace_id=$1 AND id=$2 AND lock_token=$3 AND status='running' RETURNING id`,[job.workspace_id,job.id,job.lock_token,ok?'done':job.attempts>=5?'dead':'failed',new Date(now+delays[Math.min(job.attempts-1,4)]).toISOString(),ok?null:'job_failed']);
        if(!rows.rows.length) return;
        if(!ok && job.attempts>=5) {
          await db.query(`INSERT INTO recovery_items(workspace_id,run_id,job_id,kind,title,plain_reason,owner_member_id,status,allowed_options) SELECT $1,coalesce($2::uuid,(SELECT run_id FROM jobs WHERE workspace_id=$1 AND id=$3)),$3,'job_failed','A job needs attention','This job could not finish after five attempts',coalesce((SELECT delivery_lead_id FROM runs WHERE workspace_id=$1 AND id=coalesce($2::uuid,(SELECT run_id FROM jobs WHERE workspace_id=$1 AND id=$3))),(SELECT delivery_lead_id FROM connections WHERE workspace_id=$1 AND id=$4)),'open',CASE WHEN $5='execute_approval_effect' THEN ARRAY['retry_now','resolve_with_note','cancel_remaining','reconcile'] ELSE ARRAY['retry'] END ON CONFLICT DO NOTHING`,[job.workspace_id,job.run_id,job.id,job.payload.connectionId ?? null,job.kind]);
          await systemAudit(db,job.workspace_id,'system','recovery_created',job.id);
        }
        await systemAudit(db,job.workspace_id,'system',ok?'job_done':job.attempts>=5?'job_dead':'job_failed',job.id);
      });
    },
    handleEvent(ws: string, eventId: string) { return owner.transaction(db=>handle(db,ws,eventId)); },
    hasDeal(ws: string, dealId: string) { return owner.transaction(async db=>(await db.query('SELECT id FROM deals WHERE workspace_id=$1 AND hubspot_deal_id=$2',[ws,dealId])).rows.length>0); },
    importDeal(ws: string, deal: CrmObject) {
      return owner.transaction(async db=>{
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ws+':deal:'+deal.id]);
        const exists=await db.query('SELECT id FROM deals WHERE workspace_id=$1 AND hubspot_deal_id=$2',[ws,deal.id]);
        if(exists.rows.length) return;
        const companyId=deal.associations?.companies?.results[0]?.id ?? `pending:${deal.id}`;
        const companies=await db.query<{id:string}>('SELECT id FROM client_companies WHERE workspace_id=$1 AND hubspot_company_id=$2 ORDER BY id LIMIT 1',[ws,companyId]);
        let company=companies.rows[0]?.id;
        if(!company) {
          const r=await db.query<{id:string}>("INSERT INTO client_companies(workspace_id,name,hubspot_company_id) VALUES($1,'Client',$2) RETURNING id",[ws,companyId]);
          company=r.rows[0].id;
        }
        await db.query(`INSERT INTO deals(workspace_id,client_company_id,hubspot_deal_id,name,stage,snapshot,hs_modified_at,owner_member_id) VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT id FROM members WHERE workspace_id=$1 AND hubspot_owner_id=$8 AND archived_at IS NULL ORDER BY id LIMIT 1)) ON CONFLICT(workspace_id,hubspot_deal_id) DO NOTHING`,[ws,company,deal.id,deal.properties.dealname ?? 'Delivery',deal.properties.dealstage,JSON.stringify(deal),deal.properties.hs_lastmodifieddate && Number.isFinite(Date.parse(deal.properties.hs_lastmodifieddate))?new Date(deal.properties.hs_lastmodifieddate).toISOString():null,deal.properties.hubspot_owner_id ?? null]);
        await systemAudit(db,ws,'system','deal_imported',deal.id);
      });
    },
    async analyse(job: Job) {
      const runId = await owner.transaction(async db => {
        const ws=job.workspace_id;
        const dealRows=await db.query<{id:string}>(`SELECT id FROM deals WHERE workspace_id=$1 AND hubspot_deal_id=$2 FOR UPDATE`,[ws,job.payload.dealId]);
        const deal=dealRows.rows[0];
        if(!deal) throw new Error('Deal needs importing');
        const scopes=await db.query<{items_hash:string|null;id:string}>("SELECT id,items_hash FROM scope_versions WHERE workspace_id=$1 AND deal_id=$2 AND status='accepted' ORDER BY version DESC LIMIT 1",[ws,deal.id]);
        const scope=scopes.rows[0];
        const hash=scope?.items_hash ?? createHash('sha256').update(scope?.id ?? 'pending').digest('hex');
        const key=`deal:${job.payload.dealId}:won:${hash}`;
        const newRunId=randomUUID();
        const inbox=(await db.query<{external_account_id:string}>("SELECT external_account_id FROM connections WHERE workspace_id=$1 AND provider='mail'",[ws])).rows[0]?.external_account_id;
        const parts=inbox?.split('@');
        const plus=parts?.length===2?`${parts[0].split('+')[0]}+run${newRunId.replaceAll('-','')}@${parts[1]}`:null;
        const r=await db.query<{id:string}>(`INSERT INTO runs(id,plus_address,workspace_id,deal_id,run_key,status,trigger_event_id,scope_version_id,won_at,delivery_lead_id) VALUES($6,$7,$1,$2,$3,'received',$4,$5,now(),coalesce((SELECT delivery_lead_id FROM connections WHERE workspace_id=$1 AND provider='hubspot'),(SELECT id FROM members WHERE workspace_id=$1 AND 'delivery_lead'=ANY(roles) AND archived_at IS NULL ORDER BY id LIMIT 1))) ON CONFLICT(workspace_id,run_key) DO NOTHING RETURNING id`,[ws,deal.id,key,job.payload.eventId,scope?.id ?? null,newRunId,plus]);
        const run=r.rows[0] ?? (await db.query<{id:string}>('SELECT id FROM runs WHERE workspace_id=$1 AND run_key=$2',[ws,key])).rows[0];
        await db.query('UPDATE jobs SET run_id=$3 WHERE workspace_id=$1 AND id=$2',[ws,job.id,run.id]);
        await db.query('UPDATE inbound_events SET run_id=$3 WHERE workspace_id=$1 AND id=$2',[ws,job.payload.eventId,run.id]);
        await systemAudit(db,ws,'system',r.rows.length?'run_received':'run_reused',run.id);
        return run.id;
      });
      await scopeStore(owner).analyseRun(job.workspace_id,runId);
      return runId;
    },
    connection(ws: string, id: string) { return owner.transaction(async db=>(await db.query<Connection>("SELECT * FROM connections WHERE workspace_id=$1 AND id=$2 AND status='connected'",[ws,id])).rows[0]); },
    saveReconcile(connection: Connection, events: HubspotEvent[], cursor: string) {
      return owner.transaction(async db=>{ for(const event of events) await ingest(db,connection,event,'reconcile'); await db.query('UPDATE connections SET poll_cursor=$3 WHERE workspace_id=$1 AND id=$2',[connection.workspace_id,connection.id,cursor]); await systemAudit(db,connection.workspace_id,'schedule','reconcile_saved',connection.id); });
    },
    saveMail(connection: Connection, messages: MailMessage[], cursor: string) {
      return owner.transaction(async db=>{
        for(const message of messages) {
          const linked=await db.query<{id:string}>(`SELECT id FROM runs WHERE workspace_id=$1 AND (($2::text IS NOT NULL AND $2=ANY(mail_thread_ids)) OR lower(plus_address)=ANY($3::text[])) ORDER BY id LIMIT 1`,[connection.workspace_id,message.thread_id ?? null,(message.to ?? []).map(v=>v.toLowerCase())]);
          const run=linked.rows[0];
          if(!run) continue;
          const r=await db.query<{id:string}>(`INSERT INTO inbound_events(workspace_id,source,dedupe_key,event_type,external_object_id,raw,received_via,received_at,processed_at,result,run_id) VALUES($1,'mail',$2,'message',$3,$4,'poll',now(),now(),'Stored',$5) ON CONFLICT(workspace_id,dedupe_key) DO NOTHING RETURNING id`,[connection.workspace_id,`mail:${connection.id}:${message.message_id}`,message.message_id,JSON.stringify(message),run.id]);
          if(r.rows[0]) await systemAudit(db,connection.workspace_id,'schedule','mail_received',r.rows[0].id);
          if(message.thread_id && r.rows.length) await db.query('UPDATE runs SET mail_thread_ids=array_append(mail_thread_ids,$3) WHERE workspace_id=$1 AND id=$2 AND NOT ($3=ANY(mail_thread_ids))',[connection.workspace_id,run.id,message.thread_id]);
        }
        await db.query('UPDATE connections SET poll_cursor=$3 WHERE workspace_id=$1 AND id=$2',[connection.workspace_id,connection.id,cursor]);
        await systemAudit(db,connection.workspace_id,'schedule','mail_cursor_saved',connection.id);
      });
    },
    replay(member: Member, runId: string) {
      return owner.transaction(async db=>{
        // Recheck the stored member and workspace even when the caller came through a member route.
        const allowed=await db.query<{allowed:boolean}>(`SELECT (m.roles && ARRAY['admin','delivery_lead'] OR (w.is_demo AND m.preferred_name='omar')) AS allowed FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[member.workspace_id,member.id]);
        if(!allowed.rows[0]?.allowed) {
          await systemAudit(db,member.workspace_id,'system','replay_refused',undefined,{member_id:member.id});
          return {status:403,newActions:0,message:'You do not have permission to replay this event'};
        }
        const r=await db.query<{trigger_event_id:string}>("SELECT trigger_event_id FROM runs WHERE workspace_id=$1 AND id=$2",[member.workspace_id,runId]);
        if(!r.rows[0]?.trigger_event_id) return {status:404,newActions:0,message:'Stored event not found'};
        const eventId=r.rows[0].trigger_event_id;
        const newActions=await handle(db,member.workspace_id,eventId,'replay');
        await systemAudit(db,member.workspace_id,'system','event_replayed',runId,{received_via:'replay',member_id:member.id,newActions});
        return {status:200,newActions,message:newActions?'New actions queued':'No new actions'};
      });
    },
  };
}
export type JobStore = ReturnType<typeof jobStore>;
