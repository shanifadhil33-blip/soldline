import 'server-only';
import { append, verifyChain } from './audit';
import { assertCan, ForbiddenError, type Member } from './permissions';
import { Connections, type Provider } from './integrations/connections';
import type { SqlConnection, TransactionDriver } from './db/withMember';

export async function clientRecords(db:SqlConnection,member:Member) {
  // RLS and an explicit company predicate both protect every client collection.
  const company=member.roles.includes('client_reviewer')?member.client_company_id:null;
  if(member.roles.includes('client_reviewer')&&!company)return {runs:[],inputs:[],deliverables:[]};
  const runs=(await db.query<{id:string;name:string}>(`SELECT r.id,d.name FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND ($2::uuid IS NULL OR d.client_company_id=$2) ORDER BY d.name`,[member.workspace_id,company])).rows;
  const ids=runs.map(r=>r.id);
  const inputs=(await db.query<{id:string;run_id:string;label:string;status:string}>('SELECT id,run_id,label,status FROM onboarding_inputs WHERE run_id=ANY($1::uuid[]) ORDER BY id',[ids])).rows;
  const deliverables=(await db.query<{id:string;run_id:string;title:string;status:string}>(`SELECT t.task_id AS id,t.run_id,s.title,CASE WHEN lower(t.status)='client review' AND t.client_approved_at>=coalesce(t.review_since,t.observed_at) THEN 'approved' ELSE t.status END AS status FROM monitor_tasks t LEFT JOIN scope_items s ON s.workspace_id=t.workspace_id AND s.id=t.scope_item_id WHERE t.run_id=ANY($1::uuid[]) ORDER BY t.task_id`,[ids])).rows;
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
        ) SELECT a.*,coalesce((SELECT t.run_id::text FROM targets t WHERE t.id=a.target_id LIMIT 1),(SELECT x.run_id::text FROM approvals x WHERE x.workspace_id=$1 AND x.id=a.approval_id)) AS run_id FROM audit_log a WHERE a.workspace_id=$1 AND ($5 OR a.target_id IN (SELECT id FROM targets) OR a.approval_id::text IN (SELECT id FROM targets)) ORDER BY a.id DESC`,[actor.workspace_id,actor.id,actor.roles.includes('delivery_lead'),actor.roles.includes('account_manager'),actor.roles.includes('admin')])).rows;
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
    async approveDeliverable(member:Member,id:string,guard=assertCan) {
      return owner.transaction(async db=>{
        const actor=await identity(db,member);if(!actor)return {status:404};
        const row=(await db.query<{run_id:string;status:string;company:string;already_approved:boolean}>(`SELECT t.run_id,t.status,t.client_approved_at>=coalesce(t.review_since,t.observed_at) AS already_approved,d.client_company_id AS company FROM monitor_tasks t JOIN runs r ON r.workspace_id=t.workspace_id AND r.id=t.run_id JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE t.workspace_id=$1 AND t.task_id=$2 FOR UPDATE OF t`,[actor.workspace_id,id])).rows[0];
        if(!row||!actor.roles.includes('client_reviewer')||row.company!==actor.client_company_id)return {status:404};
        guard(actor,'see_runs',{workspace_id:actor.workspace_id,client_company_id:row.company});
        if(row.status.toLowerCase()!=='client review'||row.already_approved)return {status:409};
        await db.query("UPDATE monitor_tasks SET review_since=coalesce(review_since,observed_at),client_approved_at=now(),client_approved_by=$4 WHERE workspace_id=$1 AND run_id=$2 AND task_id=$3",[actor.workspace_id,row.run_id,id,actor.id]);
        await append(db,actor.workspace_id,{action:'deliverable_approved',outcome:'succeeded',target_type:'run',target_id:row.run_id,after:{task_id:id}});
        return {status:200};
      });
    },
  };
}
