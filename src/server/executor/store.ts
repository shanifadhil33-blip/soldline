import 'server-only';
import { loadMessages } from '../../lib/i18n';
import { recoveryStore } from '../recovery/store';
import type { Member } from '../permissions';
import type { TransactionDriver } from '../db/withMember';
import type { Job } from '../jobs/store';
import { systemAudit } from '../jobs/store';
import { z } from 'zod';
import { after } from './model';
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
        const key=effectKey(root.run_id,request.action,target,request.action==='retry_recovery'?root.approval_id+':'+itemKey:itemKey);
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
        if(state==='succeeded'&&effect.action==='create_folder'&&effect.parent_effect_id&&externalId&&Array.isArray(result?.before_ids)&&!result.before_ids.includes(externalId)) {
          await db.query(`INSERT INTO demo_resources(workspace_id,provider,external_id,origin_effect_id) SELECT id,'clickup',$2,$3 FROM workspaces WHERE id=$1 AND is_demo ON CONFLICT DO NOTHING`,[effect.workspace_id,externalId,effect.id]);
        }
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
        const reconnect=(await db.query("SELECT id FROM connections WHERE workspace_id=$1 AND provider=$2 AND status='needs_reconnect'",[job.workspace_id,effect.system])).rows.length>0;
        if(reconnect) {
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[job.workspace_id+':reconnect:'+effect.system]);
          const existing=(await db.query("SELECT id FROM recovery_items WHERE workspace_id=$1 AND kind='connection' AND plain_reason=$2 AND status IN ('open','retrying')",[job.workspace_id,'Reconnect '+effect.system])).rows[0];
          if(!existing) {
            await db.query(`INSERT INTO recovery_items(workspace_id,run_id,job_id,effect_id,kind,title,plain_reason,owner_member_id,status,allowed_options) SELECT $1,$2,$3,$4,'connection','A connection needs attention',$5,m.id,'open',ARRAY['retry_now','resolve_with_note'] FROM members m WHERE m.workspace_id=$1 AND 'admin'=ANY(m.roles) AND m.archived_at IS NULL ORDER BY m.id LIMIT 1 ON CONFLICT(workspace_id,job_id) WHERE job_id IS NOT NULL DO UPDATE SET kind='connection',owner_member_id=excluded.owner_member_id,plain_reason=excluded.plain_reason,status='open'`,[job.workspace_id,effect.run_id,job.id,effect.id,'Reconnect '+effect.system]);
            await audit(db,job.workspace_id,'connection_recovery_created',effect.id);
          }
          await db.query("UPDATE runs SET status='partly_done' WHERE workspace_id=$1 AND id=$2 AND status NOT IN ('paused','cancelled')",[job.workspace_id,effect.run_id]);
          return;
        }
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
    async scopeChange(effect:Effect) {
      const data=z.object({reason:z.string().min(1),items:z.array(z.object({key:z.string().min(1),title:z.string().min(1),quantity:z.number().positive(),cadence:z.enum(['once','monthly','weekly']),source_page:z.number().int().positive(),source_quote:z.string().min(1)}).strict()).min(1)}).strict().parse(after(effect.request.records[0]));
      if(new Set(data.items.map(i=>i.key)).size!==data.items.length) throw new Error('Scope item keys must be distinct');
      return owner.transaction(async db=>{
        const approval=(await db.query<Approval>("SELECT * FROM approvals WHERE workspace_id=$1 AND id=$2 FOR UPDATE",[effect.workspace_id,effect.approval_id])).rows[0];
        if(!approval||approval.kind!=='scope_change'||!['executing','executed'].includes(approval.status)||approval.payload_hash!==hash(approval.payload)||approval.payload.effects.length!==1||approval.payload.effects[0].action!=='accept_scope_change') throw new Error('Scope change needs its exact approval');
        const run=(await db.query<{deal_id:string}>('SELECT deal_id FROM runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[effect.workspace_id,effect.run_id])).rows[0];
        if(!run||run.deal_id!==effect.target_ref) throw new Error('Scope deal does not match the approval');
        const previous=(await db.query<{id:string;version:number;status:string;items_hash:string|null}>('SELECT id,version,status,items_hash FROM scope_versions WHERE workspace_id=$1 AND deal_id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE',[effect.workspace_id,run.deal_id])).rows[0];
        const saved=(await db.query<{state:string;external_id:string}>('SELECT state,external_id FROM external_effects WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[effect.workspace_id,effect.id])).rows[0];
        if(saved.state==='succeeded') return saved.external_id;
        if(!previous||previous.status!=='accepted') throw new Error('Accept the signed scope before changing it');
        const approvedScope=approval.input_refs.find(ref=>ref.system==='scope'&&ref.record_id===run.deal_id);
        if(!approvedScope||approvedScope.hash!==hash(previous)) throw new Error('The approved scope changed before execution');
        // Approval and all scope writes commit together. Retries reuse the succeeded child effect.
        await db.query("UPDATE approvals SET status='executed',executed_at=now() WHERE workspace_id=$1 AND id=$2",[effect.workspace_id,approval.id]);
        await db.query("UPDATE scope_versions SET status='superseded' WHERE workspace_id=$1 AND id=$2",[effect.workspace_id,previous.id]);
        await audit(db,effect.workspace_id,'scope_version_superseded',previous.id,{approval_id:approval.id});
        const version=(await db.query<{id:string}>("INSERT INTO scope_versions(workspace_id,deal_id,version,status,items_hash,reason,accepted_by,accepted_at) VALUES($1,$2,$3,'accepted',$4,$5,$6,now()) RETURNING id",[effect.workspace_id,run.deal_id,previous.version+1,hash(data.items),data.reason,approval.decided_by])).rows[0].id;
        await audit(db,effect.workspace_id,'scope_change_executed',version,{approval_id:approval.id});
        for(const item of data.items) {
          await db.query("INSERT INTO scope_items(workspace_id,scope_version_id,key,title,quantity,cadence,source_page,source_quote) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[effect.workspace_id,version,item.key,item.title,item.quantity,item.cadence,item.source_page,item.source_quote]);
          await audit(db,effect.workspace_id,'scope_item_created',version,{key:item.key,approval_id:approval.id});
        }
        await db.query('UPDATE runs SET scope_version_id=$3 WHERE workspace_id=$1 AND id=$2',[effect.workspace_id,effect.run_id,version]);
        await db.query("UPDATE external_effects SET state='succeeded',external_id=$3 WHERE workspace_id=$1 AND id=$2",[effect.workspace_id,effect.id,version]);
        await audit(db,effect.workspace_id,'effect_succeeded',effect.id);
        return version;
      });
    },
    async retryRecovery(effect:Effect) {
      return owner.transaction(async db=>{
        const current=(await db.query<{state:string}>('SELECT state FROM external_effects WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[effect.workspace_id,effect.id])).rows[0];
        if(current?.state==='succeeded')return {status:200};
        const approval=(await db.query<Approval>("SELECT * FROM approvals WHERE workspace_id=$1 AND id=$2 AND kind='plan_correction' AND status IN ('executing','executed')",[effect.workspace_id,effect.approval_id])).rows[0];
        if(!approval?.requested_by_member_id)return {status:403};
        const actor=(await db.query<Member & Record<string,unknown>>('SELECT m.*,false AS is_demo FROM members m WHERE workspace_id=$1 AND id=$2',[effect.workspace_id,approval.requested_by_member_id])).rows[0];
        const id=z.uuid().parse(effect.request.records[0]?.id);
        const item=(await db.query('SELECT id FROM recovery_items WHERE workspace_id=$1 AND id=$2 AND run_id=$3',[effect.workspace_id,id,effect.run_id])).rows[0];
        if(!actor||!item)return {status:404};
        // The existing recovery store rechecks current identity, roles, ownership, options and job state.
        // Requeue and effect success are one transaction, so a retry cannot queue the job twice.
        const result=await recoveryStore({transaction:work=>work(db)}).act(actor,id,'retry_now',approval.payload.reviewNote??'');
        if(result.status>=400)return result;
        await db.query("UPDATE external_effects SET state='succeeded',result=$3 WHERE workspace_id=$1 AND id=$2",[effect.workspace_id,effect.id,JSON.stringify({recoveryId:id})]);
        await audit(db,effect.workspace_id,'effect_succeeded',effect.id);
        return result;
      });
    },
    async complete(job:Job) {
      return owner.transaction(async db=>{
        const pending=(await db.query("SELECT id FROM external_effects WHERE workspace_id=$1 AND approval_id=$2 AND state NOT IN ('succeeded','compensated')",[job.workspace_id,job.payload.approvalId])).rows.length;
        if(!pending) {
          const approval=(await db.query<Approval>('SELECT * FROM approvals WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[job.workspace_id,job.payload.approvalId])).rows[0];
          if(approval?.payload.effects.some(e=>e.action==='retry_recovery')) {
            await db.query("UPDATE approvals SET status='executed',executed_at=now(),execution_summary=execution_summary || jsonb_build_object('message',$3::text,'completed',true) WHERE workspace_id=$1 AND id=$2",[job.workspace_id,approval.id,loadMessages('en').backendA5.retryQueued]);
            await audit(db,job.workspace_id,'execution_checked',approval.id);
            return;
          }
          if(approval && ['provision','plan_correction'].includes(approval.kind)) {
            const accepted=await db.query<{id:string}>(`UPDATE scope_versions v SET status='accepted',accepted_by=$3,accepted_at=now() FROM runs r WHERE r.workspace_id=$1 AND r.id=$2 AND v.workspace_id=r.workspace_id AND v.id=r.scope_version_id AND v.version=1 AND v.status='draft' RETURNING v.id`,[job.workspace_id,job.run_id,approval.decided_by]);
            for(const v of accepted.rows) await audit(db,job.workspace_id,'scope_version_accepted',v.id,{approval_id:approval.id});
          }
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
