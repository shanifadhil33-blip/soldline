import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../src/server/db/migrate';
import { fixtureRuntime } from './helpers/runtime';
const mocks=vi.hoisted(()=>({owner:vi.fn(),app:vi.fn()}));
vi.mock('../src/server/db/runtime',()=>({getOwnerServices:mocks.owner,getAppDriver:mocks.app}));
import { POST as start } from '../src/app/api/demo/start/route';
import { POST as check } from '../src/app/api/demo/backend-check/route';
import { GET as audit } from '../src/app/api/audit/route';
let db:PGlite;
beforeAll(async()=>{vi.stubEnv('DEMO_SIGNING_KEY','local trust signing key');db=new PGlite();await migrate(db);const runtime=fixtureRuntime(db);mocks.owner.mockReturnValue(runtime.owner);mocks.app.mockReturnValue(runtime.app);},60000);
afterAll(async()=>{await db?.close();vi.unstubAllEnvs();});
it('Demo backend check sends the existing POST with the actual Ravi session and reads its new denial',async()=>{
 const begun=await start(new Request('http://localhost/api/demo/start',{method:'POST',body:JSON.stringify({persona:'faisal'})}));
 const {sandbox}=await begun.json(),cookie=begun.headers.get('set-cookie')!.split(';')[0];
 const run=(await db.query<{id:string}>('SELECT id FROM runs WHERE workspace_id=$1 LIMIT 1',[sandbox])).rows[0].id;
 const request=()=>new Request('http://localhost/api/demo/backend-check',{method:'POST',headers:{cookie},body:JSON.stringify({runId:run})});
 const first=await check(request());expect(first.status).toBe(200);const body=await first.json();
 expect(body).toMatchObject({request:{method:'POST',path:`/api/runs/${run}/approve-plan`},status:403,message:'Contributors cannot approve delivery plans.',row:{action:'approve_plan',outcome:'denied',actor_name_at_event:'Ravi Menon',target_id:run}});
 const response=await audit(new Request('http://localhost/api/audit',{headers:{cookie}}));const log=await response.json();expect(log.rows.find((r:{id:number})=>r.id===body.row.id)).toEqual(body.row);expect(log.chain.ok).toBe(true);
 const second=await(await check(request())).json();expect(Number(second.row.id)).toBeGreaterThan(Number(body.row.id));
 expect((await db.query('SELECT id FROM approvals WHERE workspace_id=$1',[sandbox])).rows).toHaveLength(0);
});

it('Backend check refuses an absent session and a client demo session',async()=>{
 expect((await check(new Request('http://localhost',{method:'POST',body:'{}'}))).status).toBe(401);
 const begun=await start(new Request('http://localhost/api/demo/start',{method:'POST',body:JSON.stringify({persona:'laith'})}));
 const {sandbox}=await begun.json(),cookie=begun.headers.get('set-cookie')!.split(';')[0];
 const run=(await db.query<{id:string}>('SELECT r.id FROM runs r JOIN deals d ON d.id=r.deal_id JOIN members m ON m.client_company_id=d.client_company_id WHERE r.workspace_id=$1 AND m.preferred_name=$2',[sandbox,'laith'])).rows[0].id;
 expect((await check(new Request('http://localhost',{method:'POST',headers:{cookie},body:JSON.stringify({runId:run})}))).status).toBe(403);
});
