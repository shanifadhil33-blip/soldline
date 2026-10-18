import { expect, it } from 'vitest';
import { poolDriver, withMember, type SqlConnection } from '../../src/server/db/withMember';

it.each([false,true])('Reserves a production connection and clears it after failure is %s', async fail => {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const connection: SqlConnection & { release(): void } = {
    async query(sql,params) { calls.push({sql,params}); return {rows:[]}; },
    release() { calls.push({sql:'release'}); },
  };
  const driver = poolDriver({async connect() { return connection; }});
  const work = withMember(driver,'member',async db => {
    await db.query('SELECT 1');
    if (fail) throw new Error('Stop');
    return 1;
  });
  if (fail) await expect(work).rejects.toThrow('Stop');
  else await expect(work).resolves.toBe(1);
  expect(calls).toEqual([
    {sql:'BEGIN'},
    {sql:"SELECT set_config('app.member_id', $1, true)",params:['member']},
    {sql:'SELECT 1',params:undefined},
    {sql:fail ? 'ROLLBACK':'COMMIT'},
    {sql:'release'},
  ]);
});
