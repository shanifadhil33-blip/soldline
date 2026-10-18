import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  turbopack: {},
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com; object-src 'none'" },
      ],
    }];
  },
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
