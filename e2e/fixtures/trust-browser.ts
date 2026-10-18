import { expect,type Page } from '@playwright/test';
import en from '../../messages/en.json';
import ar from '../../messages/ar.json';
export async function begin(page:Page,width:number,locale:'en'|'ar',persona:'imran'|'faisal'|'laith'|'omar'='imran') {
  const copy=locale==='en'?en:ar;
  await page.setViewportSize({width,height:900});
  await page.goto(`/demo?lang=${locale}`);
  await page.getByRole('button',{name:new RegExp(copy.demo.people[persona])}).click();
  await expect(page.getByRole('status')).toContainText(copy.demo.ready);
  await page.getByRole('link',{name:copy.demo.open}).click();
  return copy;
}
export async function fits(page:Page,width:number) {
  await expect.poll(()=>page.evaluate(()=>({document:document.documentElement.scrollWidth,body:document.body.scrollWidth,viewport:innerWidth}))).toEqual({document:width,body:width,viewport:width});
  const targets=page.locator('.screen button:visible,.screen input:visible,.screen select:visible');
  for(const target of await targets.all()){const box=await target.boundingBox();expect(box?.height).toBeGreaterThanOrEqual(44);}
}
