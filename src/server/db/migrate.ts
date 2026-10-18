import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TransactionDriver } from './withMember';

/** The owner connection is used only for migrations. No connection is opened here. */
export async function migrate(driver: TransactionDriver, root = join(process.cwd(), 'drizzle')) {
  const generated = (await readdir(root)).filter((name) => name.endsWith('.sql')).sort();
  // Sorted manual files apply 0003_writes.sql after 0002_audit.sql.
  const manual = (await readdir(join(root, 'sql'))).filter((name) => name.endsWith('.sql')).sort().map((name) => join('sql', name));
  await driver.transaction(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(710182026)');
    await db.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await db.query('CREATE TABLE IF NOT EXISTS drizzle.migrations (name text PRIMARY KEY, hash text NOT NULL)');
    for (const name of [...generated, ...manual]) {
      const source = await readFile(join(root, name), 'utf8');
      const hash = createHash('sha256').update(source).digest('hex');
      const applied = await db.query<{ hash: string }>('SELECT hash FROM drizzle.migrations WHERE name = $1', [name]);
      if (applied.rows.length) {
        if (applied.rows[0].hash !== hash) throw new Error('Applied migration has changed');
        continue;
      }
      // Each generated statement is executed separately for drivers using the extended protocol.
      for (const statement of source.split('--> statement-breakpoint')) {
        if (statement.trim()) await db.query(statement);
      }
      await db.query('INSERT INTO drizzle.migrations (name, hash) VALUES ($1, $2)', [name, hash]);
    }
  });
}
