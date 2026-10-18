import { expect,test } from '@playwright/test';
import { begin,fits } from '../fixtures/trust-browser';
for(const width of [360,390,1440])for(const locale of ['en','ar'] as const)test(`Backend check ${width} ${locale}`,async({page})=>{
  const m=await begin(page,width,locale),t=m.trust;
  const runs=await(await page.request.get('/api/client')).json();
  const harbor=runs.runs.find((r:{name:string})=>r.name.startsWith('Harbor'));
  await page.goto(`/runs/${harbor.id}`);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/demo/backend-check'));
  await page.getByRole('button',{name:t.tryRavi}).click();
  const body=await(await response).json();
  expect(body.status).toBe(403);expect(body.message).toBe('Only a delivery lead or the agency director can approve delivery plans.');
  await expect(page.locator('.backend-check')).toContainText('403');
  await expect(page.locator('.backend-check')).toContainText(body.message);
  await expect(page.locator('.backend-check')).toContainText('Ravi Menon');
  const audit=await(await page.request.get('/api/audit')).json();
  expect(audit.rows.find((r:{id:number})=>r.id===body.row.id)).toMatchObject({action:'approve_plan',outcome:'denied',actor_name_at_event:'Ravi Menon'});
  expect(audit.chain.ok).toBe(true);
  await fits(page,width);
});
