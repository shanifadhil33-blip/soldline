import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { 'server-only': new URL('./tests/helpers/serverOnly.ts', import.meta.url).pathname } },
  test: {
    environment: 'node',
    server: { deps: { inline: ['next-auth'] } },
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    setupFiles: ['./tests/setup.ts'],
  },
});
