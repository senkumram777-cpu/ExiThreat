// next-pwa's default rules, minus the one that keeps a copy of every response from another
// site for an hour. The API is on another site, so that rule stored API responses on the
// device, the unredacted first-look image among them, and could serve them back stale.
const runtimeCaching = require('next-pwa/cache').filter(
  (rule) => !(rule.options && rule.options.cacheName === 'cross-origin'),
);

const withPWA = require('next-pwa')({
  dest: 'public',
  runtimeCaching,
  // Registered by src/components/ServiceWorker.tsx: next-pwa's own registration hooks into
  // the Pages Router's entry file, which this site does not have.
  register: false,
  // Shown when a page is opened with no connection (src/app/offline/page.tsx).
  fallbacks: { document: '/offline' },
  // Next.js lists this file in its build but does not serve it. The service worker stores
  // every listed file when it installs, and one missing file makes the whole install fail.
  buildExcludes: [/app-build-manifest\.json$/],
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
};

module.exports = withPWA(nextConfig);
