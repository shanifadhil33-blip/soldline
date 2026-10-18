import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { randomUUID } from 'node:crypto';
import { createDatabase, fixture, id } from './helpers/pglite';
import { fixtureRuntime } from './helpers/runtime';
import { server } from './fixtures/http';
import { encryptToken } from '../src/server/crypto';
import { approvalStore } from '../src/server/approvals/store';
import { canonical, hash, requiredRoles, sortedRefs, type Approval, type CreateApproval, type InputRef, type Kind, type Payload } from '../src/server/approvals/model';
import { liveRead } from '../src/server/approvals/live';
import { jobStore } from '../src/server/jobs/store';
import { verifyChain } from '../src/server/audit';
import type { Member, Role } from '../src/server/permissions';
const mocks=vi.hoisted(()=>({member:vi.fn(),owner:vi.fn(),app:vi.fn()}));
vi.mock('../src/server/session',()=>({getMember:mocks.member}));
vi.mock('../src/server/db/runtime',()=>({getOwnerServices:mocks.owner,getAppDriver:mocks.app}));
import { POST as decideRoute } from '../src/app/api/approvals/[id]/decide/route';
import { POST as confirmRoute } from '../src/app/api/approvals/[id]/confirm/route';
import { POST as executeRoute } from '../src/app/api/approvals/[id]/execute/route';
let database:Awaited<ReturnType<typeof createDatabase>>;
const f=fixture(1), initial=Date.parse('2026-10-18T12:00:00Z');
let clock=initial;
let store:ReturnType<typeof approvalStore>;
let refs:InputRef[];
let deal={id:'0',properties:{hs_lastmodifieddate:'2026-10-18T11:00:00Z',amount:'100'}};
let line={id:'101',properties:{hs_lastmodifieddate:'2026-10-18T11:00:00Z',quantity:'1',price:'100'}};
let listExists=true, reads=0;
const payload:Payload={effects:[{system:'clickup',location:'list1',action:'create_task',records:[{id:'new',fields:{name:{before:null,after:'Build the site'}}}],amounts:{}}]};
const mail:Payload={effects:[{system:'mail',location:'team inbox',action:'send_message',records:[],amounts:{},message:{to:['omar@example.test'],subject:'Your delivery plan',body:'Hello Omar, please review the full plan.'}}]};
function member(key:'admin'|'manager'|'lead'|'contributor'|'reviewer',roles?:Role[]):Member {
  const names={admin:'Adhil',manager:'Omar',lead:'Imran',contributor:'Ravi',reviewer:'Bilal'};
  const role={admin:'admin',manager:'account_manager',lead:'delivery_lead',contributor:'contributor',reviewer:'client_reviewer'} as const;
  return {id:f[key],workspace_id:f.ws,display_name:names[key],roles:roles??[role[key]],client_company_id:key==='reviewer'?f.companyA:null,is_demo:false};
}
function input(kind:Kind='provision',overrides:Partial<CreateApproval>={}):CreateApproval {return {runId:f.runA,kind,payload:kind==='client_email'?mail:payload,inputRefs:refs,reversibility:kind==='client_email'?'irreversible':'reversible',requestedByType:'agent',requestedByMemberId:null,...overrides};}
async function create(kind:Kind='provision',overrides:Partial<CreateApproval>={}) {const result=await store.createApproval(input(kind,overrides),member('admin'));expect(result.status).toBe(201);return result.approval!;}
async function row(a:Approval) {return (await database.db.query<Approval>('SELECT * FROM approvals WHERE id=$1',[a.id])).rows[0];}
async function noEffects(a:Approval) {expect((await database.db.query('SELECT id FROM external_effects WHERE approval_id=$1',[a.id])).rows).toHaveLength(0);expect((await database.db.query("SELECT id FROM jobs WHERE payload->>'approvalId'=$1",[a.id])).rows).toHaveLength(0);}
async function approve(a:Approval,key:'lead'|'manager'|'admin'='lead') {expect((await store.decide(a.id,member(key),'approve')).status).toBe(200);}
beforeAll(async()=>{
  vi.stubEnv('TOKEN_ENC_KEY',Buffer.alloc(32,7).toString('base64'));
  database=await createDatabase();
  await database.db.query("INSERT INTO connections(workspace_id,provider,status,external_account_id,token_ciphertext) VALUES($1,'hubspot','connected','portal',$2),($1,'clickup','connected','team',$2)",[f.ws,encryptToken('fixture token')]);
  const scope=(await database.db.query<{id:string;version:number;items_hash:string|null;status:string}>('SELECT id,version,items_hash,status FROM scope_versions WHERE id=$1',[id(1,51)])).rows[0];
  refs=[{system:'hubspot',record_id:'0',version_marker:deal.properties.hs_lastmodifieddate,hash:hash(deal)},{system:'hubspot_line_item',record_id:'101',version_marker:line.properties.hs_lastmodifieddate,hash:hash(line)},{system:'scope',record_id:id(1,20),version_marker:'1',hash:hash(scope)},{system:'clickup',record_id:'list1',version_marker:'exists',hash:hash({id:'list1',archived:false})}];
  store=approvalStore(database.db,liveRead,()=>clock);
  const runtime=fixtureRuntime(database.db);
  mocks.owner.mockReturnValue({...runtime.owner,approvals:store});mocks.app.mockReturnValue(runtime.app);
},60000);
beforeEach(()=>{
  clock=initial;reads=0;listExists=true;
  deal={id:'0',properties:{hs_lastmodifieddate:'2026-10-18T11:00:00Z',amount:'100'}};
  line={id:'101',properties:{hs_lastmodifieddate:'2026-10-18T11:00:00Z',quantity:'1',price:'100'}};
  mocks.member.mockResolvedValue(member('lead'));
  server.use(http.get('https://api.hubapi.com/crm/objects/2026-03/deals/0',()=>{reads++;return HttpResponse.json(deal);}),http.post('https://api.hubapi.com/crm/objects/2026-03/line_items/batch/read',()=>{reads++;return HttpResponse.json({results:[line]});}),http.get('https://api.clickup.com/api/v2/list/list1',()=>{reads++;return listExists?HttpResponse.json({id:'list1',archived:false}):new HttpResponse(null,{status:404});}));
});
afterAll(async()=>{vi.unstubAllEnvs();await database?.db.close();});
it('Hashes canonical JSON with sorted object keys and sorted input refs',async()=>{
  expect(canonical({z:1,a:{z:2,a:3}})).toBe('{"a":{"a":3,"z":2},"z":1}');
  expect(hash({b:2,a:1})).toBe(hash({a:1,b:2}));
  expect(hash([1,2])).not.toBe(hash([2,1]));
  const a=await create('provision',{inputRefs:[...refs].reverse()});
  expect(a.payload_hash).toBe(hash(payload));expect(a.input_hash).toBe(hash(sortedRefs(refs)));
  expect(a.payload).toEqual(payload);expect(a.input_refs).toEqual(sortedRefs(refs));
});
it.each(['plan_correction','provision','client_email','scope_change','reversal'] as Kind[])('Stores required roles and expiry for %s',async kind=>{
  const a=await create(kind);expect(a.required_roles).toEqual(requiredRoles[kind]);
  expect(new Date(a.expires_at).getTime()-clock).toBe(kind==='client_email'?1800000:86400000);
});
it('Stores the exact full outgoing team inbox message and requires irreversible email approval',async()=>{
  const a=await create('client_email');expect(a.payload).toEqual(mail);
  await expect(store.createApproval(input('client_email',{reversibility:'reversible'}),member('admin'))).rejects.toThrow('irreversible');
  await expect(store.createApproval(input('provision',{payload:mail}),member('admin'))).rejects.toThrow('email approval');
  await noEffects(a);
});
it('Refuses a tampered payload before any effect or job',async()=>{
  const a=await create();await approve(a);
  await database.db.query('UPDATE approvals SET payload=$2 WHERE id=$1',[a.id,JSON.stringify({...payload,effects:[]})]);
  expect(await store.execute(a.id,member('lead'))).toMatchObject({status:409,message:'The approved payload has changed'});await noEffects(a);expect(reads).toBe(0);
});
it('Refuses tampered input refs before any live read or effect',async()=>{
  const a=await create();await approve(a);await database.db.query("UPDATE approvals SET input_refs='[]' WHERE id=$1",[a.id]);
  expect((await store.execute(a.id,member('lead'))).status).toBe(409);await noEffects(a);expect(reads).toBe(0);
});
it('Expires a pending decision at the exact expiry boundary and audits the refusal',async()=>{
  const a=await create();clock+=86400000;expect((await store.decide(a.id,member('lead'),'approve')).status).toBe(409);expect((await row(a)).status).toBe('expired');await noEffects(a);
  expect((await database.db.query("SELECT outcome FROM audit_log WHERE approval_id=$1 AND action='approval_decide'",[a.id])).rows).toEqual([{outcome:'failed'}]);
});
it('Expires an approved execution before any effect',async()=>{
  const a=await create();await approve(a);clock+=86400000;expect((await store.execute(a.id,member('lead'))).status).toBe(409);expect((await row(a)).status).toBe('expired');await noEffects(a);
});
it('Refuses self approval by the human requester including admin',async()=>{
  const a=await create('provision',{requestedByType:'user',requestedByMemberId:f.admin});
  expect((await store.decide(a.id,member('admin'),'approve')).status).toBe(403);expect((await row(a)).status).toBe('pending');
});
it('Allows an agent request to be approved by the asking member',async()=>{
  const a=await create('provision',{requestedByMemberId:f.admin});await approve(a,'admin');expect((await row(a)).status).toBe('approved');
});
it('Contributor receives 403 with a denied audit row through the decide route',async()=>{
  const a=await create();mocks.member.mockResolvedValue(member('contributor'));
  const response=await decideRoute(new Request('http://localhost',{method:'POST',body:JSON.stringify({decision:'approve'})}),{params:Promise.resolve({id:a.id})});
  expect(response.status).toBe(403);expect(await response.json()).toMatchObject({message:'Only a delivery lead or the agency director can approve delivery plans.'});
  expect((await database.db.query("SELECT outcome,actor_member_id FROM audit_log WHERE target_id=$1 AND outcome='denied'",[a.id])).rows).toEqual([{outcome:'denied',actor_member_id:f.contributor}]);await noEffects(a);
});
it('Rechecks stored roles instead of trusting a caller supplied admin role',async()=>{
  const a=await create();expect((await store.decide(a.id,member('contributor',['admin']),'approve')).status).toBe(403);
});
it.each([['provision','manager'],['plan_correction','manager'],['client_email','lead'],['reversal','manager']] as const)('Refuses the wrong role for %s',async(kind,key)=>{
  const a=await create(kind);expect((await store.decide(a.id,member(key),'approve')).status).toBe(403);
});
it('Scope change needs distinct account manager and delivery lead decisions',async()=>{
  const a=await create('scope_change');await approve(a,'manager');expect((await row(a)).status).toBe('pending');
  expect((await store.execute(a.id,member('lead'))).status).toBe(409);await noEffects(a);
  await approve(a,'lead');expect((await row(a)).status).toBe('approved');
  expect((await store.execute(a.id,member('lead'))).status).toBe(200);
});
it.each(['manager','lead'] as const)('Scope change allows admin plus %s',async key=>{
  const a=await create('scope_change');await approve(a,'admin');expect((await row(a)).status).toBe('pending');await approve(a,key);expect((await row(a)).status).toBe('approved');
});
it('One person with both roles cannot satisfy scope quorum',async()=>{
  await database.db.query("UPDATE members SET roles=ARRAY['account_manager','delivery_lead'] WHERE id=$1",[f.manager]);
  try {const a=await create('scope_change');await approve(a,'manager');expect((await row(a)).status).toBe('pending');expect((await store.decide(a.id,member('manager'),'approve')).status).toBe(409);}
  finally {await database.db.query("UPDATE members SET roles=ARRAY['account_manager'] WHERE id=$1",[f.manager]);}
});
it('Rechecks approver roles at execution time',async()=>{
  const a=await create();await approve(a);await database.db.query("UPDATE members SET roles=ARRAY['contributor'] WHERE id=$1",[f.lead]);
  try {expect(await store.execute(a.id,member('admin'))).toMatchObject({status:409,message:'The approver roles have changed'});await noEffects(a);}
  finally {await database.db.query("UPDATE members SET roles=ARRAY['delivery_lead'] WHERE id=$1",[f.lead]);}
});
it('Rejects a decision and refuses any later decision or execution',async()=>{
  const a=await create();expect((await store.decide(a.id,member('lead'),'reject','Please revise the plan')).status).toBe(200);expect((await row(a)).decision_note).toBe('Please revise the plan');
  expect((await store.decide(a.id,member('admin'),'approve')).status).toBe(409);expect((await store.execute(a.id,member('lead'))).status).toBe(409);await noEffects(a);
});
it.each(['webhook','reconcile'] as const)('Marks watched approvals stale immediately on HubSpot %s receipt',async via=>{
  const pending=await create(),approved=await create();await approve(approved);
  const connection=(await jobStore(database.db).hubspotConnections('portal'))[0];
  await jobStore(database.db).ingestHubspot(connection,[{portalId:'portal',eventId:randomUUID(),objectId:'0',subscriptionType:'deal.propertyChange',occurredAt:clock}],via);
  for(const a of [pending,approved]) {expect((await row(a)).status).toBe('stale');expect((await row(a)).stale_reason).toMatch(/^HubSpot record changed at .* UTC$/);expect((await store.execute(a.id,member('lead'))).status).toBe(409);await noEffects(a);}
});
it('An unrelated HubSpot webhook leaves an approval open',async()=>{
  const a=await create();const connection=(await jobStore(database.db).hubspotConnections('portal'))[0];await jobStore(database.db).ingestHubspot(connection,[{portalId:'portal',eventId:randomUUID(),objectId:'999',subscriptionType:'deal.propertyChange'}],'webhook');expect((await row(a)).status).toBe('pending');
});
it('ClickUp webhook invalidates the watched target list immediately',async()=>{
  const a=await create();const connection=(await jobStore(database.db).clickupConnections())[0];await jobStore(database.db).ingestClickup(connection,'hook','taskUpdated','task1',[{id:randomUUID()}],{list_id:'list1'});expect((await row(a)).status).toBe('stale');await noEffects(a);
});
it('Scope updates immediately invalidate watched approvals',async()=>{
  const a=await create();await database.db.query("UPDATE scope_versions SET reason='A new instruction' WHERE id=$1",[id(1,51)]);expect((await row(a)).status).toBe('stale');expect((await row(a)).stale_reason).toMatch(/^Scope version changed at /);await noEffects(a);
});
it.each(['deal','line'] as const)('Live execution recheck detects changed %s before any effect',async kind=>{
  const a=await create();await approve(a);
  if(kind==='deal') deal.properties.amount='200';else line.properties.quantity='2';
  const result=await store.execute(a.id,member('lead'));expect(result.status).toBe(409);expect(result.message).toContain(kind==='deal'?'HubSpot deal changed':'HubSpot line item changed');expect(result.message).toContain(new Date(clock).toUTCString());expect((await row(a)).status).toBe('stale');await noEffects(a);expect(reads).toBe(3);
});
it('Live execution recheck detects a changed scope version without an event',async()=>{
  const a=await create('provision',{inputRefs:refs.map(ref=>ref.system==='scope'?{...ref,version_marker:'0'}:ref)});await approve(a);const result=await store.execute(a.id,member('lead'));expect(result.message).toContain('Scope version changed');expect((await row(a)).status).toBe('stale');await noEffects(a);
});
it('Missing ClickUp target list marks the approval stale before any effect',async()=>{
  const a=await create();await approve(a);listExists=false;expect((await store.execute(a.id,member('lead'))).status).toBe(409);expect((await row(a)).status).toBe('stale');expect((await row(a)).stale_reason).toContain('ClickUp target list changed');await noEffects(a);
});
it('A provider outage fails closed and audits the refused execution',async()=>{
  const a=await create();await approve(a);server.use(http.get('https://api.hubapi.com/crm/objects/2026-03/deals/0',()=>new HttpResponse(null,{status:503})));expect((await store.execute(a.id,member('lead'))).status).toBe(409);await noEffects(a);
});
it('Double execution returns the stored summary and creates exactly one effect and job',async()=>{
  const a=await create();await approve(a);const first=await store.execute(a.id,member('lead'));expect(first.status).toBe(200);expect(reads).toBe(3);
  const second=await store.execute(a.id,member('lead'));expect(second.summary).toEqual(first.summary);expect(reads).toBe(3);
  expect((await database.db.query('SELECT state,request,request_hash FROM external_effects WHERE approval_id=$1',[a.id])).rows).toEqual([{state:'planned',request:payload.effects[0],request_hash:hash(payload.effects[0])}]);
  expect((await database.db.query("SELECT kind,status FROM jobs WHERE payload->>'approvalId'=$1",[a.id])).rows).toEqual([{kind:'execute_approval_effect',status:'queued'}]);
  expect((await row(a)).status).toBe('executing');
  expect((await database.db.query<{action:string}>('SELECT action FROM audit_log WHERE approval_id=$1',[a.id])).rows.map(r=>r.action)).toEqual(expect.arrayContaining(['approval_created','approval_decided','approval_effect_planned','approval_job_queued','approval_executing','approval_execution_reused']));
});
it('Executed approval returns the first stored summary',async()=>{
  const a=await create();await approve(a);const first=await store.execute(a.id,member('lead'));await database.db.query("UPDATE approvals SET status='executed',executed_at=now() WHERE id=$1",[a.id]);clock+=86400000;expect((await store.execute(a.id,member('lead'))).summary).toEqual(first.summary);
});
it('Irreversible execution without separate confirmation is refused',async()=>{
  const a=await create('client_email');await approve(a,'manager');expect((await store.execute(a.id,member('manager'))).status).toBe(409);await noEffects(a);
});
it('Only the deciding approver can confirm an irreversible approval',async()=>{
  const a=await create('client_email');await approve(a,'manager');expect((await store.confirm(a.id,member('admin'))).status).toBe(403);await noEffects(a);
});
it('Confirmation at two minutes is too late',async()=>{
  const a=await create('client_email');await approve(a,'manager');clock+=120000;expect((await store.confirm(a.id,member('manager'))).status).toBe(409);await noEffects(a);
});
it('Separate confirmation within two minutes allows exact email work to be queued',async()=>{
  const a=await create('client_email');await approve(a,'manager');clock+=119999;expect((await store.confirm(a.id,member('manager'))).status).toBe(200);clock+=1000;
  expect((await store.execute(a.id,member('manager'))).status).toBe(200);
  expect((await database.db.query('SELECT request FROM external_effects WHERE approval_id=$1',[a.id])).rows).toEqual([{request:mail.effects[0]}]);
});
it('An irreversible approval expires after thirty minutes even if confirmed',async()=>{
  const a=await create('client_email');await approve(a,'manager');await store.confirm(a.id,member('manager'));clock+=1800000;expect((await store.execute(a.id,member('manager'))).status).toBe(409);expect((await row(a)).status).toBe('expired');await noEffects(a);
});
it('Decision confirm and execute routes use the real engine',async()=>{
  const a=await create('client_email');mocks.member.mockResolvedValue(member('manager'));const context={params:Promise.resolve({id:a.id})};
  expect((await decideRoute(new Request('http://localhost',{method:'POST',body:JSON.stringify({decision:'approve',note:'Ready to send'})}),context)).status).toBe(200);
  expect((await confirmRoute(new Request('http://localhost',{method:'POST'}),context)).status).toBe(200);
  expect((await executeRoute(new Request('http://localhost',{method:'POST'}),context)).status).toBe(200);expect((await row(a)).status).toBe('executing');
});
it('Routes refuse missing authentication invalid ids and invalid decision bodies',async()=>{
  const a=await create();mocks.member.mockResolvedValue(null);expect((await executeRoute(new Request('http://localhost'),{params:Promise.resolve({id:a.id})})).status).toBe(401);mocks.member.mockResolvedValue(member('lead'));
  expect((await decideRoute(new Request('http://localhost'),{params:Promise.resolve({id:'bad'})})).status).toBe(404);
  expect((await decideRoute(new Request('http://localhost',{method:'POST',body:'{}'}),{params:Promise.resolve({id:a.id})})).status).toBe(400);await noEffects(a);
});
it('Cross workspace approval access is refused',async()=>{
  const a=await create();const other={...member('lead'),id:fixture(2).lead,workspace_id:fixture(2).ws};expect((await store.execute(a.id,other)).status).toBe(404);await noEffects(a);
});
it('The app role cannot bypass the engine with direct approval writes',async()=>{
  const a=await create();await expect(database.asMember(f.lead,db=>db.query("UPDATE approvals SET status='approved' WHERE id=$1",[a.id]))).rejects.toThrow(/permission denied/);expect((await row(a)).status).toBe('pending');
});
it('Approval decision execution and watcher audits preserve the full audit chain',async()=>{expect(await verifyChain(database.db,f.ws)).toEqual({ok:true,brokenAtId:null});});
it.each(['plan_correction','provision','client_email','reversal'] as Kind[])('Allows the required non admin role to decide %s',async kind=>{
  const a=await create(kind);await approve(a,kind==='client_email'?'manager':'lead');expect((await row(a)).status).toBe('approved');
});
it.each(['plan_correction','provision','client_email','reversal'] as Kind[])('Allows admin to decide %s',async kind=>{
  const a=await create(kind);await approve(a,'admin');expect((await row(a)).status).toBe('approved');
});
it('Scope requester cannot supply either quorum decision',async()=>{
  const created=await store.createApproval(input('scope_change',{requestedByType:'user',requestedByMemberId:f.manager}),member('manager'));
  const a=created.approval!;expect((await store.decide(a.id,member('manager'),'approve')).status).toBe(403);
  await approve(a,'lead');expect((await row(a)).status).toBe('pending');await approve(a,'admin');expect((await row(a)).status).toBe('approved');
});
it('The human requester cannot confirm or execute an approval decided by someone else',async()=>{
  const a=await create('client_email',{requestedByType:'user',requestedByMemberId:f.admin});await approve(a,'manager');expect((await store.confirm(a.id,member('admin'))).status).toBe(403);await store.confirm(a.id,member('manager'));expect((await store.execute(a.id,member('admin'))).status).toBe(403);await noEffects(a);
});
it('Expires if a slow live read crosses the approval deadline',async()=>{
  const a=await create();await approve(a);
  const slow=approvalStore(database.db,async(_db,_ws,_member,ref)=>{clock=initial+86400000;return ref;},()=>clock);
  expect((await slow.execute(a.id,member('lead'))).status).toBe(409);expect((await row(a)).status).toBe('expired');await noEffects(a);
});
it('Completes every live recheck before the first effect row or job exists',async()=>{
  const a=await create();await approve(a);const watched:string[]=[];
  const checking=approvalStore(database.db,async(db,ws,actor,ref)=>{
    expect((await db.query('SELECT id FROM external_effects WHERE approval_id=$1',[a.id])).rows).toHaveLength(0);
    expect((await db.query("SELECT id FROM jobs WHERE payload->>'approvalId'=$1",[a.id])).rows).toHaveLength(0);
    watched.push(ref.system);return liveRead(db,ws,actor,ref);
  },()=>clock);
  expect((await checking.execute(a.id,member('lead'))).status).toBe(200);expect(watched.sort()).toEqual(['clickup','hubspot','hubspot_line_item','scope']);
});
it('Concurrent execution calls return the same stored result',async()=>{
  const a=await create();await approve(a);const results=await Promise.all([store.execute(a.id,member('lead')),store.execute(a.id,member('lead'))]);expect(results[0].status).toBe(200);expect(results[1].summary).toEqual(results[0].summary);expect((await database.db.query('SELECT id FROM external_effects WHERE approval_id=$1',[a.id])).rows).toHaveLength(1);
});
it('A queue failure rolls back effects and jobs and records a failed execution audit',async()=>{
  const a=await create();await approve(a);
  const failing=approvalStore({transaction:work=>database.db.transaction(db=>work({async query(sql,params){if(sql.includes('INSERT INTO jobs')) throw new Error('Fixture queue failure');return db.query(sql,params);}}))},async(_db,_ws,_actor,ref)=>ref,()=>clock);
  expect((await failing.execute(a.id,member('lead'))).status).toBe(409);expect((await row(a)).status).toBe('approved');await noEffects(a);
  expect((await database.db.query("SELECT outcome FROM audit_log WHERE approval_id=$1 AND action='approval_execute'",[a.id])).rows).toEqual([{outcome:'failed'}]);
});
it('A stale approval refuses new decisions and confirmations',async()=>{
  const a=await create('client_email');await database.db.query("UPDATE approvals SET status='stale',stale_reason='Scope changed' WHERE id=$1",[a.id]);expect((await store.decide(a.id,member('manager'),'approve')).status).toBe(409);expect((await store.confirm(a.id,member('manager'))).status).toBe(409);await noEffects(a);
});
it('A reversible approval refuses a confirmation call',async()=>{
  const a=await create();await approve(a);expect((await store.confirm(a.id,member('lead'))).status).toBe(409);await noEffects(a);
});
it('Expired irreversible confirmation is refused',async()=>{
  const a=await create('client_email');await approve(a,'manager');clock+=1800000;expect((await store.confirm(a.id,member('manager'))).status).toBe(409);expect((await row(a)).status).toBe('expired');
});
it('Irreversible decision returns the exact message for the separate confirmation step',async()=>{
  const a=await create('client_email');expect((await store.decide(a.id,member('manager'),'approve')).summary).toEqual({payload:mail,payloadHash:hash(mail),reversibility:'irreversible'});
});
it('Multiple exact effects create separate planned effects and jobs',async()=>{
  const exact:Payload={effects:[payload.effects[0],{...payload.effects[0],records:[{id:'new second task',fields:{name:{before:null,after:'Review the site'}}}]}]};
  const a=await create('provision',{payload:exact});await approve(a);expect((await store.execute(a.id,member('lead'))).status).toBe(200);expect((await database.db.query('SELECT id FROM external_effects WHERE approval_id=$1',[a.id])).rows).toHaveLength(2);expect((await database.db.query("SELECT id FROM jobs WHERE payload->>'approvalId'=$1",[a.id])).rows).toHaveLength(2);
});
it('Cancellable approval retains its reversibility on the planned effect',async()=>{
  const a=await create('provision',{reversibility:'cancellable'});await approve(a);expect((await store.execute(a.id,member('lead'))).status).toBe(200);expect((await database.db.query('SELECT reversibility FROM external_effects WHERE approval_id=$1',[a.id])).rows).toEqual([{reversibility:'cancellable'}]);
});
it('The minimal creation call records the human requester and prevents self approval',async()=>{
  const created=await store.createApproval({runId:f.runA,kind:'provision',payload,inputRefs:refs,reversibility:'reversible'},member('admin'));
  expect(created.status).toBe(201);expect(created.approval!.requested_by_type).toBe('user');expect(created.approval!.requested_by_member_id).toBe(f.admin);expect((await store.decide(created.approval!.id,member('admin'),'approve')).status).toBe(403);
});
it('HubSpot line item webhooks invalidate the watched line hash',async()=>{
  const a=await create();const connection=(await jobStore(database.db).hubspotConnections('portal'))[0];await jobStore(database.db).ingestHubspot(connection,[{portalId:'portal',eventId:randomUUID(),objectId:'101',subscriptionType:'line_item.propertyChange'}],'webhook');expect((await row(a)).status).toBe('stale');await noEffects(a);
});
it('ClickUp poll receipts invalidate the watched target list',async()=>{
  const a=await create();await database.db.query("INSERT INTO inbound_events(workspace_id,source,dedupe_key,external_object_id,raw,received_via,received_at) VALUES($1,'clickup',$2,'list1',$3,'poll',now())",[f.ws,randomUUID(),JSON.stringify({list_id:'list1'})]);expect((await row(a)).status).toBe('stale');await noEffects(a);
});
it('ClickUp events without list identity conservatively invalidate open list approvals',async()=>{
  const a=await create();const connection=(await jobStore(database.db).clickupConnections())[0];await jobStore(database.db).ingestClickup(connection,'hook','taskDeleted','task1',[{id:randomUUID()}],{task_id:'task1'});expect((await row(a)).status).toBe('stale');await noEffects(a);
});
it('Archived ClickUp target lists are stale at execution',async()=>{
  const a=await create();await approve(a);server.use(http.get('https://api.clickup.com/api/v2/list/list1',()=>HttpResponse.json({id:'list1',archived:true})));expect((await store.execute(a.id,member('lead'))).status).toBe(409);expect((await row(a)).status).toBe('stale');await noEffects(a);
});
it('Changed HubSpot modified time alone makes an approval stale',async()=>{
  const a=await create();await approve(a);deal.properties.hs_lastmodifieddate='2026-10-18T11:30:00Z';expect((await store.execute(a.id,member('lead'))).status).toBe(409);expect((await row(a)).status).toBe('stale');await noEffects(a);
});
it('Unknown cross workspace and inactive identities cannot create or mutate approvals',async()=>{
  const a=await create();expect((await store.decide(a.id,{...member('lead'),workspace_id:fixture(2).ws},'approve')).status).toBe(403);expect((await store.execute(a.id,{...member('lead'),id:f.archived})).status).toBe(403);expect((await store.createApproval(input(),member('contributor'))).status).toBe(403);expect((await row(a)).status).toBe('pending');
});
it('Duplicate input refs and malformed exact payloads are refused',async()=>{
  await expect(store.createApproval(input('provision',{inputRefs:[...refs,refs[0]]}),member('admin'))).rejects.toThrow('Each input');
  await expect(store.createApproval(input('provision',{payload:{effects:[]}}),member('admin'))).rejects.toThrow();
});
