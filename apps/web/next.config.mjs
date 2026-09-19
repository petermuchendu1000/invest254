/** @type {import('next').NextConfig} */

// Dedicated admin/operator domain(s). Visiting the ROOT of one of these hosts serves the unified
// operator sign-in (/console) instead of the player app, so admins have ONE branded entry point
// (Issue 1). Comma-separate to allow several; defaults to triocodes.com. www.<host> is covered too.
const ADMIN_HOSTS = (process.env.ADMIN_HOST || 'triocodes.com')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const nextConfig = {
  reactStrictMode: true,
  // @invest254/shared ships raw TypeScript (ESM with .js specifiers); let Next
  // transpile it and resolve the .js specifiers back to the .ts sources.
  transpilePackages: ['@invest254/shared'],
  async rewrites() {
    // Root of an admin host -> the operator console sign-in. Deeper paths (/platform, /admin, /console)
    // already render the operator surfaces, so only the root needs redirecting here.
    const beforeFiles = ADMIN_HOSTS.flatMap((host) => [
      { source: '/', has: [{ type: 'host', value: host }], destination: '/console' },
      { source: '/', has: [{ type: 'host', value: `www.${host}` }], destination: '/console' },
    ]);
    return { beforeFiles };
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
