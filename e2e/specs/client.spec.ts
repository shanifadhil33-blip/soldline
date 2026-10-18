import { expect,test } from '@playwright/test';
import { begin,fits } from '../fixtures/trust-browser';
for(const width of [360,390,1440])for(const locale of ['en','ar'] as const)test(`Client isolation ${width} ${locale}`,async({page})=>{
  const m=await begin(page,width,locale,'faisal'),t=m.trust;
  const staff=await(await page.request.get('/api/client')).json();
  const harbor=staff.runs.find((r:{name:string})=>r.name.startsWith('Harbor'));
  const task=staff.deliverables.find((d:{run_id:string})=>d.run_id===harbor.id);
  await page.getByRole('combobox',{name:m.shell.persona}).selectOption('laith');
  await expect(page.getByRole('heading',{name:t.home,exact:true})).toBeVisible();
  await expect(page.locator('main')).toContainText('Cedar');
  await expect(page.locator('main')).not.toContainText('Harbor');
  await page.getByRole('button',{name:t.approve,exact:true}).click();
  await expect(page.getByText(t.approved,{exact:true})).toBeVisible();
  await page.goto('/inputs');
  await page.getByRole('button',{name:t.confirmInput,exact:true}).click();
  await expect(page.getByText(t.received,{exact:true})).toBeVisible();
  const own=await(await page.request.get('/api/client')).json();
  expect(own.runs).toHaveLength(1);expect(own.runs[0].name).toContain('Cedar');
  await fits(page,width);
  for(const path of [`/runs/${harbor.id}`,`/deliverables/${task.id}`]) {
    await page.goto(path);await expect(page.getByRole('heading',{name:t.notFound,exact:true})).toBeVisible();
    const neutral=await page.locator('main').innerText();
    await page.goto(path.startsWith('/runs')?'/runs/00000000-0000-4000-8000-000000000000':'/deliverables/missing');
    await expect(page.getByRole('heading',{name:t.notFound,exact:true})).toBeVisible();
    expect(await page.locator('main').innerText()).toBe(neutral);
    await fits(page,width);
  }
  expect((await page.request.get(`/api/runs/${harbor.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/deliverables/${task.id}`)).status()).toBe(404);
  expect((await page.request.post(`/api/deliverables/${task.id}`,{data:{}})).status()).toBe(404);
});
