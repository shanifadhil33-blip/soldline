import { beforeEach, expect, it, vi } from 'vitest';
import type { JobStore } from '../src/server/jobs/store';
const mocks=vi.hoisted(()=>({owner:vi.fn(),worker:vi.fn(),after:vi.fn()}));
vi.mock('../src/server/db/runtime',()=>({getOwnerServices:mocks.owner}));
vi.mock('../src/server/jobs/runtime',()=>({runWorker:mocks.worker}));
vi.mock('next/server',()=>({after:mocks.after}));
import { POST as tick } from '../src/app/api/jobs/tick/route';
import { GET as daily } from '../src/app/api/jobs/daily/route';
import { POST as hubspot } from '../src/app/api/webhooks/hubspot/route';
import { createHmac } from 'node:crypto';
beforeEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
it('Tick without bearer returns 401 before constructing database services',async()=>{
  vi.stubEnv('TICK_SECRET','fixture');
  expect((await tick(new Request('https://fixtures.soldline.test/api/jobs/tick',{method:'POST'}))).status).toBe(401);
  expect(mocks.owner).not.toHaveBeenCalled();expect(mocks.worker).not.toHaveBeenCalled();
});
it('An unset tick secret refuses even an empty bearer',async()=>{
  vi.stubEnv('TICK_SECRET','');
  expect((await tick(new Request('https://fixtures.soldline.test/api/jobs/tick',{method:'POST',headers:{Authorization:'Bearer '}}))).status).toBe(401);
  expect(mocks.owner).not.toHaveBeenCalled();
});
it('Daily without its bearer returns 401 before constructing database services',async()=>{
  vi.stubEnv('CRON_SECRET','fixture');
  expect((await daily(new Request('https://fixtures.soldline.test/api/jobs/daily'))).status).toBe(401);expect(mocks.owner).not.toHaveBeenCalled();
});
it('Tick with the bearer schedules jobs then runs the worker',async()=>{
  vi.stubEnv('TICK_SECRET','fixture');
  const schedule=vi.fn(async()=>{});mocks.owner.mockReturnValue({jobs:{schedule}});mocks.worker.mockResolvedValue(2);
  const result=await tick(new Request('https://fixtures.soldline.test/api/jobs/tick',{method:'POST',headers:{Authorization:'Bearer fixture'}}));
  expect(await result.json()).toEqual({processed:2});expect(schedule).toHaveBeenCalledWith(expect.any(Number),false);expect(mocks.worker).toHaveBeenCalledOnce();
});
it('Webhook stores verified events before registering the worker for after the response',async()=>{
  vi.stubEnv('HUBSPOT_APP_CLIENT_SECRET','fixture');
  const ingestHubspot=vi.fn(async()=>{expect(mocks.after).not.toHaveBeenCalled();return 1;});
  const jobs={hubspotConnections:vi.fn(async()=>[{external_account_id:'123'}]),ingestHubspot} as unknown as JobStore;
  mocks.owner.mockReturnValue({jobs});
  const raw=JSON.stringify([{portalId:123,eventId:1,objectId:2,subscriptionType:'deal.propertyChange',propertyName:'dealstage',propertyValue:'won'}]);
  const url='https://fixtures.soldline.test/api/webhooks/hubspot',timestamp=String(Date.now());
  const request=new Request(url,{method:'POST',body:raw,headers:{'X-HubSpot-Request-Timestamp':timestamp,'X-HubSpot-Signature-v3':createHmac('sha256','fixture').update('POST'+url+raw+timestamp).digest('base64')}});
  const start=performance.now(),response=await hubspot(request);
  expect(response.status).toBe(200);expect(performance.now()-start).toBeLessThan(1000);
  expect(ingestHubspot).toHaveBeenCalledOnce();expect(mocks.after).toHaveBeenCalledOnce();expect(mocks.worker).not.toHaveBeenCalled();
});
it('Webhook invalid signatures never query the event store or register a worker',async()=>{
  vi.stubEnv('HUBSPOT_APP_CLIENT_SECRET','fixture');
  const hubspotConnections=vi.fn();mocks.owner.mockReturnValue({jobs:{hubspotConnections}});
  expect((await hubspot(new Request('https://fixtures.soldline.test/api/webhooks/hubspot',{method:'POST',body:'not json'}))).status).toBe(401);
  expect(hubspotConnections).not.toHaveBeenCalled();expect(mocks.after).not.toHaveBeenCalled();
});
