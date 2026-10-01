import type { NextConfig } from 'next';
// @ts-expect-error — next-pwa has no TS declaration
import withPWA from 'next-pwa';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost'],
  },
};

export default withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
})(nextConfig);
