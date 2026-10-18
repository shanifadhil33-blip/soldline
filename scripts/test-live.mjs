import { spawnSync } from 'node:child_process';
if(process.env.LIVE_SANDBOX!=='1') {
  process.stderr.write('Select live sandbox mode explicitly with LIVE_SANDBOX=1\n');
  process.exit(1);
}
const result=spawnSync('pnpm',['exec','vitest','run','tests/backend-gate.test.ts','--reporter=verbose'],{stdio:'inherit',env:process.env});
process.exit(result.status??1);
