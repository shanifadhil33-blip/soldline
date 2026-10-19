import 'server-only';
import type { SqlConnection, TransactionDriver } from '../db/withMember';
import { systemAudit } from '../jobs/store';
import { WorkerConnections } from '../jobs/providers';
import { ClickUpClient } from '../integrations/clickup';
import { instructions } from '../scope/parser';
import { classifyScopeEmail } from './classifier';
import { missingInput, taskFindings, type Candidate } from './rules';
import { notifyBlock, notificationStore } from '../notifications';
import { approvalStore } from '../approvals/store';
import { hash, type InputRef } from '../approvals/model';
import type { Member } from '../permissions';
type Run={id:string;workspace_id:string;deal_id:string;scope_version_id:string|null;delivery_lead_id:string|null;owner_member_id:string|null;timezone:string;working_days:number[]};
async function record(db:SqlConnection,run:Run,c:Candidate,actor:string|null=null) {
  const role=c.clientFacing?'account_manager':'delivery_lead';
  const preferred=c.clientFacing?run.owner_member_id:run.delivery_lead_id;
  const owner=(await db.query<{id:string}>(`SELECT id FROM members WHERE workspace_id=$1 AND archived_at IS NULL AND ($2=ANY(roles) OR 'admin'=ANY(roles)) ORDER BY (id=$3::uuid) DESC NULLS LAST,($2=ANY(roles)) DESC,id LIMIT 1`,[run.workspace_id,role,preferred])).rows[0]?.id??null;
  const old=(await db.query<{id:string;severity:string;status:string;resolution:string|null}>(`SELECT id,severity,status,resolution FROM findings WHERE workspace_id=$1 AND run_id=$2 AND monitor_key=$3 FOR UPDATE`,[run.workspace_id,run.id,c.key])).rows[0];
  if(old&&old.status!=='open'&&old.resolution!=='The watched condition has cleared') return old.id;
  const evidence={observed_at:c.observedAt,quote:c.quote??null,actor_member_id:actor,memory_ids:c.memoryIds??[],memory_reason:c.memoryIds?.length?'Used confirmed company memory':null};
  let id=old?.id;
  if(!id) {
    id=(await db.query<{id:string}>(`INSERT INTO findings(workspace_id,run_id,monitor_key,kind,severity,title,evidence,status,owner_member_id) VALUES($1,$2,$3,$4,$5,$6,$7,'open',$8) RETURNING id`,[run.workspace_id,run.id,c.key,c.kind,c.severity,c.title,JSON.stringify(evidence),owner])).rows[0].id;
    await systemAudit(db,run.workspace_id,'schedule','monitor_finding_created',id);
  } else if(old.severity!==c.severity||old.status!=='open') {
    await db.query(`UPDATE findings SET severity=$3,evidence=$4,status='open',resolution=NULL,resolved_at=NULL WHERE workspace_id=$1 AND id=$2`,[run.workspace_id,id,c.severity,JSON.stringify(evidence)]);
    await systemAudit(db,run.workspace_id,'schedule','monitor_finding_updated',id);
  }
  // Use the P8 recovery table, options and unique finding identity. Never create a second recovery on escalation.
  const recovery=(await db.query<{id:string}>(`INSERT INTO recovery_items(workspace_id,run_id,finding_id,kind,title,plain_reason,owner_member_id,status,allowed_options) VALUES($1,$2,$3,'monitor',$4,$4,$5,'open',ARRAY['resolve_with_note']) ON CONFLICT DO NOTHING RETURNING id`,[run.workspace_id,run.id,id,c.title,owner])).rows[0];
  if(old?.resolution==='The watched condition has cleared') await db.query("UPDATE recovery_items SET status='open',resolution_note=NULL WHERE workspace_id=$1 AND finding_id=$2 AND kind='monitor'",[run.workspace_id,id]);
  if(recovery) await systemAudit(db,run.workspace_id,'schedule','monitor_recovery_created',recovery.id);
  if(!old||old.severity!==c.severity||old.status!=='open') await notifyBlock(db,run.workspace_id,{id,owner_member_id:owner,severity:c.severity,title:c.title},actor);
  return id;
}
export function monitorStore(owner:TransactionDriver) {
  return {
    async memberName(ws:string,external:string) {
      return owner.transaction(async db=>(await db.query<{display_name:string}>('SELECT display_name FROM members WHERE workspace_id=$1 AND clickup_user_id=$2 AND archived_at IS NULL ORDER BY id LIMIT 1',[ws,external])).rows[0]?.display_name??null);
    },
    async refreshTasks(ws:string,runId:string,now=Date.now(),deadline=Date.now()+25000) {
      const effects=await owner.transaction(async db=>(await db.query<{external_id:string;item_key:string}>(`SELECT external_id,request->'records'->0->>'id' AS item_key FROM external_effects WHERE workspace_id=$1 AND run_id=$2 AND action='create_task' AND parent_effect_id IS NOT NULL AND state='succeeded' AND external_id IS NOT NULL`,[ws,runId])).rows);
      const client=new ClickUpClient({connections:new WorkerConnections(owner,ws),deadline});
      for(const effect of effects) {
        const task=await client.getTask(effect.external_id);
        const status=task.status?.status??'Unknown';
        const assignees=Array.isArray(task.assignees)?task.assignees.map(a=>String(typeof a==='object'&&a!==null?'id' in a?a.id:'':a)).filter(Boolean):[];
        const due=task.due_date===null||task.due_date===undefined?null:new Date(Number(task.due_date)).toISOString();
        await owner.transaction(async db=>{
          await db.query(`INSERT INTO monitor_tasks(workspace_id,run_id,task_id,status,review_since,due_at,scope_item_id,assignee_ids,closed,observed_at) SELECT $1,$2,$3,$4,CASE WHEN lower($4)='client review' THEN $5::timestamptz END,$6,(SELECT s.id FROM scope_items s JOIN runs r ON r.workspace_id=s.workspace_id AND r.scope_version_id=s.scope_version_id WHERE r.workspace_id=$1 AND r.id=$2 AND s.key=$7 LIMIT 1),$8,$9,$5 ON CONFLICT(workspace_id,run_id,task_id) DO UPDATE SET status=$4,review_since=CASE WHEN lower($4)<>'client review' THEN NULL WHEN lower(monitor_tasks.status)='client review' THEN monitor_tasks.review_since ELSE $5::timestamptz END,due_at=$6,assignee_ids=$8,closed=$9,observed_at=$5`,[ws,runId,task.id,status,new Date(now).toISOString(),due,effect.item_key,assignees,status.toLowerCase()==='complete'||task.status?.type==='closed'||task.archived===true]);
          await systemAudit(db,ws,'schedule','monitor_task_observed',task.id);
        });
      }
    },
    async scan(ws:string,now=Date.now()) {
      // AI is outside the database transaction. Only P5 mail receipts already linked to a run are considered.
      const companyMemory=await owner.transaction(async db=>(await db.query<{id:string;text:string}>("SELECT id,text FROM memories WHERE workspace_id=$1 AND scope='org' AND status='active' AND confirmed_by IS NOT NULL AND deleted_at IS NULL ORDER BY id",[ws])).rows);
      const mail=await owner.transaction(async db=>(await db.query<{id:string;run_id:string;received_at:string;raw:{text?:string}}>(`SELECT e.id,e.run_id,e.received_at,e.raw FROM inbound_events e WHERE e.workspace_id=$1 AND e.source='mail' AND e.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM findings f WHERE f.workspace_id=e.workspace_id AND f.run_id=e.run_id AND f.monitor_key='mail:'||e.id)`,[ws])).rows);
      const classified:Array<(typeof mail)[number]&{quote:string;method:'rules'|'ai';memoryIds?:string[]}>=[];
      for(const message of mail) {const request=await classifyScopeEmail(message.raw.text??'',undefined,companyMemory);if(request) classified.push({...message,...request});}
      await owner.transaction(async db=>{
        await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[ws+':monitors']);
        const runs=(await db.query<Run>(`SELECT r.*,d.owner_member_id,coalesce(w.timezone,'Asia/Dubai') AS timezone,w.working_days FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id JOIN workspaces w ON w.id=r.workspace_id WHERE r.workspace_id=$1 AND r.status NOT IN ('paused','cancelled') AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[ws])).rows;
        for(const run of runs) {
          const active:string[]=[];
          const save=async(c:Candidate)=>{active.push(c.key);return record(db,run,c);};
          const inputs=(await db.query<{id:string;requested_at:string|null;blocking:boolean}>("SELECT id,requested_at,blocking FROM onboarding_inputs WHERE workspace_id=$1 AND run_id=$2 AND status='missing'",[ws,run.id])).rows;
          for(const input of inputs) {const c=missingInput(input.id,input.requested_at,input.blocking,now);if(c) await save(c);}
          const tasks=(await db.query<{task_id:string;status:string;review_since:string|null;due_at:string|null;closed:boolean}>("SELECT task_id,CASE WHEN lower(status)='client review' AND client_approved_at>=coalesce(review_since,observed_at) THEN 'approved' ELSE status END AS status,review_since,due_at,closed OR (lower(status)='client review' AND coalesce(client_approved_at>=coalesce(review_since,observed_at),false)) AS closed FROM monitor_tasks WHERE workspace_id=$1 AND run_id=$2",[ws,run.id])).rows;
          for(const task of tasks) for(const c of taskFindings({id:task.task_id,status:task.status,reviewSince:task.review_since,due:task.due_at,closed:task.closed},now,run.timezone,run.working_days)) await save(c);
          const unowned=(await db.query<{id:string}>(`SELECT s.id FROM scope_items s JOIN scope_versions v ON v.workspace_id=s.workspace_id AND v.id=s.scope_version_id WHERE v.workspace_id=$1 AND v.id=$2 AND v.status='accepted' AND NOT EXISTS(SELECT 1 FROM monitor_tasks t WHERE t.workspace_id=$1 AND t.run_id=$3 AND t.scope_item_id=s.id AND cardinality(t.assignee_ids)>0)`,[ws,run.scope_version_id,run.id])).rows;
          for(const item of unowned) await save({key:'owner:'+item.id,kind:'no_owner',severity:'warn',title:'A scope item needs an assigned task',clientFacing:false,observedAt:new Date(now).toISOString()});
          const cleared=(await db.query<{id:string}>(`UPDATE findings SET status='resolved',resolution='The watched condition has cleared',resolved_at=$4 WHERE workspace_id=$1 AND run_id=$2 AND monitor_key IS NOT NULL AND kind NOT IN ('scope_change_request','unusual_instruction') AND status='open' AND NOT (monitor_key=ANY($3::text[])) RETURNING id`,[ws,run.id,active,new Date(now).toISOString()])).rows;
          for(const finding of cleared) {
            await db.query("UPDATE recovery_items SET status='resolved',resolution_note='The watched condition has cleared' WHERE workspace_id=$1 AND finding_id=$2 AND kind='monitor' AND status='open'",[ws,finding.id]);
            await systemAudit(db,ws,'schedule','monitor_condition_cleared',finding.id);
          }
          for(const message of classified.filter(m=>m.run_id===run.id)) {
            await record(db,run,{key:'mail:'+message.id,kind:'scope_change_request',severity:'warn',title:'The client asked for a scope change',clientFacing:true,quote:message.quote,memoryIds:message.memoryIds,observedAt:message.received_at});
            const unusual=instructions([{page:1,text:message.raw.text??''}]);
            if(unusual.length) await record(db,run,{key:'instruction:'+message.id,kind:'unusual_instruction',severity:'warn',title:'Unusual instruction in client text.',clientFacing:true,quote:unusual.map(i=>i.quote).join('. '),observedAt:message.received_at});
          }
        }
      });
      await notificationStore(owner).digest(ws,now);
    },
    async draftReminder(member:Member,findingId:string,to:string[],body:string) {
      const data=await owner.transaction(async db=>{
        const row=(await db.query<{run_id:string;deal_id:string}>(`SELECT f.run_id,r.deal_id FROM findings f JOIN runs r ON r.workspace_id=f.workspace_id AND r.id=f.run_id WHERE f.workspace_id=$1 AND f.id=$2 AND f.kind IN ('missing_input','overdue_client_approval') AND f.status='open'`,[member.workspace_id,findingId])).rows[0];
        if(!row) throw new Error('Reminder finding not found');
        const versions=(await db.query<{id:string;version:number;items_hash:string|null;status:string}>('SELECT id,version,items_hash,status FROM scope_versions WHERE workspace_id=$1 AND deal_id=$2 ORDER BY version DESC LIMIT 1',[member.workspace_id,row.deal_id])).rows;
        if(!versions.length) throw new Error('Scope needs a review first');
        const ref:InputRef={system:'scope',record_id:row.deal_id,version_marker:String(versions[0].version),hash:hash(versions[0])};
        return {...row,ref};
      });
      return approvalStore(owner).createApproval({runId:data.run_id,kind:'client_email',reversibility:'irreversible',requestedByType:'agent',requestedByMemberId:member.id,inputRefs:[data.ref],payload:{effects:[{system:'mail',location:'team inbox',action:'send_message',records:[],amounts:{},message:{to,subject:'Client input reminder',body}}]}},member);
    },
  };
}
