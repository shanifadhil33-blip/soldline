import { spawnSync } from 'node:child_process';
if(process.env.LIVE_SANDBOX!=='1') {
  process.stderr.write('Bilal must select live sandbox mode explicitly\n');
  process.exit(1);
}
const result=spawnSync('pnpm',['exec','vitest','run','tests/backend-gate.test.ts','--reporter=verbose'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
