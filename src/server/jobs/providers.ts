import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { Connections, type Provider } from '../integrations/connections';
import { MAIL_PATHS, type MailProvider } from '../integrations/mail';
import { z } from 'zod';
import { HUBSPOT_PATHS, crmObject, crmPage, type HubSpotClient } from '../integrations/hubspot';
import { ConnectionPaused, NeedsReconnect, ProviderRejected, RateLimited, Retryable } from '../integrations/errors';
import { decryptToken } from '../crypto';
import type { SqlConnection, TransactionDriver } from '../db/withMember';
import { systemAudit } from './store';
// Existing clients remain unchanged. This worker adapter has no member identity or credential write methods.
class WorkerConnections extends Connections {
  constructor(private readonly worker: TransactionDriver, ws: string, private readonly tokenKey?: string) { super(worker,ws,'',tokenKey); }
  private operation<T>(work: (db: SqlConnection)=>Promise<T>) { return this.worker.transaction(work); }
  override async load(provider: Provider) {
    return this.operation(async db=>{
      const r=await db.query<{status:string;token_ciphertext:string;external_account_id:string}>(`SELECT status,token_ciphertext,external_account_id FROM connections WHERE workspace_id=$1 AND provider=$2`,[this.workspaceId,provider]);
      const c=r.rows[0];
      if(c?.status==='paused') throw new ConnectionPaused();
      if(c?.status!=='connected' || !c.token_ciphertext) throw new NeedsReconnect();
      const token=decryptToken(c.token_ciphertext,this.tokenKey);
      return {token,bucketKey:createHash('sha256').update(provider==='hubspot'?c.external_account_id:token).digest('hex')};
    });
  }
  override async fault(provider: Provider): Promise<'outage'|'revoked'|undefined> {
    return this.operation(async db=>{
      const r=await db.query<{mode:'outage'|'revoked'}>(`UPDATE demo_faults f SET fail_next=fail_next-1 FROM workspaces w WHERE f.workspace_id=$1 AND f.provider=$2 AND f.fail_next>0 AND w.id=f.workspace_id AND w.is_demo=true RETURNING f.mode`,[this.workspaceId,provider]);
      if(r.rows[0]) await systemAudit(db,this.workspaceId,'system','provider_fault',provider);
      return r.rows[0]?.mode;
    });
  }
  override async record(provider: Provider, requestId: string, code: string, ok: boolean) {
    await this.operation(async db=>{
      if(ok) await db.query("UPDATE connections SET last_ok_at=now(),last_error_code=NULL WHERE workspace_id=$1 AND provider=$2 AND status='connected'",[this.workspaceId,provider]);
      await systemAudit(db,this.workspaceId,'system','provider_request',provider,{request_id:requestId,code,ok});
    });
  }
  override async markNeedsReconnect(provider: Provider, code: '401'|'403'|'simulated_revoked', requestId: string) {
    await this.operation(async db=>{
      await db.query("UPDATE connections SET status='needs_reconnect',last_error_code=$3 WHERE workspace_id=$1 AND provider=$2",[this.workspaceId,provider,code]);
      await systemAudit(db,this.workspaceId,'system','connection_needs_reconnect',provider,{request_id:requestId,code});
    });
  }
  override async take(provider: Provider, bucket: string, now: number) {
    if(provider==='mail') return 0;
    return this.operation(async db=>{
      const period=provider==='hubspot'?10000:60000;
      await db.query('INSERT INTO rate_buckets(workspace_id,provider,bucket_key,tokens,updated_at) VALUES($1,$2,$3,100,$4) ON CONFLICT DO NOTHING',[this.workspaceId,provider,bucket,new Date(now).toISOString()]);
      const r=await db.query<{tokens:string;updated_at:string}>('SELECT tokens,updated_at FROM rate_buckets WHERE provider=$1 AND bucket_key=$2 FOR UPDATE',[provider,bucket]);
      const tokens=Math.min(100,Number(r.rows[0].tokens)+Math.max(0,now-new Date(r.rows[0].updated_at).getTime())*100/period);
      await db.query('UPDATE rate_buckets SET tokens=$3,updated_at=$4 WHERE provider=$1 AND bucket_key=$2',[provider,bucket,tokens>=1?tokens-1:tokens,new Date(now).toISOString()]);
      await systemAudit(db,this.workspaceId,'system','provider_limit_checked',provider);
      return tokens>=1?0:Math.ceil((1-tokens)*period/100);
    });
  }
}
export function systemProviders(owner: TransactionDriver, key?: string) {
  // Worker reads have a shared deadline. Existing member clients keep their P4 contracts.
  async function read<T>(ws: string, provider: 'mail'|'hubspot', url: string, schema: z.ZodType<T>, deadline: number, body?: unknown): Promise<T> {
    const connections=new WorkerConnections(owner,ws,key);
    const {token,bucketKey}=await connections.load(provider);
    const fault=await connections.fault(provider);
    const requestId=randomUUID();
    if(fault==='revoked') {await connections.markNeedsReconnect(provider,'simulated_revoked',requestId);throw new NeedsReconnect();}
    if(fault) {await connections.record(provider,requestId,'simulated_outage',false);throw new Retryable();}
    const delay=await connections.take(provider,bucketKey,Date.now());
    if(delay) throw new RateLimited(Date.now()+delay);
    const remaining=deadline-Date.now()-250;
    if(remaining<=0) throw new Retryable();
    await connections.record(provider,requestId,'started',false);
    let response: Response;
    try {
      response=await fetch(url,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(Math.max(1,remaining)),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','X-Request-Id':requestId},body:body===undefined?undefined:JSON.stringify(body)});
      if(response.status===401||response.status===403) {await connections.markNeedsReconnect(provider,String(response.status) as '401'|'403',requestId);throw new NeedsReconnect();}
      if(!response.ok) {
        await connections.record(provider,requestId,String(response.status),false);
        if(response.status===429) throw new RateLimited(Date.now()+60000);
        if(response.status>=500) throw new Retryable();
        throw new ProviderRejected();
      }
      const result=schema.parse(await response.json());
      await connections.record(provider,requestId,String(response.status),true);
      return result;
    } catch(error) {
      if(error instanceof NeedsReconnect||error instanceof RateLimited||error instanceof ProviderRejected||error instanceof Retryable) throw error;
      await connections.record(provider,requestId,'network_or_response',false);
      throw new Retryable();
    }
  }
  return {
    mail(ws: string, inbox: string, deadline=Date.now()+25000): Pick<MailProvider,'listMessagesSince'> {
      return {async listMessagesSince(cursor) {
        const schema=z.object({messages:z.array(z.object({message_id:z.string(),thread_id:z.string().optional(),to:z.array(z.string()).optional(),subject:z.string().optional(),text:z.string().optional(),timestamp:z.string().optional()}).passthrough()),next_page_token:z.string().optional()});
        return read(ws,'mail',(process.env.MAIL_API_BASE ?? 'https://api.agentmail.to/v0').replace(/\/$/,'')+MAIL_PATHS.messages(inbox)+'?'+new URLSearchParams({after:cursor}),schema,deadline);
      }};
    },
    hubspot(ws: string, deadline=Date.now()+25000): Pick<HubSpotClient,'getDeal'|'searchDealsModifiedSince'> {
      const properties='dealname,dealstage,amount,closedate,hubspot_owner_id,hs_lastmodifieddate,soldline_delivery_status,soldline_plan_url,soldline_run_ref';
      return {
        getDeal(id) {return read(ws,'hubspot','https://api.hubapi.com'+HUBSPOT_PATHS.deals+'/'+encodeURIComponent(id)+'?'+new URLSearchParams({properties,associations:'line_items,companies,contacts,notes'}),crmObject,deadline);},
        searchDealsModifiedSince(cursor,after) {return read(ws,'hubspot','https://api.hubapi.com'+HUBSPOT_PATHS.search,crmPage,deadline,{filterGroups:[{filters:[{propertyName:'hs_lastmodifieddate',operator:'GTE',value:cursor}]}],properties:properties.split(','),limit:100,...(after?{after}:{})});},
      };
    },
  };
}
