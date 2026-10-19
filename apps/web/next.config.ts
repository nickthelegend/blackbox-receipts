import type { NextConfig } from 'next';

const nextConfig: NextConfig = { transpilePackages: ['@blackbox/receipts', '@blackbox/proxy'] };
export default nextConfig;
