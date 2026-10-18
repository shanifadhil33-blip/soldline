import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { readFileSync } from 'node:fs';
import { createDatabase, fixture, id } from './helpers/pglite';
import { server } from './fixtures/http';
import { missingInput, taskFindings, day } from '../src/server/monitors/rules';
import { classifyScopeEmail } from '../src/server/monitors/classifier';
import { monitorStore } from '../src/server/monitors/store';
import { jobStore } from '../src/server/jobs/store';
import { perform } from '../src/server/jobs/worker';
import { systemProviders } from '../src/server/jobs/providers';
import { encryptToken } from '../src/server/crypto';
import { verifyChain } from '../src/server/audit';
let ctx:Awaited<ReturnType<typeof createDatabase>>;
const f=fixture(1),now=Date.parse('2026-10-22T08:00:00Z');
beforeAll(async()=>{ctx=await createDatabase();},60000);
afterAll(async()=>{vi.unstubAllEnvs();await ctx?.db.close();});
const ago=(days:number)=>new Date(now-days*day).toISOString();
it.each([3-1/day,3,3+1/day])('Missing input three day boundary %s',age=>{expect(missingInput('logo',ago(age),false,now)?.severity??null).toBe(age>3?'warn':null);});
it.each([7-1/day,7,7+1/day])('Blocking input seven day boundary %s',age=>{expect(missingInput('logo',ago(age),true,now)?.severity).toBe(age>7?'block':'warn');});
it('Non blocking input remains a warning after seven days',()=>{expect(missingInput('logo',ago(8),false,now)?.severity).toBe('warn');expect(missingInput('logo',null,true,now)).toBeNull();});
it.each([-1000,0,1000])('Client review three working day boundary %s',delta=>{
  const start='2026-10-18T08:00:00Z';
  expect(taskFindings({id:'a',status:'Client review',reviewSince:start,due:null},Date.parse(start)+3*day+delta,'Asia/Dubai').length).toBe(delta>0?1:0);
});
it('Client review skips Friday and Saturday and supports another working week',()=>{
  const start='2026-10-22T08:00:00Z',end=Date.parse('2026-10-25T08:00:01Z');
  expect(taskFindings({id:'a',status:'Client review',reviewSince:start,due:null},end,'Asia/Dubai')).toHaveLength(0);
  expect(taskFindings({id:'a',status:'Client review',reviewSince:start,due:null},end,'Asia/Dubai',[0,1,2,3,4,5,6])).toHaveLength(1);
});
it.each([-1000,0,1000])('Deadline two day boundary %s',delta=>{expect(taskFindings({id:'a',status:'Open',reviewSince:null,due:new Date(now+2*day+delta).toISOString()},now,'Asia/Dubai').length).toBe(delta<=0?1:0);});
it('Started and closed tasks do not create deadline risk',()=>{for(const task of [{status:'In progress'},{status:'Open',closed:true}]) expect(taskFindings({id:'a',reviewSince:null,due:ago(-1),...task},now,'Asia/Dubai')).toHaveLength(0);});
it.each(['Please add 3 videos','Change the campaign to 12 posts','أضف فيديو جديد','نحتاج إلى زيادة عدد المنشورات'])('Rules quote a scope request %s',async text=>{expect(await classifyScopeEmail(text,{})).toEqual({quote:text,method:'rules'});});
it.each(['Thanks for the update','How is the new office?','شكرا لك'])('Casual mail does not request scope %s',async text=>{expect(await classifyScopeEmail(text,{})).toBeNull();});
it('Rules run before AI and invented AI quotes are rejected',async()=>{
  const provider=vi.fn().mockResolvedValue({requested:true,quote:'Invented quote'});
  await classifyScopeEmail('Please add a video',{fixture:provider});expect(provider).not.toHaveBeenCalled();
  expect(await classifyScopeEmail('Could we include photography?',{fixture:provider})).toBeNull();
});
it('AI fallback uses a quoted MSW response',async()=>{
  server.use(http.post('https://ai.example.test/classify',()=>HttpResponse.json({requested:true,quote:'Could we include photography?'})));
  const result=await classifyScopeEmail('Could we include photography?',{fixture:async(_request,signal)=>(await fetch('https://ai.example.test/classify',{method:'POST',signal})).json()});
  expect(result).toEqual({method:'ai',quote:'Could we include photography?'});
});
it('Scan dedupes findings and P8 recovery while escalating the same missing input',async()=>{
  await ctx.db.query('UPDATE onboarding_inputs SET requested_at=$2,blocking=true WHERE workspace_id=$1 AND run_id=$3',[f.ws,ago(3+1/day),f.runA]);
  await ctx.db.query('UPDATE runs SET delivery_lead_id=$2 WHERE id=$1',[f.runA,f.lead]);
  const store=monitorStore(ctx.db);await store.scan(f.ws,now);await store.scan(f.ws,now);
  const query=()=>ctx.db.query<{id:string;severity:string;owner_member_id:string}>("SELECT * FROM findings WHERE run_id=$1 AND monitor_key LIKE 'input:%'",[f.runA]);
  const original=(await query()).rows;expect(original).toHaveLength(1);expect(original[0].severity).toBe('warn');expect(original[0].owner_member_id).toBe(f.manager);
  await store.scan(f.ws,now+5*day);const changed=(await query()).rows;expect(changed[0].id).toBe(original[0].id);expect(changed[0].severity).toBe('block');
  expect((await ctx.db.query('SELECT * FROM recovery_items WHERE finding_id=$1',[changed[0].id])).rows).toHaveLength(1);
  expect((await ctx.db.query("SELECT * FROM notifications WHERE dedupe_key=$1",['finding:'+changed[0].id+':block'])).rows).toHaveLength(1);
  expect((await verifyChain(ctx.db,f.ws)).ok).toBe(true);
});
it('No owner requires an accepted scope and an assigned linked task',async()=>{
  await ctx.db.query("UPDATE scope_versions SET status='accepted' WHERE id=$1",[id(1,51)]);
  await ctx.db.query('UPDATE runs SET scope_version_id=$2 WHERE id=$1',[f.runA,id(1,51)]);
  await monitorStore(ctx.db).scan(f.ws,now);
  const row=(await ctx.db.query<{owner_member_id:string}>("SELECT * FROM findings WHERE run_id=$1 AND kind='no_owner'",[f.runA])).rows;
  expect(row).toHaveLength(1);expect(row[0].owner_member_id).toBe(f.lead);
  await ctx.db.query(`INSERT INTO monitor_tasks(workspace_id,run_id,task_id,status,scope_item_id,assignee_ids,observed_at) SELECT $1,$2,'owned','Open',id,ARRAY['42'],$3 FROM scope_items WHERE scope_version_id=$4`,[f.ws,f.runA,new Date(now).toISOString(),id(1,51)]);
  // A new run with the same accepted scope has its own commitment ownership.
  await ctx.db.query('UPDATE runs SET scope_version_id=$2 WHERE id=$1',[f.runB,id(1,51)]);
  await monitorStore(ctx.db).scan(f.ws,now);
  expect((await ctx.db.query("SELECT * FROM findings WHERE run_id=$1 AND kind='no_owner'",[f.runB])).rows).toHaveLength(1);
});
it('Casual and scope request mail never change scope versions or scope items',async()=>{
  const before=(await ctx.db.query('SELECT * FROM scope_versions ORDER BY id')).rows,items=(await ctx.db.query('SELECT * FROM scope_items ORDER BY id')).rows;
  const connection=(await jobStore(ctx.db).connection(f.ws,(await ctx.db.query<{id:string}>("SELECT id FROM connections WHERE workspace_id=$1 AND provider='mail'",[f.ws])).rows[0].id))!;
  await ctx.db.query("UPDATE runs SET mail_thread_ids=ARRAY['client'] WHERE id=$1",[f.runA]);
  await jobStore(ctx.db).saveMail(connection,[{message_id:'casual',thread_id:'client',text:'Thanks for the new update'},{message_id:'change',thread_id:'client',text:'Please add 3 videos'}],'fixture');
  await monitorStore(ctx.db).scan(f.ws,now);await monitorStore(ctx.db).scan(f.ws,now);
  expect((await ctx.db.query("SELECT * FROM findings WHERE workspace_id=$1 AND kind='scope_change_request'",[f.ws])).rows).toHaveLength(1);
  expect((await ctx.db.query('SELECT * FROM scope_versions ORDER BY id')).rows).toEqual(before);expect((await ctx.db.query('SELECT * FROM scope_items ORDER BY id')).rows).toEqual(items);
});
it('Client reminder is an irreversible approval without sending mail',async()=>{
  const member={id:f.manager,workspace_id:f.ws,display_name:'Omar',roles:['account_manager'] as const,client_company_id:null,is_demo:false};
  const finding=(await ctx.db.query<{id:string}>("SELECT id FROM findings WHERE run_id=$1 AND monitor_key LIKE 'input:%'",[f.runA])).rows[0];
  const result=await monitorStore(ctx.db).draftReminder({...member,roles:[...member.roles]},finding.id,['bilal@example.test'],'Please share the logo');
  expect(result.status).toBe(201);expect(result.approval?.kind).toBe('client_email');expect(result.approval?.reversibility).toBe('irreversible');expect(result.approval?.status).toBe('pending');
});
it('Tick queues deduped monitor jobs and dispatches the existing worker',async()=>{
  const jobs=jobStore(ctx.db);await jobs.schedule(now);await jobs.schedule(now);
  expect((await ctx.db.query("SELECT * FROM jobs WHERE workspace_id=$1 AND kind='monitor_workspace'",[f.ws])).rows).toHaveLength(1);
  const monitor=vi.spyOn(jobs,'monitor').mockResolvedValue();
  await perform(jobs,systemProviders(ctx.db),{id:id(1,999),workspace_id:f.ws,kind:'monitor_workspace',run_id:null,attempts:1,lock_token:'fixture',payload:{}},()=>now);
  expect(monitor).toHaveBeenCalledOnce();
});
it('P9 source cannot write scope versions and reminders use createApproval',()=>{
  for(const path of ['src/server/monitors/store.ts','src/server/monitors/classifier.ts','src/server/memory/store.ts']) expect(readFileSync(path,'utf8')).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) scope_versions/);
  expect(readFileSync('src/server/monitors/store.ts','utf8')).toContain('.createApproval(');
});
it('Task observations use ClickUp MSW reads and keep the original review entry time',async()=>{
  vi.stubEnv('TOKEN_ENC_KEY',Buffer.alloc(32,5).toString('base64'));
  await ctx.db.query("INSERT INTO connections(workspace_id,provider,status,token_ciphertext) VALUES($1,'clickup','connected',$2)",[f.ws,encryptToken('fixture')]);
  await ctx.db.query("UPDATE external_effects SET parent_effect_id=id,action='create_task',state='succeeded',external_id='task_fixture',request=$2 WHERE id=$1",[id(1,71),JSON.stringify({records:[{id:'1'}]})]);
  await ctx.db.query("UPDATE scope_items SET key='1' WHERE scope_version_id=$1",[id(1,51)]);
  let status='Client review';
  server.use(http.get('https://api.clickup.com/api/v2/task/task_fixture',()=>HttpResponse.json({id:'task_fixture',status:{status,type:'open'},assignees:[{id:42}],due_date:String(now+day)})));
  const store=monitorStore(ctx.db);await store.refreshTasks(f.ws,f.runA,now);await store.refreshTasks(f.ws,f.runA,now+day);
  const read=async()=>(await ctx.db.query<{review_since:string;assignee_ids:string[];scope_item_id:string}>("SELECT * FROM monitor_tasks WHERE task_id='task_fixture'")).rows[0];
  expect(new Date((await read()).review_since).getTime()).toBe(now);expect((await read()).assignee_ids).toEqual(['42']);expect((await read()).scope_item_id).toBeTruthy();
  status='In progress';await store.refreshTasks(f.ws,f.runA,now+2*day);expect((await read()).review_since).toBeNull();
});
it('Member mapping is workspace scoped and uses the real display name',async()=>{
  await ctx.db.query("UPDATE members SET clickup_user_id='42',display_name='Bilal' WHERE id=$1",[f.contributor]);
  expect(await monitorStore(ctx.db).memberName(f.ws,'42')).toBe('Bilal');expect(await monitorStore(ctx.db).memberName(fixture(2).ws,'42')).toBeNull();
});
it('Cleared monitor conditions resolve their findings and recovery records',async()=>{
  await ctx.db.query("UPDATE onboarding_inputs SET status='received' WHERE run_id=$1",[f.runA]);
  await monitorStore(ctx.db).scan(f.ws,now);
  const findings=(await ctx.db.query<{id:string;status:string}>("SELECT id,status FROM findings WHERE run_id=$1 AND monitor_key LIKE 'input:%'",[f.runA])).rows;
  expect(findings[0].status).toBe('resolved');
  expect((await ctx.db.query<{status:string}>('SELECT status FROM recovery_items WHERE finding_id=$1',[findings[0].id])).rows[0].status).toBe('resolved');
});
