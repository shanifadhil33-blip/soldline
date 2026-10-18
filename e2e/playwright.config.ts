import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  globalSetup: './fixtures/check-build.ts',
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: {
    command: 'export PATH=/home/box/.local/node22/bin:$PATH\nnode --version\npnpm --dir .. start --hostname 127.0.0.1',
    env: { DEMO_SIGNING_KEY: 'local shell fixture signing key only', AUTH_SECRET: 'local shell fixture auth secret only' },
    timeout: 120000,
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: false,
  },
});
