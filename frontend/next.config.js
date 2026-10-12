// next.config.js (CommonJS fallback used by next-pwa at build time)
// next-pwa's default rules, minus the one that keeps a copy of every response from another
// site for an hour. The API is on another site, so that rule stored API responses on the
// device, the unredacted first-look image among them, and could serve them back stale.
const runtimeCaching = require('next-pwa/cache').filter(
  (rule) => !(rule.options && rule.options.cacheName === 'cross-origin'),
);

const withPWA = require('next-pwa')({
  dest: 'public',
  runtimeCaching,
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
};

module.exports = withPWA(nextConfig);
