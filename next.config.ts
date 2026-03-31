import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Serve public/index.html at the root URL
  async rewrites() {
    return [{ source: '/', destination: '/index.html' }];
  },
};

export default nextConfig;
