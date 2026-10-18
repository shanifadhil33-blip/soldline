import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: {
    command: 'pnpm --dir .. start --hostname 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
  },
});
