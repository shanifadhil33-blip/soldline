import 'server-only';
import type { TransactionDriver } from '../db/withMember';
import type { Job } from '../jobs/store';
import { systemAudit } from '../jobs/store';
import { hash, type Approval } from '../approvals/model';
import { effectKey, type Effect, type ExactEffect } from './model';
export function executorStore(owner:TransactionDriver) {
  const audit=async(db:Parameters<Parameters<TransactionDriver['transaction']>[0]>[0],ws:string,action:string,id:string,details?:unknown)=>systemAudit(db,ws,'system',action,id,details);
  return {
    async load(job:Job) {
      return owner.transaction(async db=>{
        const lease=(await db.query("SELECT id FROM jobs WHERE workspace_id=$1 AND id=$2 AND lock_token=$3 AND status='running' AND locked_until>now()",[job.workspace_id,job.id,job.lock_token])).rows[0];
        if(!lease) throw new Error('Execution lease expired');
        const approval=(await db.query<Approval>("SELECT * FROM approvals WHERE workspace_id=$1 AND id=$2 AND status IN ('executing','executed')",[job.workspace_id,job.payload.approvalId])).rows[0];
        if(!approval || hash(approval.payload)!==approval.payload_hash) throw new Error('Approved work changed');
        const run=(await db.query<{status:string}>('SELECT status FROM runs WHERE workspace_id=$1 AND id=$2',[job.workspace_id,approval.run_id])).rows[0];
        if(!run || ['paused','cancelled'].includes(run.status)) return null;
        await db.query("UPDATE runs SET status='partly_done',ready_at=NULL WHERE workspace_id=$1 AND id=$2 AND status NOT IN ('paused','cancelled') AND EXISTS(SELECT 1 FROM external_effects WHERE workspace_id=$1 AND run_id=$2 AND state NOT IN ('succeeded','compensated'))",[job.workspace_id,approval.run_id]);
        await audit(db,job.workspace_id,'execution_started',approval.id);
        const roots=(await db.query<Effect>('SELECT * FROM external_effects WHERE workspace_id=$1 AND approval_id=$2 AND parent_effect_id IS NULL',[job.workspace_id,approval.id])).rows;
        const ordered=approval.payload.effects.map((request,index)=>{
          const root=roots.find(e=>e.effect_key===`approval:${approval.id}:${index}`);
          if(!root || hash(root.request)!==hash(request) || root.request_hash!==hash(request)) throw new Error('Approved work changed');
          return root;
        });
        // One P5 job owns the ordered approval sequence and its bounded retry budget.
        const siblings=await db.query<{id:string}>("UPDATE jobs SET status='done' WHERE workspace_id=$1 AND payload->>'approvalId'=$2 AND id<>$3 AND kind='execute_approval_effect' AND status IN ('queued','failed') RETURNING id",[job.workspace_id,approval.id,job.id]);
        for(const sibling of siblings.rows) await audit(db,job.workspace_id,'execution_job_coalesced',sibling.id);
        const inbox=(await db.query<{external_account_id:string}>("SELECT external_account_id FROM connections WHERE workspace_id=$1 AND provider='mail'",[job.workspace_id])).rows[0]?.external_account_id??'';
        return {approval,roots:ordered,inbox};
      });
    },
    async active(job:Job) {
      return owner.transaction(async db=>!!(await db.query(`SELECT j.id FROM jobs j JOIN runs r ON r.workspace_id=j.workspace_id AND r.id=j.run_id WHERE j.workspace_id=$1 AND j.id=$2 AND j.lock_token=$3 AND j.status='running' AND j.locked_until>now() AND r.status NOT IN ('paused','cancelled')`,[job.workspace_id,job.id,job.lock_token])).rows[0]);
    },
    async child(root:Effect,request:ExactEffect,itemKey:string,target:string) {
      return owner.transaction(async db=>{
        const key=effectKey(root.run_id,request.action,target,itemKey);
        const rows=await db.query<Effect>(`INSERT INTO external_effects(workspace_id,run_id,approval_id,parent_effect_id,effect_key,system,action,target_ref,request,request_hash,state,attempts,reversibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'planned',0,$11) ON CONFLICT(workspace_id,effect_key) DO NOTHING RETURNING *`,[root.workspace_id,root.run_id,root.approval_id,root.id,key,request.system,request.action,target,JSON.stringify(request),hash(request),root.reversibility]);
        const row=rows.rows[0]??(await db.query<Effect>('SELECT * FROM external_effects WHERE workspace_id=$1 AND effect_key=$2',[root.workspace_id,key])).rows[0];
        if(row.request_hash!==hash(request)) throw new Error('Effect request changed');
        if(request.action==='reverse') await db.query('UPDATE external_effects SET compensates_effect_id=$3 WHERE workspace_id=$1 AND id=$2',[root.workspace_id,row.id,request.records[0].id]);
        await audit(db,root.workspace_id,rows.rows.length?'effect_planned':'effect_reused',row.id);
        return row;
      });
    },
    async target(ws:string,run:string,ref:string) {
      if(!ref.startsWith('@')) return ref;
      return owner.transaction(async db=>{
        const action=ref==='@folder'?'create_folder':'create_list';
        const key=ref==='@folder'?'folder':ref.slice(6);
        const found=(await db.query<{external_id:string}>(`SELECT external_id FROM external_effects WHERE workspace_id=$1 AND run_id=$2 AND parent_effect_id IS NOT NULL AND action=$3 AND request->'records'->0->>'id'=$4 AND state='succeeded' ORDER BY id LIMIT 1`,[ws,run,action,key])).rows[0];
        if(!found) throw new Error('Earlier work needs to finish');
        return found.external_id;
      });
    },
    async set(effect:Effect,state:string,result?:Record<string,unknown>,externalId?:string) {
      return owner.transaction(async db=>{
        await db.query('UPDATE external_effects SET state=$3,result=coalesce($4::jsonb,result),external_id=coalesce($5,external_id),attempts=coalesce(attempts,0)+CASE WHEN $3=\'in_flight\' THEN 1 ELSE 0 END,last_error_code=CASE WHEN $3 IN (\'failed\',\'unknown\') THEN $3 ELSE NULL END WHERE workspace_id=$1 AND id=$2',[effect.workspace_id,effect.id,state,result?JSON.stringify(result):null,externalId??null]);
        await audit(db,effect.workspace_id,'effect_'+state,effect.id);
      });
    },
    async observe(effect:Effect,details:Record<string,unknown>) {
      return owner.transaction(async db=>{
        await db.query('UPDATE external_effects SET result=$3 WHERE workspace_id=$1 AND id=$2',[effect.workspace_id,effect.id,JSON.stringify(details)]);
        await audit(db,effect.workspace_id,'effect_observed',effect.id);
      });
    },
    async event(effect:Effect,action:string) {return owner.transaction(db=>audit(db,effect.workspace_id,action,effect.id));},
    async get(ws:string,id:string) {return owner.transaction(async db=>(await db.query<Effect>('SELECT * FROM external_effects WHERE workspace_id=$1 AND id=$2',[ws,id])).rows[0]);},
    async recovery(job:Job,effect:Effect,reason:string) {
      return owner.transaction(async db=>{
        await db.query(`INSERT INTO recovery_items(workspace_id,run_id,job_id,effect_id,kind,title,plain_reason,owner_member_id,status,allowed_options) SELECT $1,$2,$3,$4,'execution_failed','Delivery needs attention',$5,r.delivery_lead_id,'open',ARRAY['retry_now','resolve_with_note','cancel_remaining','reconcile'] FROM runs r WHERE r.workspace_id=$1 AND r.id=$2 ON CONFLICT(workspace_id,job_id) WHERE job_id IS NOT NULL DO UPDATE SET effect_id=$4,status='open',plain_reason=$5,allowed_options=ARRAY['retry_now','resolve_with_note','cancel_remaining','reconcile']`,[job.workspace_id,effect.run_id,job.id,effect.id,reason]);
        await db.query("UPDATE runs SET status='partly_done' WHERE workspace_id=$1 AND id=$2 AND status NOT IN ('paused','cancelled')",[job.workspace_id,effect.run_id]);
        await audit(db,job.workspace_id,'execution_recovery_created',effect.id);
      });
    },
    async lineRecovery(effect:Effect,title:string,member:string) {
      return owner.transaction(async db=>{
        const found=(await db.query<{id:string}>('SELECT id FROM recovery_items WHERE workspace_id=$1 AND effect_id=$2',[effect.workspace_id,effect.id])).rows[0];
        if(found) return found.id;
        const row=(await db.query<{id:string}>(`INSERT INTO recovery_items(workspace_id,run_id,effect_id,kind,title,plain_reason,owner_member_id,status,allowed_options) VALUES($1,$2,$3,'missing_line_items',$4,'The sold scope has missing line items in HubSpot',$5,'open',ARRAY['resolve_with_note']) RETURNING id`,[effect.workspace_id,effect.run_id,effect.id,title,member])).rows[0];
        await audit(db,effect.workspace_id,'line_item_recovery_created',row.id);
        return row.id;
      });
    },
    async complete(job:Job) {
      return owner.transaction(async db=>{
        const pending=(await db.query("SELECT id FROM external_effects WHERE workspace_id=$1 AND approval_id=$2 AND state NOT IN ('succeeded','compensated')",[job.workspace_id,job.payload.approvalId])).rows.length;
        if(!pending) {
          await db.query(`UPDATE approvals SET status='executed',executed_at=now(),execution_summary=execution_summary || jsonb_build_object('message','Delivery completed','completed',true) WHERE workspace_id=$1 AND id=$2`,[job.workspace_id,job.payload.approvalId]);
          await db.query("UPDATE recovery_items SET status='resolved',resolution_note='Delivery completed' WHERE workspace_id=$1 AND run_id=$2 AND kind IN ('execution_failed','job_failed') AND job_id IN (SELECT id FROM jobs WHERE workspace_id=$1 AND run_id=$2 AND kind='execute_approval_effect') AND status IN ('open','retrying')",[job.workspace_id,job.run_id]);
        }
        await db.query(`UPDATE runs SET status=CASE WHEN EXISTS(SELECT 1 FROM external_effects WHERE workspace_id=$1 AND run_id=$2 AND state NOT IN ('succeeded','compensated')) THEN 'partly_done' ELSE 'ready' END,ready_at=CASE WHEN NOT EXISTS(SELECT 1 FROM external_effects WHERE workspace_id=$1 AND run_id=$2 AND state NOT IN ('succeeded','compensated')) THEN coalesce(ready_at,now()) ELSE NULL END WHERE workspace_id=$1 AND id=$2 AND status NOT IN ('paused','cancelled')`,[job.workspace_id,job.run_id]);
        await audit(db,job.workspace_id,'execution_checked',job.payload.approvalId);
      });
    },
  };
}
export type ExecutorStore=ReturnType<typeof executorStore>;
