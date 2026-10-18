import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
const mocks=vi.hoisted(()=>({owner:vi.fn(),app:vi.fn()}));
vi.mock('../src/server/db/runtime',()=>({getOwnerServices:mocks.owner,getAppDriver:mocks.app}));
import { POST as start } from '../src/app/api/demo/start/route';
import { POST as check } from '../src/app/api/demo/backend-check/route';
let db:PGlite;
beforeAll(async()=>{vi.stubEnv('DEMO_SIGNING_KEY','local trust signing key');db=new PGlite();await migrate(db);const runtime=fixtureRuntime(db);mocks.owner.mockReturnValue(runtime.owner);mocks.app.mockReturnValue(runtime.app);},60000);
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
for(const persona of ['omar','imran']) it(`Every sample run has a delivery lead and a won date, and the backend check works for ${persona} on each run`,async()=>{
 const begun=await start(new Request('http://localhost/api/demo/start',{method:'POST',body:JSON.stringify({persona})}));
 const {sandbox}=await begun.json(),cookie=begun.headers.get('set-cookie')!.split(';')[0];
 const runs=(await db.query<{id:string;delivery_lead_id:string|null;won_at:string|null}>('SELECT id,delivery_lead_id,won_at FROM runs WHERE workspace_id=$1',[sandbox])).rows;
 expect(runs.length).toBeGreaterThan(1);
 for(const run of runs){
  expect(run.delivery_lead_id).not.toBeNull();expect(run.won_at).not.toBeNull();
  const response=await check(new Request('http://localhost/api/demo/backend-check',{method:'POST',headers:{cookie},body:JSON.stringify({runId:run.id})}));
  const body=await response.json();
  expect({run:run.id,status:response.status,body}).toMatchObject({status:200,body:{status:403,row:{outcome:'denied',actor_name_at_event:'Ravi Menon'}}});
 }
});
