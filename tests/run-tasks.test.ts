import { afterAll,beforeAll,expect,it,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { http,HttpResponse } from 'msw';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
import { encryptToken } from '../src/server/crypto';
import { server } from './fixtures/http';
import type { Member } from '../src/server/permissions';
let db:PGlite,runtime:ReturnType<typeof fixtureRuntime>,member:Member,client:Member,run:string;
beforeAll(async()=>{
  vi.stubEnv('TOKEN_ENC_KEY',Buffer.alloc(32,7).toString('base64'));
  db=new PGlite();await migrate(db);runtime=fixtureRuntime(db);
  const ticket=await runtime.owner.demo.start('imran',null);
  member=(await runtime.owner.demo.member(ticket))!;
  client=(await runtime.owner.demo.member({...ticket,persona:'karim'}))!;
  run=(await db.query<{id:string}>('SELECT id FROM runs WHERE workspace_id=$1 ORDER BY scope_version_id NULLS LAST',[ticket.sandbox])).rows[0].id;
  await db.query("INSERT INTO connections(workspace_id,provider,status,token_ciphertext,external_account_id) VALUES($1,'clickup','connected',$2,'sample')",[ticket.sandbox,encryptToken('fixture only')]);
  await db.query("INSERT INTO external_effects(workspace_id,run_id,effect_key,system,action,external_id,state) VALUES($1,$2,'list','clickup','create_list','list1','succeeded')",[ticket.sandbox,run]);
},30000);
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
it('Reads every current task page through the existing ClickUp client with an observation time',async()=>{
  const pages:string[]=[];
  server.use(http.get('https://api.clickup.com/api/v2/list/list1/task',({request})=>{
    const page=new URL(request.url).searchParams.get('page')!;pages.push(page);
    return HttpResponse.json({tasks:[{id:'task'+page,name:'Brand style refresh',assignees:[{id:42,username:'Ravi'}],due_date:'1792324800000',status:{status:'open'}}],last_page:page==='1'});
  }));
  const before=Date.now(),result=await runtime.owner.readRunTasks(member,run);
  expect(pages).toEqual(['0','1']);expect(result?.tasks).toHaveLength(2);
  expect(result?.tasks[0]).toMatchObject({name:'Brand style refresh',assignees:[{id:42,username:'Ravi'}],due_date:'1792324800000',status:{status:'open'}});
  expect(Date.parse(result!.readAt)).toBeGreaterThanOrEqual(before);
});
it('Refuses client and cross workspace access before any provider request',async()=>{
  let calls=0;server.use(http.get('https://api.clickup.com/*',()=>{calls++;return HttpResponse.json({tasks:[]});}));
  expect(await runtime.owner.readRunTasks(client,run)).toBeNull();
  expect(await runtime.owner.readRunTasks({...member,workspace_id:crypto.randomUUID()},run)).toBeNull();
  expect(calls).toBe(0);
});
it('Does not substitute saved tasks when the current provider read fails',async()=>{
  server.use(http.get('https://api.clickup.com/*',()=>new HttpResponse(null,{status:503})));
  await expect(runtime.owner.readRunTasks(member,run)).rejects.toThrow();
});
