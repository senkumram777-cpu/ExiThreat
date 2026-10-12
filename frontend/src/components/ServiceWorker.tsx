'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker that next-pwa builds (public/sw.js). It is what makes the
 * site installable and lets it open, with an "offline" page, when there is no connection.
 *
 * next-pwa's own registration is switched off in next.config.js: it hooks into the Pages
 * Router's entry file, which this App Router site does not have, so it never ran.
 * There is no service worker in development (next-pwa is disabled there).
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Service worker registration failed:', err);
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
