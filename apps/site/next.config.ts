import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@fxl-sales/shared-types',
    '@fxl-sales/shared-utils',
  ],
};

export default nextConfig;
