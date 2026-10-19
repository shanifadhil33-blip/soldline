import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { http, HttpResponse } from 'msw';
import { createDatabase, fixture } from './helpers/pglite';
import { ownerServices } from '../src/server/db/owner';
import { jobStore, type JobStore, type Connection, type Job } from '../src/server/jobs/store';
import { systemProviders } from '../src/server/jobs/providers';
import { work, perform, type Providers } from '../src/server/jobs/worker';
import { webhookHandlers, tickHandler } from '../src/server/events/http';
import { hubspotUri, verifyHubspot, verifyClickup } from '../src/server/events/signatures';
import { encryptToken } from '../src/server/crypto';
import { verifyChain } from '../src/server/audit';
import type { Member } from '../src/server/permissions';
import type { HubspotEvent } from '../src/server/events/model';
import { server } from './fixtures/http';
let ctx: Awaited<ReturnType<typeof createDatabase>>, store: JobStore, providers: Providers;
const a=fixture(1), b=fixture(2), secret='fixture_secret', key=Buffer.alloc(32,7).toString('base64');
const inbox='bilal@example.test';
const mailUrl=`https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages`;
const searchUrl='https://api.hubapi.com/crm/objects/2026-03/deals/search';
const kick=vi.fn();
let handlers: ReturnType<typeof webhookHandlers>;
beforeAll(async()=>{ctx=await createDatabase();},60000);
afterAll(async()=>{await ctx?.db.close();});
beforeEach(async()=>{
  vi.stubEnv('MAIL_PROVIDER','agentmail');
  // Keep the existing fixture graph and clear only P5 records between cases.
  await ctx.db.query('UPDATE runs SET trigger_event_id=NULL');
  await ctx.db.query("DELETE FROM recovery_items WHERE job_id IN (SELECT id FROM jobs WHERE kind IS NOT NULL)");
  await ctx.db.query('DELETE FROM jobs WHERE kind IS NOT NULL');
  await ctx.db.query("DELETE FROM inbound_events WHERE source<>'mail' OR dedupe_key LIKE 'mail:%'");
  await ctx.db.query("DELETE FROM runs WHERE run_key LIKE 'deal:0:won:%'");
  await ctx.db.query('DELETE FROM rate_buckets');
  await ctx.db.query("UPDATE runs SET plus_address=NULL,mail_thread_ids='{}'");
  for(const provider of ['hubspot','clickup','mail']) {
    await ctx.db.query(`INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id,won_stage_id,delivery_lead_id,webhook_secrets) VALUES($1,$2,'connected',$3,$4,'won',$5,$6) ON CONFLICT(workspace_id,provider) DO UPDATE SET status='connected',token_ciphertext=$3,external_account_id=$4,won_stage_id='won',delivery_lead_id=$5,poll_cursor=NULL,webhook_secrets=$6`,[a.ws,provider,encryptToken('fixture_token',key),provider==='mail'?inbox:'123',a.lead,JSON.stringify({hook:encryptToken(secret,key)})]);
  }
  store=jobStore(ctx.db); providers=systemProviders(ctx.db,key); handlers=webhookHandlers(store,kick,secret,key); kick.mockClear();
});
const event=(eventId='event1',objectId='0'): HubspotEvent=>({eventId,portalId:'123',objectId,subscriptionType:'deal.propertyChange',propertyName:'dealstage',propertyValue:'won'});
function signed(raw: string, timestamp=String(Date.now()), uri='https://fixtures.soldline.test/api/webhooks/hubspot', method='POST') {
  return new Request(uri,{method,body:raw,headers:{'X-HubSpot-Request-Timestamp':timestamp,'X-HubSpot-Signature-v3':createHmac('sha256',secret).update(method+hubspotUri(uri)+raw+timestamp).digest('base64')}});
}
function jobFor(kind: string,connectionId: string): Job {return {id:'fixture',workspace_id:a.ws,kind,payload:{connectionId},run_id:null,attempts:1,lock_token:'fixture'};}
async function connection(provider='hubspot') { return (await ctx.db.query<Connection>('SELECT * FROM connections WHERE workspace_id=$1 AND provider=$2',[a.ws,provider])).rows[0]; }
async function count(table: string, where: string, params: unknown[]=[]) {return Number((await ctx.db.query<{n:string}>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,params)).rows[0].n);}
const member=(roles: Member['roles']=['admin'], memberId=a.admin, ws=a.ws): Member=>({id:memberId,workspace_id:ws,roles,display_name:'Adhil',client_company_id:null,is_demo:false});
it('Accepts a valid HubSpot signature and stores only one event and one job on duplicate delivery',async()=>{
  const raw=JSON.stringify([event()]);
  expect((await handlers.hubspot(signed(raw))).status).toBe(200);
  expect((await handlers.hubspot(signed(raw))).status).toBe(200);
  expect(await count('inbound_events',"dedupe_key='hubspot:123:event1'")).toBe(1);
  expect(await count('jobs',"kind='process_event'")).toBe(1);
  expect(kick).toHaveBeenCalledTimes(2);
});
it.each(['invalid','old','future','missing','wrongUri','wrongMethod','changedBody'])('Refuses %s HubSpot signatures before parsing or persistence',async kind=>{
  let request=signed('not json');
  if(kind==='invalid') request.headers.set('X-HubSpot-Signature-v3','invalid');
  if(kind==='old'||kind==='future') request=signed('not json',String(Date.now()+(kind==='old'?-301000:301000)));
  if(kind==='missing') request.headers.delete('X-HubSpot-Request-Timestamp');
  if(kind==='wrongUri') request=new Request('https://fixtures.soldline.test/other',{method:'POST',body:'not json',headers:request.headers});
  if(kind==='wrongMethod') request=new Request(request.url,{method:'PUT',body:'not json',headers:request.headers});
  if(kind==='changedBody') request=new Request(request.url,{method:'POST',body:'changed',headers:request.headers});
  const parser=vi.spyOn(JSON,'parse');
  const response=await handlers.hubspot(request); expect(parser).not.toHaveBeenCalled(); parser.mockRestore();
  expect(response.status).toBe(401); expect(kick).not.toHaveBeenCalled();
  expect(await count('inbound_events',"source='hubspot'")).toBe(0);
});
it('Decodes the specified HubSpot URI escapes and accepts the five minute boundary',()=>{
  const now=Date.now(),raw='[]'; const request=signed(raw,String(now-300000),'https://fixtures.soldline.test/api?path=%2Fdeal%3Fa%3D1%26b%3D2');
  expect(verifyHubspot(request,raw,secret,now)).toBe(true);
  expect(hubspotUri(request.url)).toContain('/deal?a%3D1%26b%3D2');
});
it('Parses malformed JSON only after a valid HubSpot signature',async()=>{expect((await handlers.hubspot(signed('not json'))).status).toBe(400);});
it('Verifies ClickUp before JSON parsing and deduplicates each history item',async()=>{
  const raw=JSON.stringify({webhook_id:'hook',event:'taskUpdated',task_id:'task1',history_items:[{id:'one'},{id:'two'}]});
  const request=()=>new Request('https://fixtures.soldline.test/api/webhooks/clickup',{method:'POST',body:raw,headers:{'X-Signature':createHmac('sha256',secret).update(raw).digest('hex')}});
  expect((await handlers.clickup(request())).status).toBe(200); expect((await handlers.clickup(request())).status).toBe(200);
  expect(await count('inbound_events',"source='clickup'")).toBe(2);
  expect(verifyClickup(raw,'bad',secret)).toBe(false);
  const invalid=new Request(request().url,{method:'POST',body:'not json',headers:{'X-Signature':'0'.repeat(64)}});
  expect((await handlers.clickup(invalid)).status).toBe(401);
});
it('Refuses a ClickUp body with a different webhook id even when another stored secret signed it',async()=>{
  const raw=JSON.stringify({webhook_id:'other',event:'taskUpdated',history_items:[{id:'one'}]});
  expect((await handlers.clickup(new Request('https://fixtures.soldline.test/api',{method:'POST',body:raw,headers:{'X-Signature':createHmac('sha256',secret).update(raw).digest('hex')}}))).status).toBe(401);
});
it('Two different won events create exactly one analyse job and one run and replay creates zero actions',async()=>{
  await handlers.hubspot(signed(JSON.stringify([event('one'),event('two')])));
  expect(await work(store,providers)).toBe(3);
  expect(await count('jobs',"kind='analyse_deal'")).toBe(1);
  expect(await count('runs',"run_key LIKE 'deal:0:won:%'")).toBe(1);
  const run=(await ctx.db.query<{id:string}>("SELECT id FROM runs WHERE run_key LIKE 'deal:0:won:%'")).rows[0];
  expect(await store.replay(member(),run.id)).toEqual({status:200,newActions:0,message:'No new actions'});
  expect(await count('runs',"run_key LIKE 'deal:0:won:%'")).toBe(1);
  expect(await count('audit_log',"action='event_replayed' AND after->>'received_via'='replay'")).toBeGreaterThan(0);
});
it('Ignores unrelated deal changes and refuses an unknown portal',async()=>{
  await handlers.hubspot(signed(JSON.stringify([{...event(),propertyValue:'open'},{...event('other'),portalId:'unknown'}])));
  await work(store,providers);
  expect(await count('jobs',"kind='analyse_deal'")).toBe(0);
  expect(await count('inbound_events',"source='hubspot'")).toBe(1);
});
it('Claims distinct jobs and reclaims expired leases while refusing stale completion',async()=>{
  await store.ingestHubspot(await connection(),[event('one'),event('two')],'webhook');
  const now=Date.now()+1000,first=(await store.claim(now))!,second=(await store.claim(now))!;
  expect(first.id).not.toBe(second.id); expect(await store.claim(now)).toBeUndefined();
  const reclaimed=(await store.claim(now+120001))!; expect(reclaimed.attempts).toBe(2);
  await store.finish(first,true,now+120002);
  expect((await ctx.db.query<{status:string}>('SELECT status FROM jobs WHERE id=$1',[first.id])).rows[0].status).toBe('running');
  await store.finish(reclaimed,true,now+120003);
});
it('Five failures produce exactly one recovery item with the delivery lead and exact backoff',async()=>{
  await ctx.db.query("INSERT INTO jobs(workspace_id,kind,payload,run_id,dedupe_key,status,attempts,next_attempt_at) VALUES($1,'analyse_deal','{}',$2,'failure','queued',0,now())",[a.ws,a.runA]);
  await ctx.db.query('UPDATE runs SET delivery_lead_id=$2 WHERE id=$1',[a.runA,a.lead]);
  let now=Date.now()+1000; let last: Job|undefined;
  for(const [index,delay] of [30000,120000,600000,1800000,7200000].entries()) {
    const job=(await store.claim(now))!; expect(job.attempts).toBe(index+1);
    await store.finish(job,false,now);
    const row=(await ctx.db.query<{status:string;next_attempt_at:string}>('SELECT status,next_attempt_at FROM jobs WHERE id=$1',[job.id])).rows[0];
    expect(new Date(row.next_attempt_at).getTime()).toBe(now+delay);
    expect(row.status).toBe(index===4?'dead':'failed');
    expect(await store.claim(now+delay-1)).toBeUndefined(); now+=delay; last=job;
  }
  await store.finish(last!,false,now);
  const recovery=await ctx.db.query('SELECT owner_member_id,plain_reason FROM recovery_items WHERE job_id=$1',[last!.id]);
  expect(recovery.rows).toEqual([{owner_member_id:a.lead,plain_reason:'This job could not finish after five attempts'}]);
});
it.each(['','Bearer wrong','Basic secret'])('Secures tick for bearer %s before schedule and work',async authorization=>{
  const worker=vi.fn(async()=>0); const schedule=vi.spyOn(store,'schedule');
  expect((await tickHandler(store,worker,secret)(new Request('https://fixtures.soldline.test/tick',{method:'POST',headers:{Authorization:authorization}}))).status).toBe(401);
  expect(schedule).not.toHaveBeenCalled(); expect(worker).not.toHaveBeenCalled();
});
it('Accepts tick bearer and queues each connected inbox and HubSpot once per bucket',async()=>{
  const worker=vi.fn(async()=>0), handler=tickHandler(store,worker,secret);
  for(let n=0;n<2;n++) expect((await handler(new Request('https://fixtures.soldline.test/tick',{method:'POST',headers:{Authorization:`Bearer ${secret}`}}))).status).toBe(200);
  expect(await count('jobs',"kind='mail_poll'")).toBe(2); // Both fixture workspaces have a connected inbox.
  expect(await count('jobs',"kind='reconcile_hubspot'")).toBe(1);
});
it('Stores no unrelated mail and persists the next cursor per connection',async()=>{
  const c=await connection('mail'); await ctx.db.query('UPDATE connections SET poll_cursor=$2 WHERE id=$1',[c.id,'cursor1']);
  server.use(http.get(mailUrl,({request})=>{expect(new URL(request.url).searchParams.get('after')).toBe('cursor1'); return HttpResponse.json({messages:[{message_id:'unrelated',thread_id:'other',to:['omar@example.test'],text:'Private'}],next_page_token:'cursor2'});}));
  await perform(store,providers,jobFor('mail_poll',c.id));
  expect(await count('inbound_events',"dedupe_key LIKE 'mail:%'")).toBe(0);
  expect((await connection('mail')).poll_cursor).toBe('cursor2');
});
it('Stores linked mail only once and links the thread when addressed to a run plus address',async()=>{
  const c=await connection('mail'); await ctx.db.query("UPDATE runs SET plus_address='bilal+run@example.test' WHERE id=$1",[a.runA]);
  const messages=[{message_id:'one',thread_id:'thread1',to:['BILAL+RUN@example.test'],text:'Ready'},{message_id:'two',thread_id:'thread1',to:['omar@example.test'],text:'Thanks'},{message_id:'three',thread_id:'other',text:'Private'}];
  await store.saveMail(c,messages,'cursor2'); await store.saveMail(c,messages,'cursor2');
  expect(await count('inbound_events',"dedupe_key LIKE 'mail:%'")).toBe(2);
});
it('Reconciles every HubSpot page and reuses event dedupe on repeated results',async()=>{
  const c=await connection(); let requests=0;
  server.use(http.post(searchUrl,async({request})=>{const body=await request.json() as {after?:string}; requests++; return HttpResponse.json({results:[{id:'0',properties:{dealstage:'won',hs_lastmodifieddate:body.after?'200':'100'}}],...(body.after?{}:{paging:{next:{after:'page2'}}})});}));
  const job=jobFor('reconcile_hubspot',c.id);
  await perform(store,providers,job,()=>300); await perform(store,providers,job,()=>400);
  expect(requests).toBe(4); expect((await connection()).poll_cursor).toBe('400');
  expect(await count('inbound_events',"received_via='reconcile'")).toBe(2);
  await work(store,providers); expect(await count('runs',"run_key LIKE 'deal:0:won:%'")).toBe(1);
});
it('Keeps the reconcile cursor unchanged on a later page failure',async()=>{
  const c=await connection(); server.use(http.post(searchUrl,async({request})=>{const body=await request.json() as {after?:string}; return body.after?HttpResponse.json({}, {status:500}):HttpResponse.json({results:[],paging:{next:{after:'page2'}}});}));
  await expect(perform(store,providers,jobFor('reconcile_hubspot',c.id))).rejects.toThrow();
  expect((await connection()).poll_cursor).toBeNull();
});
it('Limits one worker invocation to twenty jobs',async()=>{
  await store.ingestHubspot(await connection(),Array.from({length:25},(_,i)=>({...event(String(i)),propertyValue:'open'})),'webhook');
  expect(await work(store,providers)).toBe(20);
  expect(await count('jobs',"kind='process_event' AND status='queued'")).toBe(5);
});
it('Stops claiming when the time budget ends',async()=>{
  const claim=vi.spyOn(store,'claim'); let time=0;
  expect(await work(store,providers,()=>{time+=25000;return time;})).toBe(0); expect(claim).not.toHaveBeenCalled();
});
it('Refuses replay by a contributor or across workspaces',async()=>{
  expect((await store.replay(member(['contributor'],a.contributor),a.runA)).status).toBe(403);
  expect((await store.replay(member(),b.runA)).status).toBe(404);
});
it('Allows demo Omar to replay the stored event',async()=>{
  const owner=ownerServices(ctx.db),ticket=await owner.demo.start('omar',null);
  const omar=(await owner.demo.member(ticket))!;
  const deal=(await ctx.db.query<{hubspot_deal_id:string}>("SELECT hubspot_deal_id FROM deals WHERE workspace_id=$1 ORDER BY name DESC LIMIT 1",[ticket.sandbox])).rows[0];
  await ctx.db.query("INSERT INTO connections(workspace_id,provider,status,external_account_id,won_stage_id) VALUES($1,'hubspot','connected','123','won')",[ticket.sandbox]);
  const c=(await ctx.db.query<Connection>("SELECT * FROM connections WHERE workspace_id=$1 AND provider='hubspot'",[ticket.sandbox])).rows[0];
  await store.ingestHubspot(c,[event('demo',deal.hubspot_deal_id)],'webhook');
  await work(store,providers);
  const run=(await ctx.db.query<{id:string}>('SELECT id FROM runs WHERE workspace_id=$1 AND trigger_event_id IS NOT NULL',[ticket.sandbox])).rows[0];
  expect(await store.replay(omar,run.id)).toEqual({status:200,newActions:0,message:'No new actions'});
  await ctx.db.query('UPDATE workspaces SET demo_expires_at=now() WHERE id=$1',[ticket.sandbox]);
});
it('System audit keeps trusted actors, a valid chain and denies app access to the system append',async()=>{
  await store.ingestHubspot(await connection(),[event()],'webhook'); await work(store,providers);
  expect(await verifyChain(ctx.db,a.ws)).toEqual({ok:true,brokenAtId:null});
  const rows=await ctx.db.query<{actor_type:string;actor_member_id:string|null}>("SELECT actor_type,actor_member_id FROM audit_log WHERE action IN ('event_received','job_claimed','run_received')");
  expect(rows.rows.length).toBeGreaterThan(0); expect(rows.rows.every(r=>['webhook','system','schedule'].includes(r.actor_type)&&r.actor_member_id===null)).toBe(true);
  await expect(ctx.asMember(a.admin,db=>db.query("SELECT audit_system_append($1,'system','{}')",[a.ws]))).rejects.toThrow(/permission denied/);
});
it('Includes the scheduled tick and daily cron files',()=>{
  expect(readFileSync('.github/workflows/tick.yml','utf8')).toContain("cron: '*/5 * * * *'");
  expect(JSON.parse(readFileSync('vercel.json','utf8')).crons).toEqual([{path:'/api/jobs/daily',schedule:'0 3 * * *'}]);
});
it('Parses both webhook bodies only after the signature refusal branches',()=>{
  const source=readFileSync('src/server/events/http.ts','utf8');
  const hub=source.slice(source.indexOf('async hubspot('),source.indexOf('async clickup('));
  const click=source.slice(source.indexOf('async clickup('));
  expect(hub.indexOf('JSON.parse(raw)')).toBeGreaterThan(hub.indexOf('if(!verifyHubspot'));
  expect(click.indexOf('JSON.parse(raw)')).toBeGreaterThan(click.indexOf('if(!matches.length)'));
});
it('Imports a won deal that was absent locally using the provider fixture',async()=>{
  const external='missing';
  server.use(http.get(`https://api.hubapi.com/crm/objects/2026-03/deals/${external}`,()=>HttpResponse.json({id:external,properties:{dealname:'New delivery',dealstage:'won',hs_lastmodifieddate:'2026-10-18T00:00:00Z'},associations:{companies:{results:[{id:'company1'}]}}})));
  await store.ingestHubspot(await connection(),[event('new',external)],'webhook');
  expect(await work(store,providers)).toBe(2);
  const rows=await ctx.db.query<{run_key:string;plus_address:string;delivery_lead_id:string}>(`SELECT r.run_key,r.plus_address,r.delivery_lead_id FROM runs r JOIN deals d ON d.id=r.deal_id AND d.workspace_id=r.workspace_id WHERE d.workspace_id=$1 AND d.hubspot_deal_id=$2`,[a.ws,external]);
  expect(rows.rows).toHaveLength(1); expect(rows.rows[0].run_key).toMatch(/^deal:missing:won:[a-f0-9]{64}$/);
  expect(rows.rows[0].plus_address).toMatch(/^bilal\+run[a-f0-9]{32}@example.test$/); expect(rows.rows[0].delivery_lead_id).toBe(a.lead);
});
it('Retains unknown fields in the stored raw HubSpot event for replay',async()=>{
  await handlers.hubspot(signed(JSON.stringify([{...event(),subscriptionId:123,attemptNumber:2}])));
  const rows=await ctx.db.query<{raw:{subscriptionId:number;attemptNumber:number}}>("SELECT raw FROM inbound_events WHERE dedupe_key='hubspot:123:event1'");
  expect(rows.rows[0].raw).toMatchObject({subscriptionId:123,attemptNumber:2});
});
it('An expired fifth lease becomes dead without a sixth execution',async()=>{
  await ctx.db.query(`INSERT INTO jobs(workspace_id,kind,payload,run_id,dedupe_key,status,attempts,locked_until) VALUES($1,'analyse_deal','{}',$2,'expired','running',5,now()-interval '1 second')`,[a.ws,a.runA]);
  const analyse=vi.spyOn(store,'analyse');
  expect(await work(store,providers)).toBe(1); expect(analyse).not.toHaveBeenCalled();
  expect(await count('jobs',"dedupe_key='expired' AND status='dead' AND attempts=5")).toBe(1);
  expect(await count('recovery_items',"job_id IN (SELECT id FROM jobs WHERE dedupe_key='expired')")).toBe(1);
});
it('Queues reconciliation and keep alive for the secured daily request',async()=>{
  const worker=vi.fn(async()=>0);
  const handler=tickHandler(store,worker,secret,true);
  expect((await handler(new Request('https://fixtures.soldline.test/daily'))).status).toBe(401);
  expect((await handler(new Request('https://fixtures.soldline.test/daily',{headers:{Authorization:`Bearer ${secret}`}}))).status).toBe(200);
  expect(await count('jobs',"kind='hubspot_keep_alive'")).toBe(1);
  expect(await count('jobs',"kind='reconcile_hubspot'")).toBe(1);
  expect(await count('jobs',"kind='mail_poll'")).toBe(0);
});
it('Aborts worker HTTP reads when their shared deadline expires',async()=>{
  const c=await connection('mail');
  server.use(http.get(mailUrl,async({request})=>{
    await new Promise<void>(resolve=>{
      if(request.signal.aborted) resolve();
      else request.signal.addEventListener('abort',()=>resolve(),{once:true});
    });
    return HttpResponse.json({messages:[]});
  }));
  await expect(providers.mail(a.ws,inbox,Date.now()+300).listMessagesSince('cursor')).rejects.toThrow('Provider is temporarily unavailable');
  expect((await connection('mail')).poll_cursor).toBeNull(); expect(c.id).toBeTruthy();
});
it('Scheduled failures without a run create recovery visible to staff and hidden from clients',async()=>{
  const c=await connection('mail');
  await ctx.db.query(`INSERT INTO jobs(workspace_id,kind,payload,dedupe_key,status,attempts,locked_until) VALUES($1,'mail_poll',$2,'scheduled_failure','running',5,now()-interval '1 second')`,[a.ws,JSON.stringify({connectionId:c.id})]);
  expect(await work(store,providers)).toBe(1);
  const recovery=(await ctx.db.query<{id:string;owner_member_id:string}>('SELECT id,owner_member_id FROM recovery_items WHERE job_id IN (SELECT id FROM jobs WHERE dedupe_key=$1)',['scheduled_failure'])).rows[0];
  expect(recovery.owner_member_id).toBe(a.lead);
  expect((await ctx.asMember(a.admin,db=>db.query('SELECT id FROM recovery_items WHERE id=$1',[recovery.id]))).rows).toHaveLength(1);
  expect((await ctx.asMember(a.reviewer,db=>db.query('SELECT id FROM recovery_items WHERE id=$1',[recovery.id]))).rows).toHaveLength(0);
});
