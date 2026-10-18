import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { Pool } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL_OWNER;
if (!url) throw new Error('Owner database address is required');
// Compile these dependency free modules in memory so Node 20 and Node 22 use the same runner.
async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { migrate } = await load('../src/server/db/migrate.ts');
const { poolDriver } = await load('../src/server/db/withMember.ts');
const pool = new Pool({ connectionString: url });
try {
  await migrate(poolDriver(pool));
} finally {
  await pool.end();
}
