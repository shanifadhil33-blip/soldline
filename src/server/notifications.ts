import 'server-only';
import type { SqlConnection, TransactionDriver } from './db/withMember';
import { systemAudit } from './jobs/store';
export async function notifyBlock(db:SqlConnection,ws:string,finding:{id:string;owner_member_id:string|null;severity:string;title:string},actor:string|null=null,version='block') {
  if(finding.severity!=='block'||!finding.owner_member_id||finding.owner_member_id===actor) return;
  const row=(await db.query<{id:string}>(`INSERT INTO notifications(workspace_id,member_id,kind,body,link,dedupe_key,actor_member_id) SELECT $1,m.id,'block',CASE WHEN m.language='ar' THEN 'هناك أمر يحتاج إلى مراجعتك' ELSE $3 END,$4,$5,$6 FROM members m WHERE m.workspace_id=$1 AND m.id=$2 AND m.archived_at IS NULL ON CONFLICT DO NOTHING RETURNING id`,[ws,finding.owner_member_id,finding.title,'/recovery','finding:'+finding.id+':'+version,actor])).rows[0];
  if(row) await systemAudit(db,ws,'schedule','notification_created',row.id);
}
export function notificationStore(owner:TransactionDriver) {
  return {async digest(ws:string,now=Date.now()) {
    return owner.transaction(async db=>{
      const rows=await db.query<{id:string;language:string;local_date:string;local_time:string;digest_time:string}>(`SELECT m.id,m.language,to_char($2::timestamptz AT TIME ZONE coalesce(w.timezone,'Asia/Dubai'),'YYYYMMDD') AS local_date,to_char($2::timestamptz AT TIME ZONE coalesce(w.timezone,'Asia/Dubai'),'HH24:MI') AS local_time,to_char(m.digest_time,'HH24:MI') AS digest_time FROM members m JOIN workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=$1 AND m.archived_at IS NULL`,[ws,new Date(now).toISOString()]);
      for(const member of rows.rows) {
        if(member.local_time<member.digest_time) continue;
        const count=(await db.query<{n:number}>(`SELECT count(*)::int AS n FROM findings WHERE workspace_id=$1 AND owner_member_id=$2 AND status='open' AND (evidence->>'actor_member_id' IS NULL OR evidence->>'actor_member_id'<>$2::text)`,[ws,member.id])).rows[0].n;
        if(!count) continue;
        const body=member.language==='ar'?`لديك ${count} أمور تحتاج إلى مراجعة`:`You have ${count} items to review`;
        const row=(await db.query<{id:string}>(`INSERT INTO notifications(workspace_id,member_id,kind,body,dedupe_key) VALUES($1,$2,'digest',$3,$4) ON CONFLICT DO NOTHING RETURNING id`,[ws,member.id,body,'digest:'+member.local_date])).rows[0];
        if(row) await systemAudit(db,ws,'schedule','digest_created',row.id);
      }
    });
  }};
}
