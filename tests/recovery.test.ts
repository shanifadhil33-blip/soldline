import { beforeAll,beforeEach,afterAll,expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase,fixture } from './helpers/pglite';
import { fixtureRuntime } from './helpers/runtime';
import type { Member } from '../src/server/permissions';
const mocks=vi.hoisted(()=>({member:vi.fn(),owner:vi.fn(),app:vi.fn()}));
vi.mock('../src/server/session',()=>({getMember:mocks.member}));
vi.mock('../src/server/db/runtime',()=>({getOwnerServices:mocks.owner,getAppDriver:mocks.app}));
import { POST as actionRoute } from '../src/app/api/recovery/[id]/actions/route';
import { POST as pauseRoute } from '../src/app/api/runs/[id]/pause/route';
import { POST as cancelRoute } from '../src/app/api/runs/[id]/cancel/route';
import { POST as undoRoute } from '../src/app/api/runs/[id]/undo/route';
const f=fixture(1);
const admin:Member={id:f.admin,workspace_id:f.ws,display_name:'Adhil',roles:['admin'],client_company_id:null,is_demo:false};
let database:Awaited<ReturnType<typeof createDatabase>>,itemId:string;
const context=(id:string)=>({params:Promise.resolve({id})});
const request=(body:unknown={})=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)});
beforeAll(async()=>{database=await createDatabase();const runtime=fixtureRuntime(database.db);mocks.owner.mockReturnValue(runtime.owner);mocks.app.mockReturnValue(runtime.app);},60000);
afterAll(async()=>{await database?.db.close();});
beforeEach(async()=>{
  mocks.member.mockResolvedValue(admin);itemId=randomUUID();
  await database.db.query("UPDATE runs SET status='partly_done' WHERE id=$1",[f.runA]);
  await database.db.query("INSERT INTO recovery_items(id,workspace_id,run_id,owner_member_id,status,allowed_options) VALUES($1,$2,$3,$4,'open',ARRAY['resolve_with_note','cancel_remaining'])",[itemId,f.ws,f.runA,f.lead]);
});
it('Recovery action route records a resolution note through the owner service',async()=>{
  const result=await actionRoute(request({option:'resolve_with_note',note:'Omar checked the delivery'}),context(itemId));expect(result.status).toBe(200);
  expect((await database.db.query('SELECT status,resolved_by,resolution_note FROM recovery_items WHERE id=$1',[itemId])).rows).toEqual([{status:'resolved',resolved_by:f.admin,resolution_note:'Omar checked the delivery'}]);
});
it('Run routes pause and cancel through the permission guard',async()=>{expect((await pauseRoute(request(),context(f.runA))).status).toBe(200);expect((await cancelRoute(request(),context(f.runA))).status).toBe(200);expect((await database.db.query<{status:string}>('SELECT status FROM runs WHERE id=$1',[f.runA])).rows[0].status).toBe('cancelled');});
it('Recovery routes refuse missing sessions malformed ids and invalid bodies',async()=>{
  mocks.member.mockResolvedValue(null);expect((await actionRoute(request(),context(itemId))).status).toBe(401);mocks.member.mockResolvedValue(admin);
  expect((await actionRoute(request(),context('invalid'))).status).toBe(404);expect((await actionRoute(request({option:'invalid'}),context(itemId))).status).toBe(400);
  expect((await database.db.query("SELECT id FROM audit_log WHERE target_id=$1 AND action='recovery_refused'",[itemId])).rows).toHaveLength(1);
});
it('Recovery routes enforce staff ownership contributor denial and workspace isolation',async()=>{
  mocks.member.mockResolvedValue({...admin,id:f.manager,roles:['account_manager']});expect((await actionRoute(request({option:'resolve_with_note',note:'Omar checked'}),context(itemId))).status).toBe(403);
  mocks.member.mockResolvedValue({...admin,id:f.contributor,roles:['contributor']});expect((await pauseRoute(request(),context(f.runA))).status).toBe(403);
  const other=fixture(2);mocks.member.mockResolvedValue({...admin,id:other.admin,workspace_id:other.ws});expect((await actionRoute(request({option:'resolve_with_note',note:'Omar checked'}),context(itemId))).status).toBe(404);
});
it('Undo route refuses runs with no reversible effects',async()=>{expect((await undoRoute(request(),context(f.runA))).status).toBe(409);});
