import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  turbopack: {},
  serverExternalPackages: ['@electric-sql/pglite'],
  webpack(config, { webpack }) {
    // Explicit local browser fixture build only. Ordinary builds keep the real runtime.
    if (process.env.SOLDLINE_SHELL_FIXTURES === '1') {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /runtime/,
        (resource: { createData?: { resource: string } }) => {
          if (resource.createData?.resource === path.resolve('src/server/db/runtime.ts')) {
            resource.createData.resource = path.resolve('e2e/fixtures/runtime.ts');
          }
        },
      ));
    }
    return config;
  },
};
export default config;
