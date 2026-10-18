import { afterAll,beforeAll,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase,fixture } from './helpers/pglite';
import { fixtureRuntime } from './helpers/runtime';
import type { Member } from '../src/server/permissions';
import { clientRecords } from '../src/server/trust';
const mocks=vi.hoisted(()=>({member:vi.fn(),owner:vi.fn(),app:vi.fn()}));
vi.mock('../src/server/session',()=>({getMember:mocks.member}));
vi.mock('../src/server/db/runtime',()=>({getOwnerServices:mocks.owner,getAppDriver:mocks.app}));
import { GET as recovery } from '../src/app/api/recovery/route';
import { GET as audit } from '../src/app/api/audit/route';
import { POST as connection,GET as connections } from '../src/app/api/connections/route';
import { GET as client } from '../src/app/api/client/route';
import { POST as input } from '../src/app/api/inputs/[id]/route';
import { GET as deliverable,POST as approve } from '../src/app/api/deliverables/[id]/route';
import { GET as run } from '../src/app/api/runs/[id]/route';
const f=fixture(1);
let ownInputId:string;
let database:Awaited<ReturnType<typeof createDatabase>>,runtime:ReturnType<typeof fixtureRuntime>;
const ctx=(id='')=>({params:Promise.resolve({id})});
const req=(body?:unknown)=>new Request('http://localhost',{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});
const member=(role:Member['roles'][number]):Member=>({id:({admin:f.admin,account_manager:f.manager,delivery_lead:f.lead,contributor:f.contributor,client_reviewer:f.reviewer})[role],workspace_id:f.ws,display_name:'Omar',roles:[role],client_company_id:role==='client_reviewer'?f.companyA:null,is_demo:false});
beforeAll(async()=>{
 database=await createDatabase();runtime=fixtureRuntime(database.db);mocks.owner.mockReturnValue(runtime.owner);mocks.app.mockReturnValue(runtime.app);
 await database.db.query('UPDATE runs SET delivery_lead_id=$2 WHERE id=$1',[f.runA,f.lead]);
 await database.db.query('UPDATE deals SET owner_member_id=$2 WHERE id=(SELECT deal_id FROM runs WHERE id=$1)',[f.runB,f.other]);
 await database.db.query("UPDATE monitor_tasks SET status='Client review' WHERE workspace_id=$1",[f.ws]);
 await database.db.query("INSERT INTO monitor_tasks(workspace_id,run_id,task_id,status,observed_at) VALUES($1,$2,'other company','Client review',now())",[f.ws,f.runB]);
 ownInputId=(await database.db.query<{id:string}>('SELECT id FROM onboarding_inputs WHERE run_id=$1',[f.runA])).rows[0].id;
 await database.asMember(f.admin,db=>db.query("SELECT audit_append($1,$2::jsonb)",[f.ws,JSON.stringify({action:'input_received',outcome:'succeeded',target_id:ownInputId})]));
 for(const [target,title] of [[f.runA,'Title at event'],[f.runB,'Other company']]) await database.asMember(f.admin,db=>db.query("SELECT audit_append($1,$2::jsonb)",[f.ws,JSON.stringify({action:'event',outcome:'succeeded',target_type:'run',target_id:target,after:{title}})]));
},60000);
afterAll(async()=>{await database?.db.close();});
it.each(['admin','account_manager','delivery_lead','contributor','client_reviewer'] as const)('Audit read checks the stored permission for %s',async role=>{
 mocks.member.mockResolvedValue(member(role));const response=await audit(req());
 expect(response.status).toBe(['contributor','client_reviewer'].includes(role)?403:200);
 if(response.ok){const body=await response.json();expect(body.chain).toEqual({ok:true,brokenAtId:null});expect(body.rows.some((r:{target_id:string})=>r.target_id===ownInputId)).toBe(true);expect(body.rows.some((r:{target_id:string})=>r.target_id===f.runA)).toBe(true);expect(body.rows.some((r:{target_id:string})=>r.target_id===f.runB)).toBe(role==='admin');}
});
it('Audit uses stored roles rather than caller supplied admin claims and keeps event names and titles',async()=>{
 mocks.member.mockResolvedValue({...member('contributor'),roles:['admin']});expect((await audit(req())).status).toBe(403);
 await database.db.query("UPDATE members SET display_name='Faisal' WHERE id=$1",[f.admin]);
 const result=await runtime.owner.trust.audit(member('admin'));
 expect(result.rows?.find(r=>r.target_id===f.runA)).toMatchObject({actor_name_at_event:'Adhil',after:{title:'Title at event'}});
});
it('Audit never reports an unbroken chain when the existing checker finds a break',async()=>{
 // Substitute the verifier SQL result at the driver boundary, without writing to the audit table.
 const {trustStore}=await import('../src/server/trust');
 const store=trustStore({transaction:work=>database.db.transaction(db=>work({query:async<T extends Record<string,unknown>>(sql:string,params?:unknown[])=>{
   if(sql.startsWith('SELECT id, prev_hash, row_hash, audit_row_hash'))return {rows:[{id:987,prev_hash:null,row_hash:'altered',expected:'actual'}] as unknown as T[]};
   return db.query<T>(sql,params);
 }}))});
 mocks.member.mockResolvedValue(member('admin'));mocks.owner.mockReturnValue({...runtime.owner,trust:store});
 const response=await audit(req());expect(response.status).toBe(200);expect((await response.json()).chain).toEqual({ok:false,brokenAtId:987});
 mocks.owner.mockReturnValue(runtime.owner);
});
it.each(['account_manager','delivery_lead','contributor','client_reviewer'] as const)('Connection change by %s returns 403 and an actual audit row',async role=>{
 mocks.member.mockResolvedValue(role==='contributor'?{...member(role),roles:['admin']}:member(role));
 const before=(await database.db.query('SELECT id FROM audit_log')).rows.length;
 expect((await connection(req({provider:'mail',operation:'pause'}))).status).toBe(403);
 expect((await database.db.query('SELECT id FROM audit_log')).rows.length).toBe(before+1);
 expect((await database.db.query('SELECT action,outcome,actor_member_id FROM audit_log ORDER BY id DESC LIMIT 1')).rows[0]).toEqual({action:'manage_connections_roles',outcome:'denied',actor_member_id:member(role).id});
 expect((await database.db.query('SELECT status FROM connections WHERE workspace_id=$1',[f.ws])).rows[0]).toEqual({status:'connected'});
});
it('Connection pause and resume cannot clear the reconnect requirement and reads never include credentials',async()=>{
 mocks.member.mockResolvedValue(member('admin'));
 await database.db.query("UPDATE connections SET status='needs_reconnect' WHERE workspace_id=$1",[f.ws]);
 for(const operation of ['pause','resume'])expect((await connection(req({provider:'mail',operation}))).status).toBe(200);
 expect((await database.db.query('SELECT status FROM connections WHERE workspace_id=$1',[f.ws])).rows[0]).toEqual({status:'needs_reconnect'});
 const body=await(await connections(req())).json();expect(body.editable).toBe(true);expect(JSON.stringify(body)).not.toMatch(/token|ciphertext|secret/);
});
it('Client reviewer collections contain his company only and input mutation enforces the same boundary',async()=>{
 const reviewer=member('client_reviewer');mocks.member.mockResolvedValue(reviewer);
 const response=await client(req(),ctx());expect(response.status).toBe(200);const body=await response.json();
 expect(body.runs.map((r:{id:string})=>r.id).sort()).toEqual([f.runA,f.runOther].sort());
 expect(body.inputs.every((r:{run_id:string})=>r.run_id!==f.runB)).toBe(true);
 expect(body.deliverables.map((r:{id:string})=>r.id)).toEqual(['fixture']);
 const inputs=(await database.db.query<{id:string;run_id:string}>('SELECT id,run_id FROM onboarding_inputs WHERE workspace_id=$1',[f.ws])).rows;
 expect((await input(req({confirm:true}),ctx(inputs.find(i=>i.run_id===f.runB)!.id))).status).toBe(404);
 expect((await input(req({confirm:true}),ctx(inputs.find(i=>i.run_id===f.runA)!.id))).status).toBe(200);
 const noCompany=await database.asMember(f.reviewer,db=>clientRecords(db,{...reviewer,client_company_id:null}));expect(noCompany).toEqual({runs:[],inputs:[],deliverables:[]});
});
it('Other company run and deliverable links have the identical neutral missing response and cannot be approved',async()=>{
 mocks.member.mockResolvedValue(member('client_reviewer'));
 const foreign=await run(req(),ctx(f.runB)),missing=await run(req(),ctx(randomUUID()));expect(foreign.status).toBe(404);expect(await foreign.json()).toEqual(await missing.json());
 const denied=await deliverable(req(),ctx('other company')),absent=await deliverable(req(),ctx('missing'));expect(denied.status).toBe(404);expect(await denied.json()).toEqual(await absent.json());
 expect((await approve(req({}),ctx('other company'))).status).toBe(404);
 expect((await approve(req({}),ctx('fixture'))).status).toBe(200);
 expect((await approve(req({}),ctx('fixture'))).status).toBe(409);
 expect((await database.db.query("SELECT status FROM monitor_tasks WHERE task_id='other company' AND workspace_id=$1",[f.ws])).rows[0]).toEqual({status:'Client review'});
});

it('Contributors read actual connection health without secrets',async()=>{
 mocks.member.mockResolvedValue(member('contributor'));const response=await connections(req());expect(response.status).toBe(200);const body=await response.json();expect(body.editable).toBe(false);expect(body.rows).toEqual([{provider:'mail',status:'needs_reconnect',scopes:null,allowed_actions:null}]);
});

it('Recovery reads only his open queue and preserves the stored allowed options',async()=>{
 const own=randomUUID(),other=randomUUID();
 for(const [id,owner] of [[own,f.lead],[other,f.manager]])await database.db.query("INSERT INTO recovery_items(id,workspace_id,run_id,owner_member_id,status,allowed_options) VALUES($1,$2,$3,$4,'open',ARRAY['resolve_with_note'])",[id,f.ws,f.runA,owner]);
 mocks.member.mockResolvedValue(member('delivery_lead'));
 const body=await(await recovery(req(),ctx())).json();expect(body.rows.map((r:{id:string})=>r.id)).toEqual([own]);expect(body.rows[0].allowed_options).toEqual(['resolve_with_note']);expect(body.rows[0].reversible).toBe(false);
});

it('Client approval survives another monitor observation and a new review cycle needs approval again',async()=>{
 mocks.member.mockResolvedValue(member('client_reviewer'));
 await database.db.query("UPDATE monitor_tasks SET status='Client review',observed_at=now() WHERE workspace_id=$1 AND task_id='fixture'",[f.ws]);
 const data=await(await client(req(),ctx())).json();expect(data.deliverables[0].status).toBe('approved');
 const read=await deliverable(req(),ctx('fixture'));expect((await read.json()).status).toBe('approved');
 await database.db.query("UPDATE monitor_tasks SET client_approved_at=now()-interval '2 days',review_since=now()-interval '1 day' WHERE workspace_id=$1 AND task_id='fixture'",[f.ws]);
 const next=await(await client(req(),ctx())).json();expect(next.deliverables[0].status).toBe('Client review');
 expect((await approve(req({}),ctx('fixture'))).status).toBe(200);
});
it('Monitor scan does not create a reminder for an approved client review',async()=>{
 await database.db.query("UPDATE monitor_tasks SET review_since=now()-interval '6 days',client_approved_at=now(),client_approved_by=$2 WHERE workspace_id=$1 AND task_id='fixture'",[f.ws,f.reviewer]);
 await runtime.owner.monitors.scan(f.ws);
 expect((await database.db.query("SELECT id FROM findings WHERE workspace_id=$1 AND run_id=$2 AND kind='overdue_client_approval'",[f.ws,f.runA])).rows).toHaveLength(0);
});
it('A reviewer with another role still cannot read or change a foreign company',async()=>{
 await database.db.query("UPDATE members SET roles=ARRAY['admin','client_reviewer'] WHERE id=$1",[f.reviewer]);
 mocks.member.mockResolvedValue({...member('client_reviewer'),roles:['admin','client_reviewer']});
 try {
  expect((await run(req(),ctx(f.runB))).status).toBe(404);
  expect((await deliverable(req(),ctx('other company'))).status).toBe(404);
  expect((await approve(req({}),ctx('other company'))).status).toBe(404);
  const foreign=(await database.db.query<{id:string}>('SELECT id FROM onboarding_inputs WHERE run_id=$1',[f.runB])).rows[0].id;
  expect((await input(req({confirm:true}),ctx(foreign))).status).toBe(404);
  const data=await(await client(req(),ctx())).json();expect(data.runs.every((r:{id:string})=>r.id!==f.runB)).toBe(true);
 } finally {await database.db.query("UPDATE members SET roles=ARRAY['client_reviewer'] WHERE id=$1",[f.reviewer]);}
});
