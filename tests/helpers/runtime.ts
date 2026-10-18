import type { PGlite } from '@electric-sql/pglite';
import { ownerServices } from '../../src/server/db/owner';
import type { TransactionDriver } from '../../src/server/db/withMember';
export function fixtureRuntime(db: PGlite) {
  return {
    owner: ownerServices({ transaction: work => db.transaction(connection => work({
      query: (sql, params) => connection.query(sql, params),
      queryArrays: (sql, params) => connection.query<unknown[]>(sql, params, { rowMode: 'array' }),
    })) }),
    app: { transaction: work => db.transaction(async connection => {
      await connection.query('SET LOCAL ROLE soldline_app');
      return work(connection);
    }) } satisfies TransactionDriver,
  };
}
