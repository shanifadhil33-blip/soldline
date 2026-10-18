import { seedClickUp } from './lib/seed';
// Process environment only. No environment files are loaded.
seedClickUp(process.env).then(ids => { console.log(JSON.stringify(ids, null, 2)); }).catch(() => {
  console.error('ClickUp seed stopped. Check confirmation and sandbox settings.');
  process.exitCode = 1;
});
