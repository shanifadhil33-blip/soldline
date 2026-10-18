// Used only by the explicit local webpack fixture build. No external database or provider.
import { PGlite } from '@electric-sql/pglite';
import { setupServer } from 'msw/node';
import { coreHandlers,prepareCore } from '@/../e2e/fixtures/core';
import { migrate } from '@/server/db/migrate';
import { ownerServices } from '@/server/db/owner';
import type { TransactionDriver } from '@/server/db/withMember';

type FixtureState = { database: Promise<PGlite>; owner: ReturnType<typeof ownerServices>; app: TransactionDriver };
const holder = globalThis as typeof globalThis & { soldlineShellFixture?: FixtureState };
function runtime(): FixtureState {
  if (holder.soldlineShellFixture) return holder.soldlineShellFixture;
  const server = setupServer(...coreHandlers);
  server.listen({ onUnhandledRequest(request) {
    const url = new URL(request.url);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('External requests are forbidden in shell fixtures');
  } });
  const database = (async () => { const db = new PGlite(); await migrate(db); return db; })();
  const owner: TransactionDriver = { transaction: async work => (await database).transaction(work) };
  const app: TransactionDriver = { transaction: async work => (await database).transaction(async db => {
    await db.query('SET LOCAL ROLE soldline_app'); return work(db);
  }) };
  const services=ownerServices(owner);
  const start=services.demo.start;
  const prepared=new Set<string>();
  services.demo.start=async(...args)=>{
    const ticket=await start(...args);
    if(!prepared.has(ticket.sandbox)) {await prepareCore(owner,services,ticket.sandbox);prepared.add(ticket.sandbox);}
    return ticket;
  };
  const state = { database, owner: services, app };
  holder.soldlineShellFixture = state;
  return state;
}
export function getOwnerServices() { return runtime().owner; }
export function getAppDriver() { return runtime().app; }
