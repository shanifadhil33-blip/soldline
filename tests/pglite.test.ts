import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('Runs select 1 in a local database', async () => {
  const database = new PGlite();
  try {
    const result = await database.query('select 1 as value');
    expect(result.rows).toEqual([{ value: 1 }]);
  } finally {
    await database.close();
  }
}, 30_000);
