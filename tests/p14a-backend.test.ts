import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { http, HttpResponse } from 'msw';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
import { SampleInboxProvider, sampleMailStatus } from '../src/server/integrations/sample-inbox';
import { server } from './fixtures/http';
import { encryptToken } from '../src/server/crypto';
import { verifyChain } from '../src/server/audit';
import type { Member } from '../src/server/permissions';
import type { Job } from '../src/server/jobs/store';
import { ClickUpClient } from '../src/server/integrations/clickup';
import { WorkerConnections } from '../src/server/jobs/providers';
let db:PGlite,runtime:ReturnType<typeof fixtureRuntime>,ws:string,run:string,omar:Member,imran:Member,karim:Member;
const rows=async<T extends Record<string,unknown>>(sql:string,params:unknown[]=[]) => (await db.query<T>(sql,params)).rows;
beforeAll(async()=>{db=new PGlite();await migrate(db);runtime=fixtureRuntime(db);},60000);
afterAll(async()=>{await db.close();vi.unstubAllEnvs();});
beforeEach(async()=>{
  vi.stubEnv('MAIL_PROVIDER','sample');vi.stubEnv('AI_PROVIDERS','');vi.stubEnv('TOKEN_ENC_KEY',Buffer.alloc(32,7).toString('base64'));
  const ticket=await runtime.owner.demo.start('omar',null);ws=ticket.sandbox;
  omar=(await runtime.owner.demo.member(ticket))!;
  imran=(await runtime.owner.demo.member({...ticket,persona:'imran'}))!;
  karim=(await runtime.owner.demo.member({...ticket,persona:'karim'}))!;
  run=(await rows<{id:string}>("SELECT r.id FROM runs r JOIN deals d ON d.workspace_id=r.workspace_id AND d.id=r.deal_id WHERE r.workspace_id=$1 AND d.name LIKE 'Harbor%'",[ws]))[0].id;
});
it('Default sample inbox seeds three messages, never fetches, stores labelled drafts and audits simulated sending',async()=>{
  delete process.env.MAIL_PROVIDER;
  const spy=vi.spyOn(globalThis,'fetch');
  try{
    const provider=runtime.owner.providers.mail(ws,'ignored');
    const page=await provider.listMessagesSince(new Date(0).toISOString());expect(page.messages).toHaveLength(3);
    expect(page.messages.some(m=>m.text?.includes('6 TikTok videos'))).toBe(true);
    expect(page.messages.some(m=>m.text?.includes('Karim here'))).toBe(true);expect(page.messages.some(m=>m.text?.includes('Laith here'))).toBe(true);
    const mail=new SampleInboxProvider(db,ws,run);
    const draft=await mail.createDraft({to:['karim@harbor.example'],subject:'Sample reply',text:'Hello Karim',messageId:'exact'});
    expect(draft.status).toBe(sampleMailStatus);expect((await mail.sendDraft(draft.draft_id)).status).toBe(sampleMailStatus);
    expect((await mail.searchSent({to:'karim@harbor.example',subject:'Sample reply',since:new Date(0).toISOString(),messageId:'exact'})).messages).toHaveLength(1);
    expect((await mail.getThread(page.messages[0].thread_id!)).messages.length).toBeGreaterThan(0);
    expect(spy).not.toHaveBeenCalled();
    expect(await rows("SELECT id FROM audit_log WHERE workspace_id=$1 AND action='sample_mail_not_sent'",[ws])).toHaveLength(1);
    expect((await verifyChain(db,ws)).ok).toBe(true);
  }finally{spy.mockRestore();}
});
it('Sample email control creates scope request and unusual instruction findings without changing accepted scope',async()=>{
  expect((await runtime.owner.demoControls.run(omar,run,'sample_email')).status).toBe(200);
  expect(await rows("SELECT kind FROM findings WHERE workspace_id=$1 AND kind IN ('scope_change_request','unusual_instruction')",[ws])).toHaveLength(2);
  expect(await rows('SELECT version,status FROM scope_versions WHERE workspace_id=$1',[ws])).toEqual([{version:1,status:'accepted'}]);
  expect(await rows("SELECT id FROM audit_log WHERE workspace_id=$1 AND action='demo_sample_email'",[ws])).toHaveLength(1);
});
it('An exact approved sample email executes through the real queue without a mail credential or fetch',async()=>{
  const a=(await rows<{id:string}>("SELECT id FROM approvals WHERE workspace_id=$1 AND kind='client_email'",[ws]))[0];
  expect((await runtime.owner.approvals.decide(a.id,omar,'approve')).status).toBe(200);
  expect((await runtime.owner.approvals.confirm(a.id,omar)).status).toBe(200);
  expect((await runtime.owner.approvals.execute(a.id,omar)).status).toBe(200);
  const job=(await runtime.owner.jobs.claim(Date.now()))!;
  expect(job.kind).toBe('execute_approval_effect');await runtime.owner.jobs.executeEffect(job);
  expect(await rows("SELECT status FROM sample_mail WHERE workspace_id=$1 AND direction='outbound'",[ws])).toEqual([{status:sampleMailStatus}]);
});
it('Mark won injects a labelled webhook equivalent and replay creates zero new actions',async()=>{
  expect(await runtime.owner.demoControls.run(omar,run,'mark_won')).toMatchObject({status:200,message:'Simulated HubSpot event received'});
  expect(await runtime.owner.demoControls.run(omar,run,'replay')).toMatchObject({status:200,newActions:0});
  expect(await rows("SELECT id FROM jobs WHERE workspace_id=$1 AND kind='analyse_deal'",[ws])).toHaveLength(1);
  expect((await rows<{raw:{simulated:boolean}}>("SELECT raw FROM inbound_events WHERE workspace_id=$1 AND source='hubspot'",[ws]))[0].raw.simulated).toBe(true);
});
it('Changing a line item writes it and makes open approval envelopes stale',async()=>{
  const before=await rows('SELECT id,quantity FROM line_items WHERE workspace_id=$1 ORDER BY id',[ws]);
  expect((await runtime.owner.demoControls.run(omar,run,'change_line_item')).status).toBe(200);
  expect(await rows('SELECT id,quantity FROM line_items WHERE workspace_id=$1 ORDER BY id',[ws])).not.toEqual(before);
  expect((await rows<{status:string}>('SELECT status FROM approvals WHERE workspace_id=$1',[ws])).every(a=>a.status==='stale')).toBe(true);
});
it('Outage consumes the next N creates only, then permits creation; revoke is labelled and denies sample access',async()=>{
  await db.query(`INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id) VALUES($1,'clickup','connected',$2,'test')`,[ws,encryptToken('fixture')]);
  expect((await runtime.owner.demoControls.run(imran,run,'clickup_outage',2)).status).toBe(200);
  let creates=0;server.use(http.get('https://api.clickup.com/api/v2/space/test/folder',()=>HttpResponse.json({folders:[]})),http.post('https://api.clickup.com/api/v2/list/test/task',()=>{creates++;return HttpResponse.json({id:'created'});}));
  const client=new ClickUpClient({connections:new WorkerConnections(db,ws)});
  await client.listFolders('test');
  for(let i=0;i<2;i++)await expect(client.createTask('test',{name:'Sample task'})).rejects.toThrow();
  expect(creates).toBe(0);await client.createTask('test',{name:'Sample task'});expect(creates).toBe(1);
  expect((await runtime.owner.demoControls.run(omar,run,'revoke_inbox')).message).toBe('Simulated inbox key revoked');
  await expect(new SampleInboxProvider(db,ws).getInbox()).rejects.toThrow();
  expect(await rows("SELECT id FROM recovery_items WHERE workspace_id=$1 AND plain_reason='Simulated inbox key revoked'",[ws])).toHaveLength(1);
});
it('Demo controls refuse a client reviewer, a foreign sandbox and expired identity',async()=>{
  expect((await runtime.owner.demoControls.run(karim,run,'mark_won')).status).toBe(403);
  const other=await runtime.owner.demo.start('omar',null);
  expect((await runtime.owner.demoControls.run({...omar,workspace_id:other.sandbox},run,'mark_won')).status).toBe(403);
  await db.query('UPDATE workspaces SET demo_expires_at=now() WHERE id=$1',[ws]);
  expect((await runtime.owner.demoControls.run(omar,run,'mark_won')).status).toBe(403);
});
it('Start, review and client approval write the four ClickUp statuses and monitors read complete as closed',async()=>{
  await db.query(`INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id) VALUES($1,'clickup','connected',$2,'test')`,[ws,encryptToken('fixture')]);
  await db.query("UPDATE monitor_tasks SET task_id='remote',status='to do' WHERE workspace_id=$1 AND task_id='sample_task_brand'",[ws]);
  const statuses:string[]=[];server.use(http.put('https://api.clickup.com/api/v2/task/remote',async({request})=>{const body=await request.json() as {status:string};statuses.push(body.status);return HttpResponse.json({id:'remote',status:{status:body.status}});}));
  for(const state of ['started','review'] as const){
    expect((await runtime.owner.trust.transitionDeliverable(imran,'remote',state)).status).toBe(200);
    const job=(await rows<Job & Record<string,unknown>>("SELECT * FROM jobs WHERE workspace_id=$1 AND kind='task_status' ORDER BY next_attempt_at DESC LIMIT 1",[ws]))[0];await runtime.owner.jobs.taskStatus(job,Date.now()+25000);
  }
  expect((await runtime.owner.trust.approveDeliverable(karim,'remote')).status).toBe(200);
  const job=(await rows<Job & Record<string,unknown>>("SELECT * FROM jobs WHERE workspace_id=$1 AND payload->>'status'='complete'",[ws]))[0];await runtime.owner.jobs.taskStatus(job,Date.now()+25000);
  expect(statuses).toEqual(['in progress','client review','complete']);
  expect(await rows("SELECT status,closed FROM monitor_tasks WHERE workspace_id=$1 AND task_id='remote'",[ws])).toEqual([{status:'complete',closed:true}]);
});
it('Cleanup schedules expired sandboxes on daily, records partial progress and retries only unfinished resources',async()=>{
  for(const provider of ['clickup','hubspot'])await db.query(`INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id) VALUES($1,$2,'connected',$3,'test')`,[ws,provider,encryptToken('fixture')]);
  await db.query("INSERT INTO demo_resources(workspace_id,provider,external_id) VALUES($1,'clickup','our_folder')",[ws]);
  await db.query(`INSERT INTO demo_resources(workspace_id,provider,external_id,seed_state) VALUES($1,'hubspot','our_deal','{"dealstage":"open"}')`,[ws]);
  await db.query("UPDATE workspaces SET created_at=now()-interval '7 hours' WHERE id=$1",[ws]);
  let folderCalls=0,dealCalls=0,fail=true;const patches:unknown[]=[];
  server.use(http.delete('https://api.clickup.com/api/v2/folder/our_folder',()=>{folderCalls++;return new HttpResponse(null,{status:204});}),http.patch('https://api.hubapi.com/crm/objects/2026-03/deals/our_deal',async({request})=>{dealCalls++;patches.push(await request.json());return fail?new HttpResponse(null,{status:503}):HttpResponse.json({id:'our_deal',properties:{}});}));
  await runtime.owner.jobs.schedule(Date.now(),true);
  const job=(await rows<Job & Record<string,unknown>>("SELECT * FROM jobs WHERE workspace_id=$1 AND kind='demo_cleanup'",[ws]))[0];expect(job).toBeTruthy();
  await expect(runtime.owner.jobs.cleanup(job,Date.now()+25000)).rejects.toThrow();
  expect(await rows('SELECT id FROM workspaces WHERE id=$1',[ws])).toHaveLength(1);
  expect(await rows("SELECT id FROM recovery_items WHERE workspace_id=$1 AND kind='demo_cleanup'",[ws])).toHaveLength(1);
  fail=false;await runtime.owner.jobs.cleanup(job,Date.now()+25000);
  expect(folderCalls).toBe(1);expect(dealCalls).toBe(2);
  expect(patches[1]).toEqual({properties:{dealstage:'open',soldline_delivery_status:'Not started',soldline_plan_url:'',soldline_run_ref:''}});
  expect(await rows('SELECT id FROM workspaces WHERE id=$1',[ws])).toHaveLength(0);
  await runtime.owner.jobs.cleanup(job,Date.now()+25000);expect(dealCalls).toBe(2);
});
it('Cleanup never trusts payload ids, never touches unexpired sandboxes and caps daily scheduling',async()=>{
  const spy=vi.spyOn(globalThis,'fetch');
  try{
    await runtime.owner.jobs.cleanup({id:'ignored',kind:'demo_cleanup',workspace_id:ws,run_id:null,attempts:1,lock_token:'ignored',payload:{clickup_folder_id:'base_folder'}},Date.now()+25000);
    expect(await rows('SELECT id FROM workspaces WHERE id=$1',[ws])).toHaveLength(1);
    await db.query('UPDATE workspaces SET demo_expires_at=now() WHERE is_demo');
    const before=(await rows("SELECT id FROM jobs WHERE kind='demo_cleanup'")).length;
    await runtime.owner.jobs.schedule(Date.now(),true);
    expect((await rows("SELECT id FROM jobs WHERE kind='demo_cleanup'")).length-before).toBeLessThanOrEqual(5);
    expect(spy).not.toHaveBeenCalled();
  }finally{spy.mockRestore();}
});
it('Configured HubSpot creates a separate sample deal, records its seed and never patches the base deal',async()=>{
  await db.query(`INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id,won_stage_id) VALUES($1,'hubspot','connected',$2,'test','closedwon')`,[ws,encryptToken('fixture')]);
  let creates=0;const patches:unknown[]=[];
  server.use(http.post('https://api.hubapi.com/crm/objects/2026-03/deals',()=>{creates++;return HttpResponse.json({id:'separate',properties:{dealstage:'appointmentscheduled'}});}),http.get('https://api.hubapi.com/crm/objects/2026-03/deals/separate',()=>HttpResponse.json({id:'separate',properties:{dealstage:'appointmentscheduled'}})),http.patch('https://api.hubapi.com/crm/objects/2026-03/deals/separate',async({request})=>{patches.push(await request.json());return HttpResponse.json({id:'separate',properties:{dealstage:'closedwon'}});}));
  expect((await runtime.owner.demoControls.run(omar,run,'mark_won')).status).toBe(200);
  expect((await runtime.owner.demoControls.run(omar,run,'mark_won')).status).toBe(200);
  expect(creates).toBe(1);expect(patches).toEqual([{properties:{dealstage:'closedwon'}},{properties:{dealstage:'closedwon'}}]);
  expect(await rows("SELECT external_id,seed_state FROM demo_resources WHERE workspace_id=$1 AND provider='hubspot'",[ws])).toEqual([{external_id:'separate',seed_state:{dealstage:'appointmentscheduled'}}]);
});
it('A task create outage becomes a recovery item through the normal executor',async()=>{
  await db.query(`INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id) VALUES($1,'clickup','connected',$2,'test')`,[ws,encryptToken('fixture')]);
  const original=(await rows<{input_refs:import('../src/server/approvals/model').InputRef[]}>("SELECT input_refs FROM approvals WHERE workspace_id=$1 AND kind='client_email'",[ws]))[0];
  const approval=await runtime.owner.approvals.createApproval({runId:run,kind:'provision',requestedByType:'agent',requestedByMemberId:null,reversibility:'reversible',inputRefs:original.input_refs,payload:{effects:[{system:'clickup',location:'test',action:'create_task',records:[{id:'sample_task',fields:{name:{before:null,after:'Sample task'},assignees:{before:null,after:[42]},due_date:{before:null,after:Date.now()+86400000}}}],amounts:{}}]}},omar);
  expect(approval.status).toBe(201);const a=approval.approval!;
  expect((await runtime.owner.approvals.decide(a.id,imran,'approve')).status).toBe(200);
  expect((await runtime.owner.approvals.execute(a.id,imran)).status).toBe(200);
  await runtime.owner.demoControls.run(imran,run,'clickup_outage',2);
  server.use(http.get('https://api.clickup.com/api/v2/list/test/task',()=>HttpResponse.json({tasks:[],last_page:true})));
  const job=(await rows<Job & Record<string,unknown>>("UPDATE jobs SET status='running',lock_token=gen_random_uuid(),locked_until=now()+interval '2 minutes' WHERE workspace_id=$1 AND kind='execute_approval_effect' RETURNING *",[ws]))[0];
  await expect(runtime.owner.jobs.executeEffect(job)).rejects.toThrow();
  expect(await rows("SELECT id FROM recovery_items WHERE workspace_id=$1 AND kind='execution_failed'",[ws])).toHaveLength(1);
});
it('App write grants enforce workspace and run checks and cannot forge cleanup resources',async()=>{
  await runtime.app.transaction(async c=>{
    await c.query("SELECT set_config('app.member_id',$1,true)",[omar.id]);
    expect((await c.query(`INSERT INTO sample_mail(workspace_id,run_id,direction,message_id,thread_id,raw) VALUES($1,$2,'outbound','allowed','allowed','{}') RETURNING id`,[ws,run])).rows).toHaveLength(1);
  });
  await expect(runtime.app.transaction(async c=>{
    await c.query("SELECT set_config('app.member_id',$1,true)",[omar.id]);
    await c.query("INSERT INTO demo_resources(workspace_id,provider,external_id) VALUES($1,'clickup','seeded_base_folder')",[ws]);
  })).rejects.toThrow(/row.level security/);
  const foreign=await runtime.owner.demo.start('omar',null);
  await expect(runtime.app.transaction(async c=>{
    await c.query("SELECT set_config('app.member_id',$1,true)",[omar.id]);
    await c.query("UPDATE sample_mail SET workspace_id=$2 WHERE workspace_id=$1 AND message_id='allowed'",[ws,foreign.sandbox]);
  })).rejects.toThrow(/row.level security/);
  await runtime.app.transaction(async c=>{
    await c.query("SELECT set_config('app.member_id',$1,true)",[karim.id]);
    expect((await c.query('SELECT id FROM sample_mail WHERE workspace_id=$1',[ws])).rows).toHaveLength(0);
  });
});
it('Replay before a sample event honestly returns zero actions and records the absence',async()=>{
  expect(await runtime.owner.demoControls.run(omar,run,'replay')).toMatchObject({status:200,newActions:0,message:'No stored HubSpot event in this sample yet'});
  expect(await rows("SELECT id FROM audit_log WHERE workspace_id=$1 AND action='demo_replay'",[ws])).toHaveLength(1);
});
it('Cleanup refuses real workspaces even with expired demo dates and recorded ids',async()=>{
  const real=(await rows<{id:string}>('SELECT gen_random_uuid()::text AS id'))[0].id;
  await db.query("INSERT INTO workspaces(id,workspace_id,name,is_demo,demo_expires_at,created_at) VALUES($1,$1,'Base fixture',false,now()-interval '1 day',now()-interval '1 day')",[real]);
  await db.query("INSERT INTO demo_resources(workspace_id,provider,external_id) VALUES($1,'clickup','base_folder')",[real]);
  const spy=vi.spyOn(globalThis,'fetch');
  try{
    await runtime.owner.jobs.cleanup({id:'ignored',kind:'demo_cleanup',workspace_id:real,run_id:null,attempts:1,lock_token:'ignored',payload:{}},Date.now()+25000);
    expect(spy).not.toHaveBeenCalled();expect(await rows('SELECT id FROM workspaces WHERE id=$1',[real])).toHaveLength(1);
  }finally{spy.mockRestore();}
});
it('Configured line item control patches only an item exclusively associated with its sandbox deal',async()=>{
  await db.query(`INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id) VALUES($1,'hubspot','connected',$2,'test')`,[ws,encryptToken('fixture')]);
  await db.query(`UPDATE deals SET hubspot_deal_id='our_deal',snapshot=jsonb_build_object('demo_sandbox',$1::text) WHERE workspace_id=$1 AND id=(SELECT deal_id FROM runs WHERE id=$2)`,[ws,run]);
  await db.query("UPDATE line_items SET hubspot_line_item_id='our_line' WHERE workspace_id=$1",[ws]);
  let deal='our_deal';const patches:unknown[]=[];
  server.use(http.get('https://api.hubapi.com/crm/objects/2026-03/line_items/our_line',()=>HttpResponse.json({id:'our_line',properties:{quantity:'4'},associations:{deals:{results:[{id:deal}]}}})),http.patch('https://api.hubapi.com/crm/objects/2026-03/line_items/our_line',async({request})=>{patches.push(await request.json());return HttpResponse.json({id:'our_line',properties:{quantity:'5'}});}));
  expect((await runtime.owner.demoControls.run(omar,run,'change_line_item')).message).toBe('Sandbox line item changed');
  expect(patches).toEqual([{properties:{quantity:'5'}}]);
  deal='355638664953';await expect(runtime.owner.demoControls.run(omar,run,'change_line_item')).rejects.toThrow('Sandbox line item refused');expect(patches).toHaveLength(1);
});
