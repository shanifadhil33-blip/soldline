import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export default function checkBuild() {
  const directory = path.resolve(__dirname, '../../.next/server/chunks');
  const fixture = readdirSync(directory).filter(file => file.endsWith('.js')).some(file => readFileSync(path.join(directory, file), 'utf8').includes('External requests are forbidden in shell fixtures'));
  if (!fixture) throw new Error('Build the local shell fixtures with SOLDLINE_SHELL_FIXTURES=1 and pnpm build --webpack before running browser tests. External databases are forbidden.');
}
