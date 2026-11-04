import 'server-only';
import { deliveryStatuses } from './integrations/clickup';
import { append, verifyChain } from './audit';
import { assertCan, ForbiddenError, type Member } from './permissions';
import { Connections, type Provider } from './integrations/connections';
import type { SqlConnection, TransactionDriver } from './db/withMember';
import { agencyPeopleFor, clientPeopleFor, sentence, tellMembers } from './client-flow';

export async function clientRecords(db:SqlConnection,member:Member) {
  // RLS and an explicit company predicate both protect every client collection.
  const company=member.roles.includes('client_reviewer')?member.client_company_id:null;
  if(member.roles.includes('client_reviewer')&&!company)return {runs:[],inputs:[],deliverables:[]};
  const runs=(await db.query<{id:string;name:string;client:string}>(`SELECT r.id,d.name,c.name AS client FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id JOIN client_companies c ON c.workspace_id=d.workspace_id AND c.id=d.client_company_id WHERE r.workspace_id=$1 AND ($2::uuid IS NULL OR d.client_company_id=$2) ORDER BY d.name`,[member.workspace_id,company])).rows;
  const ids=runs.map(r=>r.id);
  const inputs=(await db.query<{id:string;run_id:string;label:string;status:string;sent:boolean}>("SELECT id,run_id,label,status,(evidence->>'sent_at') IS NOT NULL AS sent FROM onboarding_inputs WHERE run_id=ANY($1::uuid[]) ORDER BY (status='missing') DESC,id",[ids])).rows;
  const deliverables=(await db.query<{id:string;run_id:string;title:string;status:string;due:string|null;again:boolean}>(`SELECT t.task_id AS id,t.run_id,s.title,CASE WHEN lower(t.status)='client review' AND t.client_approved_at>=coalesce(t.review_since,t.observed_at) THEN 'approved' ELSE t.status END AS status,t.due_at AS due,EXISTS(SELECT 1 FROM recovery_items x WHERE x.workspace_id=t.workspace_id AND x.run_id=t.run_id AND x.kind='client_changes:'||t.task_id AND x.status='resolved') AS again FROM monitor_tasks t LEFT JOIN scope_items s ON s.workspace_id=t.workspace_id AND s.id=t.scope_item_id WHERE t.run_id=ANY($1::uuid[]) ORDER BY (lower(t.status)='client review') DESC,t.task_id`,[ids])).rows;
  return {runs,inputs,deliverables};
}
export function trustStore(owner:TransactionDriver) {
  async function identity(db:SqlConnection,member:Member) {
    const actor=(await db.query<Member & Record<string,unknown>>(`SELECT m.*,w.is_demo FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.id=$1 AND m.workspace_id=$2 AND m.archived_at IS NULL AND (NOT coalesce(w.is_demo,false) OR w.demo_expires_at>now())`,[member.id,member.workspace_id])).rows[0];
    if(actor)await db.query("SELECT set_config('app.member_id',$1,true)",[actor.id]);
    return actor;
  }
  return {
    async connections(member:Member) {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor)return null;
        const rows=(await db.query('SELECT provider,status,scopes,allowed_actions FROM connections WHERE workspace_id=$1 ORDER BY provider',[actor.workspace_id])).rows;
        return {rows,editable:actor.roles.includes('admin')};
      });
    },
    async audit(member:Member) {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);
        if(!actor)return {status:403};
        if(!actor.roles.some(r=>['admin','account_manager','delivery_lead'].includes(r))) {
          await append(db,actor.workspace_id,{action:'read_audit',outcome:'denied'});
          return {status:403};
        }
        // Always verify the complete workspace chain before returning any success.
        const chain=await verifyChain(db,actor.workspace_id);
        const rows=(await db.query(`WITH permitted AS (
          SELECT r.id,r.deal_id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND ($5 OR ($3 AND r.delivery_lead_id=$2) OR ($4 AND d.owner_member_id=$2))
        ), targets AS (
          SELECT id::text AS id,id AS run_id FROM permitted UNION ALL
          SELECT a.id::text,a.run_id FROM approvals a JOIN permitted p ON p.id=a.run_id UNION ALL
          SELECT j.id::text,j.run_id FROM jobs j JOIN permitted p ON p.id=j.run_id UNION ALL
          SELECT e.id::text,e.run_id FROM external_effects e JOIN permitted p ON p.id=e.run_id UNION ALL
          SELECT f.id::text,f.run_id FROM findings f JOIN permitted p ON p.id=f.run_id UNION ALL
          SELECT i.id::text,i.run_id FROM recovery_items i JOIN permitted p ON p.id=i.run_id UNION ALL
          SELECT i.id::text,i.run_id FROM onboarding_inputs i JOIN permitted p ON p.id=i.run_id UNION ALL
          SELECT e.id::text,e.run_id FROM inbound_events e JOIN permitted p ON p.id=e.run_id UNION ALL
          SELECT t.task_id,t.run_id FROM monitor_tasks t JOIN permitted p ON p.id=t.run_id UNION ALL
          SELECT v.id::text,p.id FROM scope_versions v JOIN permitted p ON p.deal_id=v.deal_id
        ) SELECT z.*,(SELECT d.name FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND r.id::text=z.run_id) AS project FROM (SELECT a.*,coalesce((SELECT t.run_id::text FROM targets t WHERE t.id=a.target_id LIMIT 1),(SELECT x.run_id::text FROM approvals x WHERE x.workspace_id=$1 AND x.id=a.approval_id)) AS run_id FROM audit_log a WHERE a.workspace_id=$1 AND ($5 OR a.target_id IN (SELECT id FROM targets) OR a.approval_id::text IN (SELECT id FROM targets))) z ORDER BY z.id DESC`,[actor.workspace_id,actor.id,actor.roles.includes('delivery_lead'),actor.roles.includes('account_manager'),actor.roles.includes('admin')])).rows;
        return {status:200,chain,rows};
      });
    },
    async connection(member:Member,provider:Provider,operation:'pause'|'resume'|'reconnect',credential?:{token:string;account:string},guard=assertCan) {
      const actor=await owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor)return null;
        try {guard(actor,'manage_connections_roles',{workspace_id:actor.workspace_id});}catch(error) {
          if(!(error instanceof ForbiddenError))throw error;
          await append(db,actor.workspace_id,{action:'manage_connections_roles',outcome:'denied',target_type:provider});return null;
        }
        return actor;
      });
      if(!actor)return {status:403};
      const connections=new Connections(owner,actor.workspace_id,actor.id);
      if(operation==='reconnect') {
        if(!credential?.token||!credential.account)return {status:400};
        await connections.storeToken(provider,credential.token,credential.account);
      } else await connections[operation](provider);
      return {status:200};
    },
    async transitionDeliverable(member:Member,id:string,state:'started'|'review') {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);
        if(!actor||!actor.roles.some(role=>['admin','delivery_lead','contributor'].includes(role)))return {status:403};
        const row=(await db.query<{run_id:string;status:string;observed_at:string}>(`SELECT t.run_id,t.status,t.observed_at FROM monitor_tasks t WHERE t.workspace_id=$1 AND t.task_id=$2 AND (NOT ('contributor'=ANY($3::text[])) OR EXISTS(SELECT 1 FROM members m WHERE m.workspace_id=t.workspace_id AND m.id=$4 AND (m.clickup_user_id=ANY(t.assignee_ids) OR m.preferred_name=ANY(t.assignee_ids)))) FOR UPDATE`,[actor.workspace_id,id,actor.roles,actor.id])).rows[0];
        if(!row)return {status:404};
        const status=deliveryStatuses[state];
        if(row.status===status)return {status:200};
        await db.query(`INSERT INTO jobs(workspace_id,run_id,kind,dedupe_key,payload,status,next_attempt_at) VALUES($1,$2,'task_status',$3,$4,'queued',now()) ON CONFLICT DO NOTHING`,[actor.workspace_id,row.run_id,'task_status:'+id+':'+status+':'+row.observed_at,JSON.stringify({taskId:id,status})]);
        await append(db,actor.workspace_id,{action:'task_status_requested',outcome:'succeeded',target_type:'run',target_id:row.run_id,after:{task_id:id,status}});
        // A sample workspace has no live ClickUp board to report back, so the sample task changes right away.
        if(actor.is_demo)await db.query("UPDATE monitor_tasks SET status=$4,review_since=CASE WHEN $4='client review' THEN now() ELSE review_since END,client_approved_at=NULL,client_approved_by=NULL WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3",[actor.workspace_id,row.run_id,id,status]);
        if(state==='review'){
          const title=(await db.query<{title:string|null}>("SELECT s.title FROM monitor_tasks t LEFT JOIN scope_items s ON s.workspace_id=t.workspace_id AND s.id=t.scope_item_id WHERE t.workspace_id=$1 AND t.run_id=$2 AND t.task_id=$3",[actor.workspace_id,row.run_id,id])).rows[0]?.title??'';
          await tellMembers(db,actor.workspace_id,await clientPeopleFor(db,actor.workspace_id,row.run_id),{kind:'client_ready',en:sentence('en','doneTask',{title}),ar:sentence('ar','doneTask',{title}),link:`/deliverables/${encodeURIComponent(id)}`,dedupe:`ready:${id}:${Date.now()}`},actor.id);
          await tellMembers(db,actor.workspace_id,await agencyPeopleFor(db,actor.workspace_id,row.run_id),{kind:'client_step',en:sentence('en','doneTask',{title}),ar:sentence('ar','doneTask',{title}),link:`/deliverables/${encodeURIComponent(id)}`,dedupe:`task_done:${id}:${Date.now()}`},actor.id);
        }
        return {status:200};
      });
    },
    async approveDeliverable(member:Member,id:string,guard=assertCan) {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor)return {status:404};
        const row=(await db.query<{run_id:string;status:string;company:string;already_approved:boolean;review_cycle:string;title:string|null}>(`SELECT t.run_id,t.status,coalesce(t.review_since,t.observed_at)::text AS review_cycle,t.client_approved_at>=coalesce(t.review_since,t.observed_at) AS already_approved,d.client_company_id AS company,(SELECT s.title FROM scope_items s WHERE s.workspace_id=t.workspace_id AND s.id=t.scope_item_id) AS title FROM monitor_tasks t JOIN runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE t.workspace_id=$1 AND t.task_id=$2 FOR UPDATE OF t`,[actor.workspace_id,id])).rows[0];
        if(!row||!actor.roles.includes('client_reviewer')||row.company!==actor.client_company_id)return {status:404};
        guard(actor,'see_runs',{workspace_id:actor.workspace_id,client_company_id:row.company});
        if(row.status.toLowerCase()!=='client review'||row.already_approved)return {status:409};
        await db.query("UPDATE monitor_tasks SET review_since=coalesce(review_since,observed_at),client_approved_at=now(),client_approved_by=$4 WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3",[actor.workspace_id,row.run_id,id,actor.id]);
        await db.query(`INSERT INTO jobs(workspace_id,run_id,kind,dedupe_key,payload,status,next_attempt_at) VALUES($1,$2,'task_status',$3,$4,'queued',now()) ON CONFLICT DO NOTHING`,[actor.workspace_id,row.run_id,'client_complete:'+id+':'+row.review_cycle,JSON.stringify({taskId:id,status:deliveryStatuses.approved})]);
        await append(db,actor.workspace_id,{action:'deliverable_approved',outcome:'succeeded',target_type:'run',target_id:row.run_id,after:{task_id:id,title:row.title}});
        // The generic notice from the database is replaced by one that names who decided and what.
        await db.query("DELETE FROM notifications WHERE workspace_id=$1 AND dedupe_key=$2",[actor.workspace_id,'client_review:'+id]);
        const title=row.title??'';
        await tellMembers(db,actor.workspace_id,await agencyPeopleFor(db,actor.workspace_id,row.run_id,id),{kind:'client_step',en:sentence('en','approved',{name:actor.display_name,title}),ar:sentence('ar','approved',{name:actor.display_name,title}),link:`/deliverables/${encodeURIComponent(id)}`,dedupe:`client_approved:${id}:${row.review_cycle}`});
        return {status:200,title};
      });
    },
    /** The client asks for changes with a note. It becomes a fix for the delivery lead and the specialist hears about it too. */
    /** The client says they have sent something. The agency still confirms it arrived. */
    async markInputSent(member:Member,id:string) {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor||!actor.roles.includes('client_reviewer'))return {status:404};
        const row=(await db.query<{run_id:string;label:string|null;status:string;company:string}>("SELECT i.run_id,i.label,i.status,d.client_company_id AS company FROM onboarding_inputs i JOIN runs r ON r.workspace_id=i.workspace_id AND r.id=i.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE i.workspace_id=$1 AND i.id=$2 FOR UPDATE OF i",[actor.workspace_id,id])).rows[0];
        if(!row||row.company!==actor.client_company_id)return {status:404};
        if(row.status!=='missing')return {status:409};
        await db.query("UPDATE onboarding_inputs SET evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('sent_at',now(),'sent_by',$3::text) WHERE workspace_id=$1 AND id=$2",[actor.workspace_id,id,actor.id]);
        await append(db,actor.workspace_id,{action:'input_sent',outcome:'succeeded',target_type:'run',target_id:row.run_id,after:{input_id:id,title:row.label}});
        const title=row.label??'';
        await tellMembers(db,actor.workspace_id,await agencyPeopleFor(db,actor.workspace_id,row.run_id),{kind:'client_step',en:sentence('en','inputSent',{name:actor.display_name,title}),ar:sentence('ar','inputSent',{name:actor.display_name,title}),link:`/runs/${row.run_id}?tab=inputs`,dedupe:`input_sent:${id}`});
        return {status:200,title};
      });
    },
    async requestChanges(member:Member,id:string,note:string,guard=assertCan) {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor)return {status:404};
        const text=note.trim();
        const row=(await db.query<{run_id:string;status:string;company:string;already_approved:boolean;title:string|null;lead:string|null;manager:string|null}>(`SELECT t.run_id,t.status,t.client_approved_at>=coalesce(t.review_since,t.observed_at) AS already_approved,d.client_company_id AS company,(SELECT s.title FROM scope_items s WHERE s.workspace_id=t.workspace_id AND s.id=t.scope_item_id) AS title,r.delivery_lead_id AS lead,d.owner_member_id AS manager FROM monitor_tasks t JOIN runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE t.workspace_id=$1 AND t.task_id=$2 FOR UPDATE OF t`,[actor.workspace_id,id])).rows[0];
        if(!row||!actor.roles.includes('client_reviewer')||row.company!==actor.client_company_id)return {status:404};
        guard(actor,'see_runs',{workspace_id:actor.workspace_id,client_company_id:row.company});
        if(!text||text.length>2000)return {status:400};
        if(row.status.toLowerCase()!=='client review'||row.already_approved)return {status:409};
        const title=row.title??'';
        await db.query("UPDATE monitor_tasks SET status='changes requested' WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3",[actor.workspace_id,row.run_id,id]);
        const item=(await db.query<{id:string}>(`INSERT INTO recovery_items(workspace_id,run_id,kind,title,plain_reason,owner_member_id,status,allowed_options) VALUES($1,$2,$3,$4,$5,$6,'open',ARRAY['resolve_with_note']) RETURNING id`,[actor.workspace_id,row.run_id,'client_changes:'+id,`${actor.display_name} asked for changes to ${title}`,text,row.lead??row.manager])).rows[0];
        await append(db,actor.workspace_id,{action:'deliverable_changes_requested',outcome:'succeeded',target_type:'run',target_id:row.run_id,after:{task_id:id,title,note:text}});
        // The database notice for the owner is replaced by one that names the client and the work.
        await db.query("DELETE FROM notifications WHERE workspace_id=$1 AND dedupe_key=$2",[actor.workspace_id,'recovery:'+item.id]);
        await tellMembers(db,actor.workspace_id,[...await agencyPeopleFor(db,actor.workspace_id,row.run_id,id)],{kind:'client_step',en:sentence('en','changes',{name:actor.display_name,title}),ar:sentence('ar','changes',{name:actor.display_name,title}),link:'/recovery',dedupe:`client_changes:${item.id}`});
        return {status:200,title};
      });
    },
    /** Everything the detail screen shows for one deliverable, for the client who owns it or the agency staff who work on it. */
    async deliverable(member:Member,id:string) {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor)return null;
        const row=(await db.query<{run_id:string;status:string;due_at:string|null;title:string|null;quantity:number|null;cadence:string|null;source_page:number|null;source_quote:string|null;project:string;client:string;company:string;approved:boolean;assignees:string[];lead:string|null;manager:string|null}>(`SELECT t.run_id,t.status,t.due_at,s.title,s.quantity,s.cadence,s.source_page,s.source_quote,d.name AS project,c.name AS client,d.client_company_id AS company,coalesce(t.client_approved_at>=coalesce(t.review_since,t.observed_at),false) AS approved,t.assignee_ids AS assignees,r.delivery_lead_id AS lead,d.owner_member_id AS manager FROM monitor_tasks t JOIN runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id JOIN client_companies c ON c.workspace_id=d.workspace_id AND c.id=d.client_company_id LEFT JOIN scope_items s ON s.workspace_id=t.workspace_id AND s.id=t.scope_item_id WHERE t.workspace_id=$1 AND t.task_id=$2 ORDER BY t.observed_at DESC LIMIT 1`,[actor.workspace_id,id])).rows[0];
        if(!row)return null;
        const isClient=actor.roles.includes('client_reviewer');
        if(isClient&&row.company!==actor.client_company_id)return null;
        if(!isClient&&!actor.roles.some(r=>['admin','account_manager','delivery_lead'].includes(r))) {
          const mine=(await db.query("SELECT 1 FROM members m WHERE m.id=$1 AND (m.clickup_user_id=ANY($2::text[]) OR m.preferred_name=ANY($2::text[]))",[actor.id,row.assignees])).rows.length>0;
          if(!mine)return null;
        }
        const makers=(await db.query<{display_name:string}>("SELECT display_name FROM members WHERE workspace_id=$1 AND archived_at IS NULL AND NOT ('client_reviewer'=ANY(roles)) AND (clickup_user_id=ANY($2::text[]) OR preferred_name=ANY($2::text[])) ORDER BY display_name",[actor.workspace_id,row.assignees])).rows.map(r=>r.display_name);
        const rounds=(await db.query<{id:string;asked_by:string|null;note:string|null;asked_at:string;fixed_note:string|null;status:string;fixed_at:string|null}>(`SELECT x.id,split_part(x.title,' asked for changes to ',1) AS asked_by,x.plain_reason AS note,x.created_at::text AS asked_at,x.resolution_note AS fixed_note,x.status,(SELECT max(a.at)::text FROM audit_log a WHERE a.workspace_id=x.workspace_id AND a.action='recovery_resolve_with_note' AND a.target_id=x.id::text) AS fixed_at FROM recovery_items x WHERE x.workspace_id=$1 AND x.kind=$2 ORDER BY x.created_at,x.id`,[actor.workspace_id,'client_changes:'+id])).rows;
        const status=row.status.toLowerCase()==='client review'&&row.approved?'approved':row.status;
        return {id,run_id:row.run_id,title:row.title,status,due:row.due_at,project:row.project,client:row.client,quantity:row.quantity,cadence:row.cadence,page:row.source_page,quote:isClient?null:row.source_quote,makers,rounds,again:rounds.some(r=>r.status==='resolved'),canDecide:isClient&&status.toLowerCase()==='client review',isClient};
      });
    },
  };
}
