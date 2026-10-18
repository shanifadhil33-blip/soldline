// Used only by the explicit local webpack fixture build. No external database or provider.
import { PGlite } from '@electric-sql/pglite';
import { setupServer } from 'msw/node';
import { migrate } from '@/server/db/migrate';
import { ownerServices } from '@/server/db/owner';
import type { TransactionDriver } from '@/server/db/withMember';

type FixtureState = { database: Promise<PGlite>; owner: ReturnType<typeof ownerServices>; app: TransactionDriver };
const holder = globalThis as typeof globalThis & { soldlineShellFixture?: FixtureState };
function runtime(): FixtureState {
  if (holder.soldlineShellFixture) return holder.soldlineShellFixture;
  const server = setupServer();
  server.listen({ onUnhandledRequest(request) {
    const url = new URL(request.url);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('External requests are forbidden in shell fixtures');
  } });
  const database = (async () => { const db = new PGlite(); await migrate(db); return db; })();
  const owner: TransactionDriver = { transaction: async work => (await database).transaction(work) };
  const app: TransactionDriver = { transaction: async work => (await database).transaction(async db => {
    await db.query('SET LOCAL ROLE soldline_app'); return work(db);
  }) };
  const state = { database, owner: ownerServices(owner), app };
  holder.soldlineShellFixture = state;
  return state;
}
export function getOwnerServices() { return runtime().owner; }
export function getAppDriver() { return runtime().app; }
