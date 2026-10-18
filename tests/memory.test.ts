import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, fixture } from './helpers/pglite';
import { memoryStore } from '../src/server/memory/store';
import type { Member } from '../src/server/permissions';
import { verifyChain } from '../src/server/audit';
let ctx:Awaited<ReturnType<typeof createDatabase>>,memory:ReturnType<typeof memoryStore>;
const f=fixture(1),b=fixture(2);
const member=(id=f.admin,workspace_id=f.ws,roles:Member['roles']=['admin']):Member=>({id,workspace_id,roles,display_name:'Bilal',client_company_id:null,is_demo:false});
beforeAll(async()=>{ctx=await createDatabase();memory=memoryStore(ctx.db);},60000);
afterAll(async()=>{await ctx?.db.close();});
const personal=(text='Call me Ray')=>({scope:'person' as const,kind:'preference' as const,text,yes:true as const});
const company=(text='Use the client name for the campaign')=>({scope:'org' as const,kind:'client_preference' as const,text,yes:true as const,sourceRunIds:[f.runA,f.runB]});
it('A correction needs an explicit yes',async()=>{await expect(memory.remember(member(),{...personal(),yes:false as never})).rejects.toThrow();});
it('A one off exception creates no lesson',async()=>{await expect(memory.remember(member(),{...company(),exception:true})).rejects.toThrow('An exception');});
it('A company lesson needs repeated real records from its workspace',async()=>{
  await expect(memory.remember(member(),{...company(),sourceRunIds:[f.runA]})).rejects.toThrow('repeated');
  await expect(memory.remember(member(),{...company(),sourceRunIds:[f.runA,b.runA]})).rejects.toThrow('this workspace');
});
it('Big lessons and client preferences wait for admin approval',async()=>{
  const e=await memory.remember(member(f.manager,f.ws,['account_manager']),company());expect(e.status).toBe('waiting_approval');
  expect((await memory.context(member())).entries.map(e=>e.id)).not.toContain(e.id);
  await expect(memory.change(member(f.manager,f.ws,['account_manager']),e.id,'approve')).rejects.toThrow();
  await memory.change(member(),e.id,'approve');expect((await memory.context(member())).entries.map(e=>e.id)).toContain(e.id);
});
it('Deliverable mapping memory always waits for admin approval',async()=>{const e=await memory.remember(member(),{...company('A reel uses the video task'),kind:'mapping'});expect(e.status).toBe('waiting_approval');});
it('Personal memory corrects the preferred name language and digest time',async()=>{
  await memory.remember(member(),{...personal(),personal:{preferredName:'Ray',language:'ar',digestTime:'10:30'}});
  const context=await memory.context(member());expect(context.preferredName).toBe('Ray');expect(context.language).toBe('ar');expect(context.reasons.some(r=>r.reason==='Used memory: Call me Ray')).toBe(true);
  await memory.remember(member(),{...personal('Call me Bilal'),personal:{preferredName:'Bilal',language:'en'}});
  expect((await memory.context(member())).preferredName).toBe('Bilal');
});
it('English and Arabic are the only memory languages',async()=>{await expect(memory.remember(member(),{...personal(),personal:{language:'fr' as never}})).rejects.toThrow();});
it('Another person cannot read or edit personal memory',async()=>{
  const e=await memory.remember(member(),personal('Use short sentences'));
  expect((await memory.list(member(f.lead,f.ws,['delivery_lead']))).map(e=>e.id)).not.toContain(e.id);
  expect((await memory.context(member(f.lead,f.ws,['delivery_lead']))).entries.map(e=>e.id)).not.toContain(e.id);
  await expect(memory.change(member(f.lead,f.ws,['delivery_lead']),e.id,'edit','Use more detail')).rejects.toThrow();
});
it('Memory and learned context never cross workspaces',async()=>{
  const e=await memory.remember(member(),personal('Keep the report brief'));
  expect((await memory.list(member(b.admin,b.ws))).map(e=>e.id)).not.toContain(e.id);
  expect((await memory.context(member(b.admin,b.ws))).entries.map(e=>e.id)).not.toContain(e.id);
  await expect(memory.change(member(b.admin,b.ws),e.id,'delete')).rejects.toThrow();
  await expect(memory.list(member(f.admin,b.ws))).rejects.toThrow();
});
it('Edited memory is used next time and Undo restores its previous words',async()=>{
  const e=await memory.remember(member(),personal('Use short replies'));
  await memory.change(member(),e.id,'edit','Give more detail');expect((await memory.context(member())).entries.find(x=>x.id===e.id)?.text).toBe('Give more detail');
  await memory.change(member(),e.id,'undo');expect((await memory.context(member())).entries.find(x=>x.id===e.id)?.text).toBe('Use short replies');
});
it('Forget that removes context and Undo restores the entry',async()=>{
  const e=await memory.remember(member(),personal('Show the report in the morning'));
  await memory.change(member(),e.id,'delete');expect((await memory.context(member())).entries.map(e=>e.id)).not.toContain(e.id);
  await memory.change(member(),e.id,'undo');expect((await memory.context(member())).entries.map(e=>e.id)).toContain(e.id);
});
it('Undo of a learned name restores the previous personal preference',async()=>{
  const before=(await memory.context(member())).preferredName;
  const e=await memory.remember(member(),{...personal('Call me Omar'),personal:{preferredName:'Omar'}});
  await memory.change(member(),e.id,'undo');expect((await memory.context(member())).preferredName).toBe(before);
});
it('Client reviewers never receive company lessons or another personal history',async()=>{
  const e=await memory.remember(member(),{...company('Use one report each week'),kind:'decision'});
  expect((await memory.context(member(f.reviewer,f.ws,['client_reviewer']))).entries.map(e=>e.id)).not.toContain(e.id);
  await expect(memory.remember(member(f.reviewer,f.ws,['client_reviewer']),company())).rejects.toThrow();
});
it('Company memory is readable and editable by admins',async()=>{
  const e=await memory.remember(member(),{...company('Keep the weekly report'),kind:'decision'});
  expect((await memory.list(member())).map(e=>e.id)).toContain(e.id);
  expect((await memory.list(member(f.manager,f.ws,['account_manager']))).map(e=>e.id)).not.toContain(e.id);
  await memory.change(member(),e.id,'edit','Use a monthly report');expect((await memory.list(member())).find(x=>x.id===e.id)?.status).toBe('waiting_approval');
});
it('Forget everything needs confirmation and keeps name language and business records',async()=>{
  const before=await memory.context(member());
  await expect(memory.forgetPersonal(member(),false)).rejects.toThrow('Confirm');
  const runs=(await ctx.db.query('SELECT * FROM runs ORDER BY id')).rows;
  await memory.forgetPersonal(member(),true);const after=await memory.context(member());
  expect(after.preferredName).toBe(before.preferredName);expect(after.language).toBe(before.language);expect(after.entries.filter(e=>e.scope==='person')).toHaveLength(0);
  expect((await ctx.db.query('SELECT * FROM runs ORDER BY id')).rows).toEqual(runs);
});
it('Memory decisions preserve the audit chain',async()=>{expect((await verifyChain(ctx.db,f.ws)).ok).toBe(true);});
