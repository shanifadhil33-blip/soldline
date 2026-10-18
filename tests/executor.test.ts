import { afterAll,beforeAll,beforeEach,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { http,HttpResponse } from 'msw';
import { createDatabase,fixture,id } from './helpers/pglite';
import { server } from './fixtures/http';
import { encryptToken } from '../src/server/crypto';
import { approvalStore } from '../src/server/approvals/store';
import { hash,type Approval,type Payload,type InputRef } from '../src/server/approvals/model';
import { provisionPayload } from '../src/server/executor/provision';
import { effectKey,marker,type Effect } from '../src/server/executor/model';
import { jobStore } from '../src/server/jobs/store';
import { recoveryStore } from '../src/server/recovery/store';
import { verifyChain } from '../src/server/audit';
import type { Member } from '../src/server/permissions';
let database:Awaited<ReturnType<typeof createDatabase>>;
const f=fixture(1);
const admin:Member={id:f.admin,workspace_id:f.ws,display_name:'Adhil',roles:['admin'],client_company_id:null,is_demo:false};
const lead:Member={...admin,id:f.lead,display_name:'Imran',roles:['delivery_lead']};
let approvals:ReturnType<typeof approvalStore>,jobs:ReturnType<typeof jobStore>,recovery:ReturnType<typeof recoveryStore>;
let run:string,refs:InputRef[],approval:Approval;
type ObjectRow={id:string;name:string;date_updated:string;archived?:boolean;parent?:string;markdown_description?:string;assignees?:number[];due_date?:number};
let folders:ObjectRow[],lists:ObjectRow[],tasks:ObjectRow[],calls:string[],sent:{message_id:string;headers?:Record<string,string>}[],sendCount:number,draftCount:number;
let deal:Record<string,string|null>,failAt:number,failRemaining:number,timeoutCreate:boolean,mailTimeout:boolean,hideSent:boolean;
const rows=async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[]) => (await database.db.query<T>(sql,params)).rows;
async function currentEffects() {return rows<Effect>('SELECT * FROM external_effects WHERE run_id=$1 AND parent_effect_id IS NOT NULL',[run]);}
async function item() {return (await rows<{id:string;allowed_options:string[];status:string;plain_reason:string}>("SELECT * FROM recovery_items WHERE run_id=$1 AND kind='execution_failed' ORDER BY created_at DESC LIMIT 1",[run]))[0];}
async function create(payload?:Payload,kind:'provision'|'client_email'='provision') {
  const data=payload??provisionPayload({spaceId:'space',folderName:'Harbor Coffee Roasters',dealId:'0',runRef:run,planUrl:'https://example.test/plan',tasks:Array.from({length:8},(_,i)=>({key:String(i+1),name:'Deliver item '+(i+1),list:'List '+(Math.floor(i/2)+1),assignees:[42],due_date:1792324800000+i*86400000})),missingLineItems:4,ownerMemberId:f.manager});
  const result=await approvals.createApproval({runId:run,kind,payload:data,inputRefs:refs,reversibility:kind==='client_email'?'irreversible':'reversible',requestedByType:'agent',requestedByMemberId:null},admin);
  expect(result.status).toBe(201);approval=result.approval!;
  expect((await approvals.decide(approval.id,lead,'approve')).status).toBe(kind==='client_email'?403:200);
  if(kind==='client_email') {expect((await approvals.decide(approval.id,admin,'approve')).status).toBe(200);expect((await approvals.confirm(approval.id,admin)).status).toBe(200);}
  expect((await approvals.execute(approval.id,admin)).status).toBe(200);
  return approval;
}
async function tick() {
  // Only the first exact effect job is needed. It consumes the complete approved sequence in order.
  const job=await jobs.claim(Date.now());expect(job).toBeTruthy();
  let error:unknown;
  try {await jobs.executeEffect(job!);await jobs.finish(job!,true,Date.now());} catch(e) {error=e;await jobs.finish(job!,false,Date.now());}
  return {job:job!,error};
}
async function retry() {expect((await recovery.act(admin,(await item()).id,'retry_now')).status).toBe(200);return tick();}
async function onlyRun() {return (await rows<{status:string;ready_at:string|null}>('SELECT status,ready_at FROM runs WHERE id=$1',[run]))[0];}
beforeAll(async()=>{
  vi.stubEnv('TOKEN_ENC_KEY',Buffer.alloc(32,9).toString('base64'));
  database=await createDatabase();
  await database.db.query("INSERT INTO connections(workspace_id,provider,status,external_account_id,token_ciphertext) VALUES($1,'clickup','connected','team',$2),($1,'hubspot','connected','portal',$2)",[f.ws,encryptToken('fixture')]);
  await database.db.query("UPDATE connections SET external_account_id='omar@example.test',token_ciphertext=$2 WHERE workspace_id=$1 AND provider='mail'",[f.ws,encryptToken('fixture')]);
  await database.db.query("UPDATE members SET display_name='Ravi',clickup_user_id='42' WHERE id=$1",[f.contributor]);
  approvals=approvalStore(database.db);jobs=jobStore(database.db);recovery=recoveryStore(database.db);
},60000);
afterAll(async()=>{await database?.db.close();vi.unstubAllEnvs();});
beforeEach(async()=>{
  // Previous scenarios stay durable but their jobs must not be selected by this scenario.
  await database.db.query("UPDATE jobs SET status='cancelled' WHERE workspace_id=$1",[f.ws]);
  await database.db.query("UPDATE rate_buckets SET tokens=100,updated_at=now() WHERE workspace_id=$1",[f.ws]);
  await database.db.query("UPDATE demo_faults SET fail_next=0 WHERE workspace_id=$1",[f.ws]);
  run=randomUUID();folders=[];lists=[];tasks=[];calls=[];sent=[];sendCount=0;draftCount=0;failAt=Infinity;failRemaining=0;timeoutCreate=false;mailTimeout=false;hideSent=false;
  deal={hs_lastmodifieddate:'1000',soldline_delivery_status:'Waiting',soldline_plan_url:'',soldline_run_ref:''};
  await database.db.query("INSERT INTO runs(id,workspace_id,deal_id,run_key,status,delivery_lead_id) VALUES($1::uuid,$2,$3,$1::text,'waiting_approval',$4)",[run,f.ws,id(1,20),f.lead]);
  const scope=(await rows<{id:string;version:number;items_hash:string|null;status:string}>('SELECT id,version,items_hash,status FROM scope_versions WHERE id=$1',[id(1,51)]))[0];
  refs=[{system:'scope',record_id:id(1,20),version_marker:'1',hash:hash(scope)}];
  server.use(
    http.get('https://api.clickup.com/api/v2/space/space/folder',()=>HttpResponse.json({folders})),
    http.post('https://api.clickup.com/api/v2/space/space/folder',async({request})=>{calls.push('create folder');const body=await request.json() as {name:string};const row={id:'folder'+folders.length,name:body.name,date_updated:'100'};folders.push(row);return HttpResponse.json(row);}),
    http.get('https://api.clickup.com/api/v2/folder/:folder/list',({params})=>HttpResponse.json({lists:lists.filter(l=>l.parent===params.folder)})),
    http.post('https://api.clickup.com/api/v2/folder/:folder/list',async({request,params})=>{calls.push('create list');const body=await request.json() as {name:string};const row={id:'list'+lists.length,name:body.name,date_updated:'100',parent:String(params.folder)};lists.push(row);return HttpResponse.json(row);}),
    http.get('https://api.clickup.com/api/v2/list/:list/task',({params,request})=>{calls.push('list tasks '+params.list);const page=Number(new URL(request.url).searchParams.get('page'));return HttpResponse.json({tasks:page===0?tasks.filter(t=>t.parent===params.list):[],last_page:true});}),
    http.post('https://api.clickup.com/api/v2/list/:list/task',async({params,request})=>{
      calls.push('create task '+params.list);
      if(tasks.length>=failAt && failRemaining-->0) return new HttpResponse(null,{status:503});
      const body=await request.json() as {name:string;markdown_content:string;assignees:number[];due_date:number};
      const row={id:'task'+tasks.length,name:body.name,date_updated:'100',parent:String(params.list),markdown_description:body.markdown_content,assignees:body.assignees,due_date:body.due_date};tasks.push(row);
      if(timeoutCreate) {timeoutCreate=false;return HttpResponse.error();}
      return HttpResponse.json(row);
    }),
    http.get('https://api.clickup.com/api/v2/task/:task',({params})=>HttpResponse.json({...tasks.find(t=>t.id===params.task),last_editor:{id:42}})),
    http.put('https://api.clickup.com/api/v2/task/:task',({params})=>{const t=tasks.find(t=>t.id===params.task)!;t.archived=true;return HttpResponse.json(t);}),
    http.get('https://api.clickup.com/api/v2/list/:list',({params})=>HttpResponse.json(lists.find(t=>t.id===params.list))),
    http.put('https://api.clickup.com/api/v2/list/:list',({params})=>{const t=lists.find(t=>t.id===params.list)!;t.archived=true;return HttpResponse.json(t);}),
    http.get('https://api.clickup.com/api/v2/folder/:folder',({params})=>HttpResponse.json(folders.find(t=>t.id===params.folder))),
    http.put('https://api.clickup.com/api/v2/folder/:folder',({params})=>{const t=folders.find(t=>t.id===params.folder)!;t.archived=true;return HttpResponse.json(t);}),
    http.get('https://api.hubapi.com/crm/objects/2026-03/deals/0',()=>{calls.push('read deal');return HttpResponse.json({id:'0',properties:deal});}),
    http.patch('https://api.hubapi.com/crm/objects/2026-03/deals/0',async({request})=>{calls.push('patch deal');const body=await request.json() as {properties:Record<string,string>};Object.assign(deal,body.properties);deal.hs_lastmodifieddate='2000';return HttpResponse.json({id:'0',properties:deal});}),
    http.post('https://api.agentmail.to/v0/inboxes/:inbox/drafts',async({request})=>{draftCount++;const body=await request.json() as {headers:Record<string,string>};sent.push({message_id:'sent'+draftCount,headers:body.headers});return HttpResponse.json({draft_id:'draft'+draftCount});}),
    http.post('https://api.agentmail.to/v0/inboxes/:inbox/drafts/:draft/send',()=>{sendCount++;if(mailTimeout) return HttpResponse.error();return HttpResponse.json(sent.at(-1));}),
    http.get('https://api.agentmail.to/v0/inboxes/:inbox/messages',({request})=>{calls.push('search sent');expect(new URL(request.url).searchParams.get('message_id')).toContain('<soldline.');return HttpResponse.json({messages:hideSent?[]:sent});}),
  );
});
it('Happy path creates four lists and eight owned dated tasks then patches the deal and assigns Omar recovery',async()=>{
  await create();expect((await tick()).error).toBeUndefined();expect(folders.map(f=>f.name)).toEqual(['Harbor Coffee Roasters']);expect(lists).toHaveLength(4);expect(tasks).toHaveLength(8);
  for(const [i,t] of tasks.entries()) {expect(t.assignees).toEqual([42]);expect(t.due_date).toBeGreaterThan(0);expect(t.markdown_description?.split('\n').at(-1)).toBe(marker(run,String(i+1)));}
  expect(deal).toMatchObject({soldline_delivery_status:'Ready',soldline_plan_url:'https://example.test/plan',soldline_run_ref:run});expect(calls.indexOf('patch deal')).toBeGreaterThan(calls.lastIndexOf('create task list3'));
  expect(await onlyRun()).toMatchObject({status:'ready',ready_at:expect.any(Date)});
  expect(await rows('SELECT owner_member_id,title FROM recovery_items WHERE run_id=$1 AND kind=\'missing_line_items\'',[run])).toEqual([{owner_member_id:f.manager,title:'Add the 4 missing line items in HubSpot'}]);
  expect((await rows<{status:string}>('SELECT status FROM approvals WHERE id=$1',[approval.id]))[0].status).toBe('executed');
});
it('Outage after five tasks then Retry now ends with exactly eight tasks and no duplicates',async()=>{
  failAt=5;failRemaining=3;await create();expect((await tick()).error).toBeTruthy();expect(tasks).toHaveLength(5);expect(await onlyRun()).toMatchObject({status:'partly_done',ready_at:null});
  expect((await item()).allowed_options).toEqual(['retry_now','resolve_with_note','cancel_remaining','reconcile']);
  expect((await retry()).error).toBeTruthy();expect((await retry()).error).toBeTruthy();expect((await retry()).error).toBeUndefined();expect(tasks).toHaveLength(8);expect(new Set(tasks.map(t=>t.markdown_description)).size).toBe(8);expect((await onlyRun()).status).toBe('ready');
});
it('Unknown task is adopted by its exact marker before any retry create',async()=>{
  timeoutCreate=true;await create();expect((await tick()).error).toBeTruthy();expect(tasks).toHaveLength(1);expect((await currentEffects()).some(e=>e.state==='unknown')).toBe(true);
  expect((await retry()).error).toBeUndefined();expect(tasks).toHaveLength(8);expect((await currentEffects()).filter(e=>e.result?.adopted)).toHaveLength(1);
});
it('Every task create attempt has a completed marker reconciliation first',async()=>{
  failAt=5;failRemaining=1;await create();await tick();await retry();
  for(const [i,call] of calls.entries()) if(call.startsWith('create task ')) expect(calls[i-1]).toBe('list tasks '+call.slice(12));
  const audited=await rows<{action:string;target_id:string}>("SELECT action,target_id FROM audit_log WHERE workspace_id=$1 AND action IN ('task_reconcile_finished','effect_in_flight') ORDER BY id",[f.ws]);
  const taskEffects=(await currentEffects()).filter(e=>e.action==='create_task');
  for(const e of taskEffects) {const actions=audited.filter(a=>a.target_id===e.id).map(a=>a.action);expect(actions.indexOf('task_reconcile_finished')).toBeLessThan(actions.indexOf('effect_in_flight'));}
});
it('Repeated execution and queued sibling jobs create zero new effects or provider objects',async()=>{
  await create();await tick();const count=(await currentEffects()).length;expect((await approvals.execute(approval.id,admin)).status).toBe(200);expect(await jobs.claim(Date.now())).toBeUndefined();expect((await currentEffects()).length).toBe(count);expect(tasks).toHaveLength(8);expect(folders).toHaveLength(1);
});
it('Mail unknown searches by Message ID and never resends when search finds nothing',async()=>{
  mailTimeout=true;hideSent=true;await create({effects:[{system:'mail',action:'send_message',location:'team inbox',records:[],amounts:{},message:{to:['omar@example.test'],subject:'Your plan',body:'Hello Omar'}}]},'client_email');
  await tick();expect(sendCount).toBe(1);expect((await retry()).error).toBeTruthy();expect(calls).toContain('search sent');expect(sendCount).toBe(1);expect(draftCount).toBe(1);expect((await currentEffects())[0].state).toBe('unknown');
});
it('Mail unknown adopts sent mail by Message ID without another send',async()=>{
  mailTimeout=true;await create({effects:[{system:'mail',action:'send_message',location:'team inbox',records:[],amounts:{},message:{to:['omar@example.test'],subject:'Your plan',body:'Hello Omar'}}]},'client_email');await tick();
  expect((await recovery.act(admin,(await item()).id,'reconcile')).status).toBe(200);expect((await tick()).error).toBeUndefined();expect(sendCount).toBe(1);expect((await onlyRun()).status).toBe('ready');
});
it('Undo is a separate reversal approval and refuses a task changed by Ravi',async()=>{
  await create();await tick();tasks[0].date_updated='101';const undo=await recovery.undo(admin,run);expect(undo.status).toBe(201);const reversal=(undo as {approval:Approval}).approval;expect(reversal.kind).toBe('reversal');
  expect((await approvals.decide(reversal.id,admin,'approve')).status).toBe(403);expect((await approvals.decide(reversal.id,lead,'approve')).status).toBe(200);expect((await approvals.execute(reversal.id,lead)).status).toBe(200);
  await database.db.query("UPDATE jobs SET status='cancelled' WHERE run_id=$1 AND payload->>'approvalId'<>$2",[run,reversal.id]);await tick();expect(tasks[0].archived).not.toBe(true);expect((await item()).plain_reason).toBe('Ravi changed this task after it was created. Undo would lose his work.');
});
it('Pause cancels queued jobs and leaves successful effects alone',async()=>{
  failAt=5;failRemaining=1;await create();await tick();const before=(await currentEffects()).filter(e=>e.state==='succeeded').map(e=>e.id);
  const queued=randomUUID();await database.db.query("INSERT INTO jobs(id,workspace_id,run_id,kind,status) VALUES($1,$2,$3,'execute_approval_effect','queued')",[queued,f.ws,run]);
  const pending=await rows<{id:string}>("SELECT id FROM jobs WHERE run_id=$1 AND status IN ('queued','failed')",[run]);expect(pending.length).toBeGreaterThan(1);
  const done=await rows<{id:string}>("SELECT id FROM jobs WHERE run_id=$1 AND status='done'",[run]);
  expect((await recovery.pause(lead,run)).status).toBe(200);
  expect(await rows("SELECT id FROM jobs WHERE id=ANY($1::uuid[]) AND status<>'cancelled'",[pending.map(j=>j.id)])).toHaveLength(0);
  expect(await rows("SELECT id FROM jobs WHERE run_id=$1 AND status='done'",[run])).toEqual(done);expect((await currentEffects()).filter(e=>e.state==='succeeded').map(e=>e.id)).toEqual(before);expect((await recovery.act(admin,(await item()).id,'retry_now')).status).toBe(409);
});
it('Recovery requires ownership and a note and never pretends an unresolved effect succeeded',async()=>{
  failAt=5;failRemaining=1;await create();await tick();const r=await item();const manager={...admin,id:f.manager,roles:['account_manager'] as Member['roles']};expect((await recovery.act(manager,r.id,'retry_now')).status).toBe(403);expect((await recovery.act(admin,r.id,'resolve_with_note')).status).toBe(409);expect((await recovery.act(admin,r.id,'resolve_with_note','Omar will check this work')).status).toBe(200);expect((await onlyRun()).status).toBe('partly_done');
});
it('Cancel remaining cancels pending work without removing created tasks',async()=>{
  failAt=5;failRemaining=1;await create();await tick();expect((await recovery.act(admin,(await item()).id,'cancel_remaining','Omar cancelled the remaining work')).status).toBe(200);expect(tasks).toHaveLength(5);expect((await onlyRun()).status).toBe('cancelled');
});
it('Dead execution uses the P5 bounded attempts and retains all recovery options',async()=>{
  failAt=0;failRemaining=10;await create();const first=await tick();for(let n=1;n<5;n++) {await database.db.query("UPDATE jobs SET next_attempt_at=now() WHERE id=$1",[first.job.id]);await tick();}
  const row=(await rows<{status:string;attempts:number}>('SELECT status,attempts FROM jobs WHERE id=$1',[first.job.id]))[0];expect(row).toEqual({status:'dead',attempts:5});expect((await item()).allowed_options).toHaveLength(4);expect(await rows('SELECT id FROM recovery_items WHERE job_id=$1',[first.job.id])).toHaveLength(1);
});
it('Effect keys hash the run step target and item independently of approval id',()=>{expect(effectKey('r','s','t','i')).toBe(hash(['r','s','t','i']));expect(effectKey('r','s','t','i')).not.toBe(effectKey('r','s','t','j'));});
it('Execution and recovery preserve the audit chain',async()=>{await create();await tick();expect(await verifyChain(database.db,f.ws)).toEqual({ok:true,brokenAtId:null});});
async function queueUndo() {
  const result=await recovery.undo(admin,run);expect(result.status).toBe(201);const a=(result as {approval:Approval}).approval;
  expect((await approvals.decide(a.id,lead,'approve')).status).toBe(200);expect((await approvals.execute(a.id,lead)).status).toBe(200);return a;
}
it('Undo archives untouched tasks lists and folder and restores only the HubSpot before values',async()=>{
  await create();expect((await tick()).error).toBeUndefined();const before=(await currentEffects()).find(e=>e.action==='patch_deal_properties')!;expect(before.result?.before).toEqual({soldline_delivery_status:'Waiting',soldline_plan_url:'',soldline_run_ref:''});
  await queueUndo();expect((await tick()).error).toBeUndefined();expect(tasks.filter(t=>t.archived)).toHaveLength(8);expect(lists.filter(t=>t.archived)).toHaveLength(4);expect(folders[0].archived).toBe(true);expect(deal).toMatchObject({soldline_delivery_status:'Waiting',soldline_plan_url:'',soldline_run_ref:''});
  expect((await currentEffects()).filter(e=>e.state==='compensated')).toHaveLength(14);
});
it('Undo refuses HubSpot fields that no longer equal our after values',async()=>{
  await create();expect((await tick()).error).toBeUndefined();deal.soldline_delivery_status='In delivery';await queueUndo();expect((await tick()).error).toBeTruthy();expect(deal.soldline_delivery_status).toBe('In delivery');
  const original=(await currentEffects()).find(e=>e.action==='patch_deal_properties')!;expect(original.state).toBe('succeeded');
});
it('Marker reconciliation reads every page and refuses duplicate matches',async()=>{
  timeoutCreate=true;await create();await tick();const duplicate={...tasks[0],id:'second'};
  server.use(http.get('https://api.clickup.com/api/v2/list/:list/task',({request,params})=>{
    const page=Number(new URL(request.url).searchParams.get('page'));calls.push('page '+page);
    return HttpResponse.json({tasks:params.list!==tasks[0].parent?[]:page===0?[tasks[0]]:page===1?[duplicate]:[],last_page:page===1});
  }));
  const count=calls.filter(c=>c.startsWith('create task ')).length;expect((await retry()).error).toBeTruthy();expect(calls).toContain('page 1');expect(calls.filter(c=>c.startsWith('create task '))).toHaveLength(count);expect(tasks).toHaveLength(1);
});
it('Persisted folder id is reused after a worker failure',async()=>{
  failAt=0;failRemaining=1;await create();await tick();expect(folders).toHaveLength(1);await retry();expect(folders).toHaveLength(1);expect(lists).toHaveLength(4);expect(tasks).toHaveLength(8);
});
it('Existing demo fault switches are consumed without live requests',async()=>{
  await database.db.query("UPDATE workspaces SET is_demo=true,demo_expires_at=now()+interval '1 day' WHERE id=$1",[f.ws]);
  try {
    await create();await database.db.query("UPDATE demo_faults SET fail_next=3 WHERE workspace_id=$1 AND provider='clickup'",[f.ws]);
    await tick();await retry();await retry();expect((await rows<{fail_next:number}>("SELECT fail_next FROM demo_faults WHERE workspace_id=$1 AND provider='clickup'",[f.ws]))[0].fail_next).toBe(0);
    expect((await retry()).error).toBeUndefined();expect(tasks).toHaveLength(8);
  } finally {await database.db.query('UPDATE workspaces SET is_demo=false WHERE id=$1',[f.ws]);}
});
it('Replaying the won event after provisioning gives zero new effects',async()=>{
  await database.db.query("UPDATE connections SET won_stage_id='won' WHERE workspace_id=$1 AND provider='hubspot'",[f.ws]);
  const connection=(await jobs.hubspotConnections('portal'))[0];const eventId=randomUUID();
  await jobs.ingestHubspot(connection,[{portalId:'portal',eventId,objectId:'0',subscriptionType:'deal.propertyChange',propertyName:'dealstage',propertyValue:'won'}],'webhook');
  const inbound=(await rows<{id:string}>("SELECT id FROM inbound_events WHERE workspace_id=$1 AND dedupe_key=$2",[f.ws,'hubspot:portal:'+eventId]))[0];
  expect(await jobs.handleEvent(f.ws,inbound.id)).toBe(1);
  await database.db.query('UPDATE runs SET trigger_event_id=$2 WHERE id=$1',[run,inbound.id]);
  await database.db.query("UPDATE jobs SET status='done' WHERE workspace_id=$1 AND kind IN ('process_event','analyse_deal')",[f.ws]);
  await create();await tick();const count=(await currentEffects()).length;
  expect(await jobs.replay(admin,run)).toMatchObject({status:200,newActions:0});expect((await currentEffects()).length).toBe(count);expect(tasks).toHaveLength(8);
});
it('App members cannot mutate execution rows or append a system audit',async()=>{
  await create();await tick();const effect=(await currentEffects())[0];
  await expect(database.asMember(f.lead,db=>db.query("UPDATE external_effects SET state='succeeded' WHERE id=$1",[effect.id]))).rejects.toThrow(/permission denied/);
  await expect(database.asMember(f.admin,db=>db.query("SELECT audit_system_append($1,'system','{}')",[f.ws]))).rejects.toThrow(/permission denied/);
});
it('Tampered execution requests fail before provider writes',async()=>{
  await create();await database.db.query("UPDATE external_effects SET request='{}' WHERE approval_id=$1 AND parent_effect_id IS NULL",[approval.id]);expect((await tick()).error).toBeTruthy();expect(tasks).toHaveLength(0);expect(folders).toHaveLength(0);
});
it('Reconcile adopts an unknown ClickUp task without creating remaining tasks',async()=>{
  timeoutCreate=true;await create();await tick();const count=calls.filter(c=>c.startsWith('create task ')).length;
  expect((await recovery.act(admin,(await item()).id,'reconcile')).status).toBe(200);await tick();expect(tasks).toHaveLength(1);expect(calls.filter(c=>c.startsWith('create task '))).toHaveLength(count);
  expect((await retry()).error).toBeUndefined();expect(tasks).toHaveLength(8);
});
it('An expired execution lease cannot write to a provider',async()=>{
  await create();const job=(await jobs.claim(Date.now()))!;await database.db.query("UPDATE jobs SET locked_until=now()-interval '1 minute' WHERE id=$1",[job.id]);await expect(jobs.executeEffect(job)).rejects.toThrow('Execution lease expired');expect(calls).toHaveLength(0);
});
it('Expired fifth execution lease uses P5 dead recovery with all four options',async()=>{
  await create();const first=(await jobs.claim(Date.now()))!;
  await database.db.query("UPDATE jobs SET attempts=5,locked_until=now()-interval '1 minute' WHERE id=$1",[first.id]);
  const job=(await jobs.claim(Date.now()))!;expect(job.exhausted).toBe(true);await jobs.finish(job,false,Date.now());
  const recoveryRow=(await rows<{allowed_options:string[]}>('SELECT allowed_options FROM recovery_items WHERE job_id=$1',[job.id]))[0];expect(recoveryRow.allowed_options).toEqual(['retry_now','resolve_with_note','cancel_remaining','reconcile']);expect(calls).toHaveLength(0);
});
it('First execution failure retains the P5 thirty second backoff',async()=>{
  failAt=0;failRemaining=1;await create();const {job}=await tick();
  const row=(await rows<{next_attempt_at:Date;status:string}>('SELECT next_attempt_at,status FROM jobs WHERE id=$1',[job.id]))[0];expect(row.status).toBe('failed');expect(row.next_attempt_at.getTime()-Date.now()).toBeGreaterThan(28000);expect(row.next_attempt_at.getTime()-Date.now()).toBeLessThanOrEqual(30000);
});
it('Absent HubSpot properties are stored as null before the approved write',async()=>{
  delete deal.soldline_plan_url;delete deal.soldline_run_ref;await create();expect((await tick()).error).toBeUndefined();
  const effect=(await currentEffects()).find(e=>e.action==='patch_deal_properties')!;expect(effect.result?.before).toEqual({soldline_delivery_status:'Waiting',soldline_plan_url:null,soldline_run_ref:null});expect(deal.soldline_delivery_status).toBe('Ready');
});
it('Successful retry closes recovery created by an expired fifth execution lease',async()=>{
  await create();const first=(await jobs.claim(Date.now()))!;await database.db.query("UPDATE jobs SET attempts=5,locked_until=now()-interval '1 minute' WHERE id=$1",[first.id]);const exhausted=(await jobs.claim(Date.now()))!;await jobs.finish(exhausted,false,Date.now());
  const row=(await rows<{id:string}>('SELECT id FROM recovery_items WHERE job_id=$1',[exhausted.id]))[0];expect((await recovery.act(admin,row.id,'retry_now')).status).toBe(200);expect((await tick()).error).toBeUndefined();expect(tasks).toHaveLength(8);expect((await rows<{status:string}>('SELECT status FROM recovery_items WHERE id=$1',[row.id]))[0].status).toBe('resolved');
});

it('Undo uses Someone when the task editor has no matching member',async()=>{
  await create();await tick();tasks[0].date_updated='101';
  server.use(http.get('https://api.clickup.com/api/v2/task/:task',({params})=>HttpResponse.json({...tasks.find(t=>t.id===params.task),last_editor:{id:999}})));
  const undo=await recovery.undo(admin,run);const reversal=(undo as {approval:Approval}).approval;
  expect((await approvals.decide(reversal.id,lead,'approve')).status).toBe(200);
  expect((await approvals.execute(reversal.id,lead)).status).toBe(200);
  await database.db.query("UPDATE jobs SET status='cancelled' WHERE run_id=$1 AND payload->>'approvalId'<>$2",[run,reversal.id]);
  await tick();expect((await item()).plain_reason).toBe('Someone changed this task after it was created. Undo would lose that work.');
});
