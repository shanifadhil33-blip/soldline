import 'server-only';
import { Pool } from '@neondatabase/serverless';
import { poolDriver, type TransactionDriver } from './withMember';
import { ownerServices } from './owner';
let services: ReturnType<typeof ownerServices> | undefined;
let app: TransactionDriver | undefined;
// Lazy construction only. Imports, builds and fixture tests never open a remote connection.
export function getOwnerServices() {
  if (!services) {
    if (!process.env.DATABASE_URL_OWNER) throw new Error('Owner database URL is required');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
    const driver = poolDriver({ async connect() {
      const connection = await pool.connect();
      return {
        query: connection.query.bind(connection),
        queryArrays: (sql: string, params?: unknown[]) => connection.query({ text: sql, values: params, rowMode: 'array' }),
        release: () => connection.release(),
      };
    } });
    services = ownerServices(driver);
  }
  return services;
}
export function getAppDriver(): TransactionDriver {
  if (!app) {
    if (!process.env.DATABASE_URL) throw new Error('App database URL is required');
    const driver = poolDriver(new Pool({ connectionString: process.env.DATABASE_URL }));
    app = { transaction: work => driver.transaction(async db => { await db.query('SET LOCAL ROLE soldline_app'); return work(db); }) };
  }
  return app;
}
