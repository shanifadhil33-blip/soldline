import { afterAll, beforeAll, expect, it } from 'vitest';
import { append, verifyChain } from '../../src/server/audit';
import { createDatabase, fixture } from '../helpers/pglite';
let context: Awaited<ReturnType<typeof createDatabase>>;
const a = fixture(1), b = fixture(2);
beforeAll(async () => { context = await createDatabase(); },60000);
afterAll(async () => { await context?.db.close(); });
it.each(['INSERT INTO audit_log (workspace_id) VALUES ($1)', 'UPDATE audit_log SET action = \'changed\' WHERE workspace_id=$1','DELETE FROM audit_log WHERE workspace_id=$1'])('Refuses direct audit changes %s',async sql => {
  await expect(context.asMember(a.admin, db => db.query(sql,[a.ws]))).rejects.toThrow(/permission denied/);
});
it('Keeps separate workspace chains and recomputes the canonical hash in SQL',async () => {
  const first = await context.asMember(a.admin, db => append(db,a.ws,{action:'created',outcome:'succeeded',after:{name:'Adhil', unicode:'مرحبا'}}));
  await context.asMember(b.admin, db => append(db,b.ws,{action:'created',outcome:'allowed'}));
  const second = await context.asMember(a.admin, db => append(db,a.ws,{action:'checked',outcome:'allowed'}));
  expect(first).toBeLessThan(second);
  expect(await verifyChain(context.db,a.ws)).toEqual({ok:true,brokenAtId:null});
  expect(await verifyChain(context.db,b.ws)).toEqual({ok:true,brokenAtId:null});
  expect(await context.asMember(a.admin,db => verifyChain(db,a.ws))).toEqual({ok:true,brokenAtId:null});
  const hashes = await context.db.query<{ matches: boolean }>(`SELECT row_hash = encode(sha256(convert_to(coalesce(prev_hash,'') || audit_canonical(audit_log),'UTF8')),'hex') AS matches FROM audit_log`);
  expect(hashes.rows.every(row => row.matches)).toBe(true);
  await context.db.query("UPDATE audit_log SET action='tampered' WHERE id=$1",[first]);
  expect(await verifyChain(context.db,a.ws)).toEqual({ok:false,brokenAtId:first});
  expect(await verifyChain(context.db,b.ws)).toEqual({ok:true,brokenAtId:null});
});
it('Refuses appends to another workspace and hidden chain verification',async () => {
  await expect(context.asMember(a.admin,db => append(db,b.ws,{action:'created',outcome:'allowed'}))).rejects.toThrow('Workspace access refused');
  await expect(context.asMember(a.reviewer,db => verifyChain(db,a.ws))).rejects.toThrow('Audit access refused');
});
it('Uses fixed timestamp text and trusted actor details', async () => {
  await context.asMember(b.admin, async db => {
    await db.query("SET LOCAL timezone = 'Asia/Dubai'");
    const result = await db.query<{ id: number }>(`SELECT audit_append($1,$2::jsonb) AS id`,[b.ws,JSON.stringify({action:'checked',outcome:'allowed',actor_type:'system',actor_name_at_event:'Wrong',workspace_id:a.ws,prev_hash:'wrong',row_hash:'wrong'})]);
    const row = await db.query('SELECT actor_type,actor_member_id,actor_name_at_event,workspace_id FROM audit_log WHERE id=$1',[result.rows[0].id]);
    expect(row.rows).toEqual([{actor_type:'user',actor_member_id:b.admin,actor_name_at_event:'Adhil',workspace_id:b.ws}]);
    expect(await verifyChain(db,b.ws)).toEqual({ok:true,brokenAtId:null});
  });
});
