import 'server-only';
import type { SqlConnection, TransactionDriver } from '../db/withMember';
import { append } from '../audit';
import { assertCan, ForbiddenError, scopeAcceptanceMet, type Member, type Role } from '../permissions';
import { actions, createSchema, hash, payloadSchema, refSchema, requiredRoles, sortedRefs, type Approval, type CreateApproval, type InputRef, type Result } from './model';
import { liveRead, type LiveRead } from './live';
export function approvalStore(owner:TransactionDriver,read:LiveRead=liveRead,now:()=>number=Date.now) {
  async function identity(db:SqlConnection,member:Member) {
    const stored=(await db.query<Member & Record<string,unknown>>(`SELECT m.id,m.workspace_id,m.display_name,m.roles,m.client_company_id,coalesce(w.is_demo,false) AS is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[member.workspace_id,member.id])).rows[0];
    if(!stored) return null;
    await db.query("SELECT set_config('app.member_id',$1,true)",[stored.id]);
    return stored;
  }
  async function audit(db:SqlConnection,a:Approval,action:string,outcome:'succeeded'|'failed'|'denied',after?:unknown) {
    await append(db,a.workspace_id,{action,outcome,target_type:'approval',target_id:a.id,approval_id:a.id,after});
  }
  async function operate(id:string,member:Member,operation:'decide'|'confirm'|'execute',decision='approve',note=''):Promise<Result> {
    return owner.transaction(async db=>{
      const actor=await identity(db,member);
      if(!actor) return {status:403,message:'Workspace access refused'};
      const a=(await db.query<Approval>('SELECT * FROM approvals WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[actor.workspace_id,id])).rows[0];
      if(!a) return {status:404,message:'Approval not found'};
      const refuse=async (message:string,status=409)=>{await audit(db,a,'approval_'+operation,'failed',{message});return {status,message};};
      try {assertCan(actor,actions[a.kind],a);} catch(error) {
        if(!(error instanceof ForbiddenError)) throw error;
        await audit(db,a,actions[a.kind],'denied');
        return {status:403,message:error.message};
      }
      if(operation==='execute' && ['executing','executed'].includes(a.status)) {
        await audit(db,a,'approval_execution_reused','succeeded');
        return {status:200,message:'Execution already recorded',summary:a.execution_summary};
      }
      if(['pending','approved'].includes(a.status) && new Date(a.expires_at).getTime()<=now()) {
        await db.query("UPDATE approvals SET status='expired' WHERE workspace_id=$1 AND id=$2",[a.workspace_id,id]);
        return refuse('Approval has expired');
      }
      if(operation==='decide') {
        if(a.status!=='pending') return refuse('Approval is no longer pending');
        if(!['approve','reject'].includes(decision)) return refuse('Choose approve or reject',400);
        if(a.decisions.some(d=>d.member_id===actor.id)) return refuse('Your decision is already recorded');
        a.decisions.push({member_id:actor.id,decision,note});
        let status=decision==='reject'?'rejected':'approved';
        if(a.kind==='scope_change' && decision==='approve') {
          const sets=await roleSets(db,a);
          if(!scopeAcceptanceMet(sets)) status='pending';
        }
        await db.query('UPDATE approvals SET decisions=$3,status=$4,decided_by=$5,decided_at=$6,decision_note=$7 WHERE workspace_id=$1 AND id=$2',[a.workspace_id,id,JSON.stringify(a.decisions),status,actor.id,new Date(now()).toISOString(),note]);
        await audit(db,a,'approval_decided','succeeded',{decision,status,note});
        return {status:200,message:status==='pending'?'Another approval is needed':'Decision recorded',...(a.reversibility==='irreversible'?{summary:{payload:a.payload,payloadHash:a.payload_hash,reversibility:a.reversibility}}:{})};
      }
      if(a.status!=='approved') return refuse('Approval is not approved');
      if(operation==='confirm') {
        if(a.reversibility!=='irreversible') return refuse('This approval does not need confirmation');
        if(a.decided_by!==actor.id) return refuse('The approver must confirm this approval',403);
        if(!a.decided_at || now()-new Date(a.decided_at).getTime()>=120000) return refuse('The confirmation window has expired');
        await db.query('UPDATE approvals SET confirmed_by=$3,confirmed_at=$4 WHERE workspace_id=$1 AND id=$2',[a.workspace_id,id,actor.id,new Date(now()).toISOString()]);
        await audit(db,a,'approval_confirmed','succeeded');
        return {status:200,message:'Confirmation recorded'};
      }
      if(a.reversibility==='irreversible' && (!a.confirmed_at || a.confirmed_by!==a.decided_by || !a.decided_at || (new Date(a.confirmed_at).getTime()-new Date(a.decided_at).getTime()<0 || new Date(a.confirmed_at).getTime()-new Date(a.decided_at).getTime()>=120000))) return refuse('Confirm the exact message before execution');
      const approvers=await roleSets(db,a);
      if(a.kind==='scope_change' ? !scopeAcceptanceMet(approvers) : !approvers.some(roles=>roles.some(role=>requiredRoles[a.kind].includes(role)))) return refuse('The approver roles have changed');
      if(hash(a.payload)!==a.payload_hash) return refuse('The approved payload has changed');
      const parsed=payloadSchema.safeParse(a.payload);
      const refs=refSchema.array().min(1).safeParse(a.input_refs);
      if(!parsed.success || !refs.success || hash(sortedRefs(refs.data))!==a.input_hash) return refuse('The approved inputs have changed');
      // Live reads happen under the approval lock before any effect or job insert.
      const current:InputRef[]=[];
      for(const ref of refs.data) {
        try {current.push(await read(db,a.workspace_id,actor.id,ref));}
        catch {return refuse('A live input could not be checked');}
      }
      if(hash(sortedRefs(current))!==a.input_hash) {
        const changed=refs.data.filter((ref,i)=>hash(ref)!==hash(current[i])).map(ref=>({hubspot:'HubSpot deal',hubspot_line_item:'HubSpot line item',scope:'Scope version',clickup:'ClickUp target list'}[ref.system]));
        const reason=changed.join(' and ')+' changed when checked at '+new Date(now()).toUTCString();
        await db.query("UPDATE approvals SET status='stale',stale_reason=$3 WHERE workspace_id=$1 AND id=$2",[a.workspace_id,id,reason]);
        return refuse(reason);
      }
      // A slow provider read must not extend the approval lifetime.
      if(new Date(a.expires_at).getTime()<=now()) {
        await db.query("UPDATE approvals SET status='expired' WHERE workspace_id=$1 AND id=$2",[a.workspace_id,id]);
        return refuse('Approval has expired');
      }
      // No effect row may be created above the completed live hash comparison.
      const effectIds:string[]=[];
      for(const [index,effect] of parsed.data.effects.entries()) {
        const result=await db.query<{id:string}>(`INSERT INTO external_effects(workspace_id,run_id,approval_id,effect_key,system,action,target_ref,request,request_hash,state,attempts,reversibility) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'planned',0,$10) RETURNING id`,[a.workspace_id,a.run_id,id,`approval:${id}:${index}`,effect.system,effect.action,effect.location,JSON.stringify(effect),hash(effect),a.reversibility]);
        const effectId=result.rows[0].id; effectIds.push(effectId);
        await audit(db,a,'approval_effect_planned','succeeded',{effect_id:effectId});
        const job=await db.query<{id:string}>(`INSERT INTO jobs(workspace_id,run_id,kind,dedupe_key,payload,status,attempts,max_attempts,next_attempt_at) VALUES($1,$2,'execute_approval_effect',$3,$4,'queued',0,5,now()) RETURNING id`,[a.workspace_id,a.run_id,`approval:${id}:${index}`,JSON.stringify({approvalId:id,effectId})]);
        await audit(db,a,'approval_job_queued','succeeded',{job_id:job.rows[0].id});
      }
      const summary={approvalId:id,effectIds,message:'Approved work queued'};
      await db.query("UPDATE approvals SET status='executing',execution_summary=$3 WHERE workspace_id=$1 AND id=$2",[a.workspace_id,id,JSON.stringify(summary)]);
      await audit(db,a,'approval_executing','succeeded',summary);
      return {status:200,message:'Approved work queued',summary};
    }).catch(async()=>owner.transaction(async db=>{
      // Unexpected queue failures roll back all planned work. Record the refusal separately.
      const actor=await identity(db,member);
      if(!actor) return {status:403,message:'Workspace access refused'};
      const a=(await db.query<Approval>('SELECT * FROM approvals WHERE workspace_id=$1 AND id=$2',[actor.workspace_id,id])).rows[0];
      if(a) await audit(db,a,'approval_'+operation,'failed',{message:'Approval could not be updated'});
      return {status:409,message:'Approval could not be updated'};
    }));
  }
  async function roleSets(db:SqlConnection,a:Approval):Promise<Role[][]> {
    const ids=a.decisions.filter(d=>d.decision==='approve').map(d=>d.member_id);
    const rows=await db.query<{roles:Role[]}>(`SELECT roles FROM members WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND archived_at IS NULL AND NOT ($3='user' AND id=$4::uuid)`,[a.workspace_id,ids,a.requested_by_type,a.requested_by_member_id]);
    return rows.rows.map(m=>m.roles);
  }
  return {
    async createApproval(input:CreateApproval,member:Member):Promise<Result> {
      const data=createSchema.parse(input);
      if(data.kind==='client_email' && (data.reversibility!=='irreversible' || data.payload.effects.some(e=>e.system!=='mail'||!e.message))) throw new Error('Email approvals need the full message and irreversible confirmation');
      if(data.payload.effects.some(e=>e.system==='mail') && data.kind!=='client_email') throw new Error('Messages need an email approval');
      return owner.transaction(async db=>{
        const actor=await identity(db,member);
        if(!actor) return {status:403,message:'Workspace access refused'};
        const run=(await db.query('SELECT id FROM runs WHERE workspace_id=$1 AND id=$2',[actor.workspace_id,data.runId])).rows[0];
        if(!run) return {status:404,message:'Run not found'};
        // Creation is restricted to staff. Decision eligibility still comes from the unchanged matrix.
        if(!actor.roles.some(r=>['admin','account_manager','delivery_lead'].includes(r))) {
          await append(db,actor.workspace_id,{action:'approval_create',outcome:'denied',target_type:'run',target_id:data.runId});
          return {status:403,message:'You do not have permission to request this approval'};
        }
        const requester=data.requestedByMemberId===undefined?actor.id:data.requestedByMemberId;
        if(data.requestedByType==='user' && requester!==actor.id) throw new Error('The requester must be the asking member');
        const refs=sortedRefs(data.inputRefs);
        if(refs.some(ref=>ref.system==='clickup' && ref.version_marker!=='exists')) throw new Error('The target list must exist');
        if(new Set(refs.map(r=>r.system+':'+r.record_id)).size!==refs.length) throw new Error('Each input must be listed once');
        const a=(await db.query<Approval>(`INSERT INTO approvals(workspace_id,run_id,kind,requested_by_type,requested_by_member_id,required_roles,status,payload,payload_hash,input_refs,input_hash,reversibility,expires_at) VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12) RETURNING *`,[actor.workspace_id,data.runId,data.kind,data.requestedByType,requester,requiredRoles[data.kind],JSON.stringify(data.payload),hash(data.payload),JSON.stringify(refs),hash(refs),data.reversibility,new Date(now()+(data.reversibility==='irreversible'?1800000:86400000)).toISOString()])).rows[0];
        await audit(db,a,'approval_created','succeeded');
        return {status:201,message:'Approval requested',approval:a};
      });
    },
    decide:(id:string,member:Member,decision:'approve'|'reject',note='')=>operate(id,member,'decide',decision,note),
    confirm:(id:string,member:Member)=>operate(id,member,'confirm'),
    execute:(id:string,member:Member)=>operate(id,member,'execute'),
  };
}
