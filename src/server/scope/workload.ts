import 'server-only';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { RateLimited, NeedsReconnect } from '../integrations/errors';
import type { TransactionDriver } from '../db/withMember';
import { decryptToken } from '../crypto';
import { systemAudit } from '../jobs/store';
const responseSchema=z.object({tasks:z.array(z.object({id:z.string(),status:z.object({type:z.string()}).optional(),assignees:z.array(z.object({id:z.number()})).default([])})),last_page:z.boolean().optional()});
// Read only ClickUp list tasks. Incomplete workload reads fail the proposal rather than choosing from partial counts.
export async function openTaskCounts(owner:TransactionDriver, ws:string, lists:string[]):Promise<Record<string,number>> {
  if(!lists.length) return {};
  const connection=await owner.transaction(async db=>(await db.query<{status:string;token_ciphertext:string}>("SELECT status,token_ciphertext FROM connections WHERE workspace_id=$1 AND provider='clickup'",[ws])).rows[0]);
  if(connection?.status!=='connected' || !connection.token_ciphertext) throw new Error('ClickUp connection needs attention');
  const token=decryptToken(connection.token_ciphertext);
  const bucket=createHash('sha256').update(token).digest('hex');
  const deadline=Date.now()+25000;
  const counts:Record<string,number>={}, seen=new Set<string>();
  for(const list of [...new Set(lists)]) {
    for(let page=0;page<100;page++) {
      const requestId=randomUUID();
      await owner.transaction(async db=>{
        const now=Date.now();
        await db.query("INSERT INTO rate_buckets(workspace_id,provider,bucket_key,tokens,updated_at) VALUES($1,'clickup',$2,100,$3) ON CONFLICT DO NOTHING",[ws,bucket,new Date(now).toISOString()]);
        const row=(await db.query<{tokens:string;updated_at:string}>("SELECT tokens,updated_at FROM rate_buckets WHERE provider='clickup' AND bucket_key=$1 FOR UPDATE",[bucket])).rows[0];
        const tokens=Math.min(100,Number(row.tokens)+Math.max(0,now-new Date(row.updated_at).getTime())*100/60000);
        if(tokens<1) throw new RateLimited(now+Math.ceil((1-tokens)*600));
        await db.query("UPDATE rate_buckets SET tokens=$2,updated_at=$3 WHERE provider='clickup' AND bucket_key=$1",[bucket,tokens-1,new Date(now).toISOString()]);
        await systemAudit(db,ws,'system','provider_limit_checked','clickup',{request_id:requestId});
      });
      let ok=false;
      try {
        const remaining=deadline-Date.now();
        if(remaining<=0) throw new Error('ClickUp workload is incomplete');
        const response=await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(list)}/task?include_closed=false&subtasks=true&page=${page}`,{headers:{Authorization:token,'X-Request-Id':requestId},signal:AbortSignal.timeout(Math.min(8000,remaining)),redirect:'error'});
        if(response.status===401 || response.status===403) {
          await owner.transaction(async db=>{
            await db.query("UPDATE connections SET status='needs_reconnect',last_error_code=$2 WHERE workspace_id=$1 AND provider='clickup'",[ws,String(response.status)]);
            await systemAudit(db,ws,'system','connection_needs_reconnect','clickup',{request_id:requestId,code:String(response.status)});
          });
          throw new NeedsReconnect();
        }
        if(!response.ok) throw new Error('ClickUp workload needs attention');
        const result=responseSchema.parse(await response.json());
        for(const task of result.tasks) {
          if(seen.has(task.id)) throw new Error('ClickUp returned a repeated task');
          seen.add(task.id);
          if(task.status?.type==='closed') continue;
          for(const member of task.assignees) counts[String(member.id)]=(counts[String(member.id)]??0)+1;
        }
        ok=true;
        if(result.last_page || !result.tasks.length) break;
        if(page===99) throw new Error('ClickUp workload is incomplete');
      } finally {
        await owner.transaction(db=>systemAudit(db,ws,'system',ok?'workload_read':'workload_read_failed',list,{page,ok,request_id:requestId}));
      }
    }
  }
  return counts;
}
