import { seedHubSpot } from './lib/seed';
// Process environment only. No environment files are loaded.
seedHubSpot(process.env).then(ids => { console.log(JSON.stringify(ids, null, 2)); }).catch(() => {
  console.error('HubSpot seed stopped. Check confirmation, sandbox settings and confirmed paths.');
  process.exitCode = 1;
});
