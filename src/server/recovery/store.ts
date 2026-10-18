import 'server-only';
import { z } from 'zod';
import type { TransactionDriver, SqlConnection } from '../db/withMember';
import { append } from '../audit';
import { assertCan, ForbiddenError, type Member, type Action } from '../permissions';
import { approvalStore } from '../approvals/store';
import { liveRead } from '../approvals/live';
import type { Approval, Payload } from '../approvals/model';
import type { Effect } from '../executor/model';
export const options=['retry_now','resolve_with_note','cancel_remaining','reconcile'] as const;
export type Option=typeof options[number];
type Recovery=Record<string,unknown>&{id:string;workspace_id:string;run_id:string;job_id:string|null;owner_member_id:string|null;status:string;allowed_options:string[]};
export function recoveryStore(owner:TransactionDriver) {
  async function identity(db:SqlConnection,member:Member) {
    const actor=(await db.query<Member & Record<string,unknown>>(`SELECT m.*,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=$1 AND m.workspace_id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[member.id,member.workspace_id])).rows[0];
    if(actor) await db.query("SELECT set_config('app.member_id',$1,true)",[actor.id]);
    return actor;
  }
  async function guard(db:SqlConnection,member:Member,action:Action,resource:{workspace_id:string;id:string;owner_member_id?:string|null}) {
    try {assertCan(member,action,resource);return true;} catch(error) {
      if(!(error instanceof ForbiddenError)) throw error;
      await append(db,member.workspace_id,{action,outcome:'denied',target_id:resource.id});return false;
    }
  }
  async function cancel(db:SqlConnection,ws:string,runId:string,status:'paused'|'cancelled') {
    await db.query("UPDATE runs SET status=$3 WHERE workspace_id=$1 AND id=$2",[ws,runId,status]);
    const jobs=await db.query<{id:string}>("UPDATE jobs SET status='cancelled',lock_token=NULL,locked_until=NULL WHERE workspace_id=$1 AND run_id=$2 AND status IN ('queued','failed') RETURNING id",[ws,runId]);
    const effects=await db.query<{id:string}>("UPDATE external_effects SET state='cancelled' WHERE workspace_id=$1 AND run_id=$2 AND state IN ('planned','failed') RETURNING id",[ws,runId]);
    for(const row of jobs.rows) await append(db,ws,{action:'job_cancelled',outcome:'succeeded',target_id:row.id});
    for(const row of effects.rows) await append(db,ws,{action:'effect_cancelled',outcome:'succeeded',target_id:row.id,effect_id:row.id});
    await append(db,ws,{action:'run_'+status,outcome:'succeeded',target_id:runId});
  }
  return {
    async act(member:Member,id:string,option:Option,note='') {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor) return {status:403,message:'Workspace access refused'};
        const item=(await db.query<Recovery>('SELECT * FROM recovery_items WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[actor.workspace_id,id])).rows[0];
        if(!item) return {status:404,message:'Recovery item not found'};
        if(!await guard(db,actor,'resolve_recovery',item)) return {status:403,message:'You do not have permission to resolve this item'};
        const refuse=async(message:string)=>{await append(db,actor.workspace_id,{action:'recovery_refused',outcome:'failed',target_id:id,after:{option,message}});return {status:409,message};};
        if(!options.includes(option) || !item.allowed_options?.includes(option)) return refuse('This option is not available');
        if(!['open','retrying'].includes(item.status)) return refuse('This item is already closed');
        if(option==='resolve_with_note' && !note.trim()) return refuse('Write a note before resolving this item');
        if(option==='retry_now'||option==='reconcile') {
          if(!item.job_id) return refuse('There is no queued job for this item');
          const run=(await db.query<{status:string}>('SELECT status FROM runs WHERE workspace_id=$1 AND id=$2',[actor.workspace_id,item.run_id])).rows[0];
          if(!run || ['paused','cancelled'].includes(run.status)) return refuse('This run is paused or cancelled');
          const changed=await db.query(`UPDATE jobs SET status='queued',attempts=0,next_attempt_at=now(),locked_until=NULL,lock_token=NULL,payload=jsonb_set(payload,'{reconcileOnly}',to_jsonb($3::text)) WHERE workspace_id=$1 AND id=$2 AND status IN ('dead','failed') RETURNING id`,[actor.workspace_id,item.job_id,option==='reconcile'?'true':'false']);
          if(!changed.rows.length) return refuse('This job is already queued or running');
          await db.query("UPDATE recovery_items SET status='retrying',resolution_note=$3 WHERE workspace_id=$1 AND id=$2",[actor.workspace_id,id,note]);
        } else {
          if(option==='resolve_with_note' && item.job_id) {
            const active=(await db.query("SELECT id FROM jobs WHERE workspace_id=$1 AND id=$2 AND status='running'",[actor.workspace_id,item.job_id])).rows[0];
            if(active) return refuse('Wait for the current attempt before resolving this item');
            await db.query("UPDATE jobs SET status='cancelled' WHERE workspace_id=$1 AND id=$2 AND status IN ('queued','failed','dead')",[actor.workspace_id,item.job_id]);
            await append(db,actor.workspace_id,{action:'job_cancelled',outcome:'succeeded',target_id:item.job_id});
          }
          if(option==='cancel_remaining') await cancel(db,actor.workspace_id,item.run_id,'cancelled');
          await db.query('UPDATE recovery_items SET status=$3,resolved_by=$4,resolution_note=$5 WHERE workspace_id=$1 AND id=$2',[actor.workspace_id,id,option==='cancel_remaining'?'cancelled':'resolved',actor.id,note]);
        }
        await append(db,actor.workspace_id,{action:'recovery_'+option,outcome:'succeeded',target_id:id,after:{note}});
        return {status:200,message:option==='retry_now'?'Retry queued':option==='reconcile'?'Sent mail check queued':'Decision recorded'};
      });
    },
    async pause(member:Member,runId:string,status:'paused'|'cancelled'='paused') {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor) return {status:403,message:'Workspace access refused'};
        const run=(await db.query<{id:string;workspace_id:string}>('SELECT id,workspace_id FROM runs WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[actor.workspace_id,runId])).rows[0];
        if(!run) return {status:404,message:'Run not found'};
        if(!await guard(db,actor,'approve_plan',run)) return {status:403,message:'You do not have permission to pause this run'};
        await cancel(db,actor.workspace_id,runId,status);return {status:200,message:status==='paused'?'Run paused':'Run cancelled'};
      });
    },
    async undo(member:Member,runId:string) {
      const prepared=await owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor) return {status:403,message:'Workspace access refused'};
        const run=(await db.query<{id:string;workspace_id:string}>('SELECT id,workspace_id FROM runs WHERE workspace_id=$1 AND id=$2',[actor.workspace_id,runId])).rows[0];
        if(!run) return {status:404,message:'Run not found'};
        if(!await guard(db,actor,'reverse_effect',run)) return {status:403,message:'You do not have permission to undo this run'};
        const effects=(await db.query<Effect>(`SELECT * FROM external_effects WHERE workspace_id=$1 AND run_id=$2 AND parent_effect_id IS NOT NULL AND state='succeeded' AND reversibility='reversible' AND action IN ('create_task','patch_deal_properties','create_list','create_folder') ORDER BY CASE action WHEN 'create_task' THEN 0 WHEN 'patch_deal_properties' THEN 1 WHEN 'create_list' THEN 2 ELSE 3 END,id`,[actor.workspace_id,runId])).rows;
        if(!effects.length) {await append(db,actor.workspace_id,{action:'reversal_refused',outcome:'failed',target_id:runId});return {status:409,message:'There is no reversible work to undo'};}
        const approval=(await db.query<Approval>('SELECT * FROM approvals WHERE workspace_id=$1 AND id=$2',[actor.workspace_id,effects[0].approval_id])).rows[0];
        const refs=[];
        for(const ref of approval.input_refs) refs.push(await liveRead(db,actor.workspace_id,actor.id,ref));
        const payload:Payload={effects:effects.map(e=>({system:e.system as 'clickup'|'hubspot',location:e.target_ref,action:'reverse',records:[{id:e.id,fields:{}}],amounts:{}}))};
        await append(db,actor.workspace_id,{action:'reversal_requested',outcome:'succeeded',target_id:runId});
        return {status:200,message:'Reversal prepared',actor,refs,payload};
      });
      if(!prepared.actor || !prepared.payload || !prepared.refs) return {status:prepared.status,message:prepared.message};
      return approvalStore(owner).createApproval({runId,kind:'reversal',payload:prepared.payload,inputRefs:prepared.refs,reversibility:'reversible',requestedByType:'user'},prepared.actor);
    },
  };
}
export const actionSchema=z.object({option:z.enum(options),note:z.string().max(10000).default('')}).strict();
