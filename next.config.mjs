/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
    serverActions: { allowedOrigins: ['*'] },
  },
};

export default nextConfig;
