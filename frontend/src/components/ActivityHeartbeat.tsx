'use client';

import { useEffect } from 'react';
import { auth } from '@/lib/api';
import { getSession } from '@/lib/session';

const INTERVAL_MS = 60_000;

/**
 * While a signed-in member has ExiThreat open and in view, tells the server once a minute how
 * long they have been here, for their weightage. Time with the tab hidden or the phone locked
 * does not count.
 */
export default function ActivityHeartbeat() {
  useEffect(() => {
    let since = Date.now();
    const visible = () => document.visibilityState === 'visible';

    const report = () => {
      const now = Date.now();
      const seconds = Math.round((now - since) / 1000);
      since = now;
      if (seconds > 0 && getSession()) auth.heartbeat(Math.min(seconds, 120)).catch(() => {});
    };
    const timer = setInterval(() => {
      if (visible()) report();
      else since = Date.now();
    }, INTERVAL_MS);
    // Hidden: report what was spent so far. Shown again: start counting from now.
    const onVisibility = () => {
      if (visible()) since = Date.now();
      else report();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
