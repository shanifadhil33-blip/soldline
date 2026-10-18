import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, fixture, id } from './helpers/pglite';
import { notifyBlock, notificationStore } from '../src/server/notifications';
import { runMetrics } from '../src/server/metrics';
let ctx:Awaited<ReturnType<typeof createDatabase>>;
const f=fixture(1),now=Date.parse('2026-10-22T06:00:00Z');
beforeAll(async()=>{ctx=await createDatabase();},60000);
afterAll(async()=>{await ctx?.db.close();});
it('Real time notification is not sent to the actor',async()=>{
  await ctx.db.transaction(db=>notifyBlock(db,f.ws,{id:id(1,40),owner_member_id:f.admin,severity:'block',title:'Client input is missing'},f.admin));
  expect((await ctx.db.query("SELECT * FROM notifications WHERE kind='block'")).rows).toHaveLength(0);
});
it('Real time sends only assigned blocks and dedupes repeats',async()=>{
  for(const severity of ['warn','info']) await ctx.db.transaction(db=>notifyBlock(db,f.ws,{id:id(1,40),owner_member_id:f.admin,severity,title:'Review this input'}));
  await ctx.db.transaction(db=>notifyBlock(db,f.ws,{id:id(1,40),owner_member_id:null,severity:'block',title:'Review this input'}));
  expect((await ctx.db.query("SELECT * FROM notifications WHERE kind='block'")).rows).toHaveLength(0);
  for(let n=0;n<2;n++) await ctx.db.transaction(db=>notifyBlock(db,f.ws,{id:id(1,40),owner_member_id:f.admin,severity:'block',title:'Review this input'},f.lead));
  expect((await ctx.db.query("SELECT * FROM notifications WHERE kind='block'")).rows).toHaveLength(1);
});
it('Digest uses his local digest time and sends once per local day in his language',async()=>{
  await ctx.db.query("UPDATE members SET digest_time='10:00',language='ar' WHERE id=$1",[f.admin]);
  await ctx.db.query("UPDATE findings SET status='open',owner_member_id=$2 WHERE id=$1",[id(1,40),f.admin]);
  const store=notificationStore(ctx.db);await store.digest(f.ws,now-1000);
  expect((await ctx.db.query("SELECT * FROM notifications WHERE kind='digest'")).rows).toHaveLength(0);
  await store.digest(f.ws,now);await store.digest(f.ws,now+60000);
  const rows=(await ctx.db.query<{body:string}>("SELECT * FROM notifications WHERE kind='digest'")).rows;expect(rows).toHaveLength(1);expect(rows[0].body).toBe('لديك 1 أمور تحتاج إلى مراجعة');
});
it('Digest excludes his own actions',async()=>{
  await ctx.db.query('UPDATE findings SET evidence=$2 WHERE id=$1',[id(1,40),JSON.stringify({actor_member_id:f.admin})]);
  await notificationStore(ctx.db).digest(f.ws,now+86400000);
  expect((await ctx.db.query("SELECT * FROM notifications WHERE kind='digest'")).rows).toHaveLength(1);
});
it('Run metrics compute real elapsed hours and missing age from timestamps',async()=>{
  await ctx.db.query("UPDATE runs SET won_at=now()-interval '10 hours',ready_at=now()-interval '2 hours' WHERE id=$1",[f.runA]);
  await ctx.db.query("UPDATE onboarding_inputs SET requested_at=now()-interval '4 days' WHERE run_id=$1",[f.runA]);
  const row=(await runMetrics(ctx.db,f.ws)).find(r=>r.run_id===f.runA)!;expect(Number(row.won_to_ready_hours)).toBe(8);expect(Number(row.oldest_missing_input_days)).toBeGreaterThanOrEqual(4);expect(Number(row.oldest_missing_input_days)).toBeLessThan(4.01);
});
it('Metrics preserve unknown durations and isolate workspace reads under row security',async()=>{
  const rows=await ctx.asMember(f.admin,db=>runMetrics(db,fixture(2).ws));expect(rows).toHaveLength(0);
  const row=(await runMetrics(ctx.db,f.ws)).find(r=>r.run_id===f.runB)!;expect(row.won_to_ready_hours).toBeNull();expect(row.oldest_missing_input_days).toBeNull();
});
it('Commitments without owner count accepted items with no owned task',async()=>{
  await ctx.db.query("UPDATE scope_versions SET status='accepted' WHERE id=$1",[id(1,51)]);await ctx.db.query('UPDATE runs SET scope_version_id=$2 WHERE id=$1',[f.runA,id(1,51)]);
  expect(Number((await runMetrics(ctx.db,f.ws)).find(r=>r.run_id===f.runA)!.commitments_without_owner)).toBe(1);
  await ctx.db.query("UPDATE monitor_tasks SET scope_item_id=(SELECT id FROM scope_items WHERE scope_version_id=$2 LIMIT 1),assignee_ids=ARRAY['42'] WHERE workspace_id=$1",[f.ws,id(1,51)]);
  expect(Number((await runMetrics(ctx.db,f.ws)).find(r=>r.run_id===f.runA)!.commitments_without_owner)).toBe(0);
});
