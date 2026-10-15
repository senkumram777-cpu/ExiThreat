'use client';

/**
 * The rules the website mentions in its text, as an admin has set them on the admin page
 * (GET /api/rules). Until they arrive, and if they cannot be fetched, the defaults are shown.
 */

import { useEffect, useState } from 'react';
import { BASE } from './api';

export interface Rules {
  pushThreshold: number;
  listShare: number;
  maxGroupsAtOnce: number;
  manualPushCooldownHours: number;
  registrationOpen: boolean;
}

export const DEFAULT_RULES: Rules = {
  pushThreshold: 0.5,
  listShare: 0.2,
  maxGroupsAtOnce: 5,
  manualPushCooldownHours: 24,
  registrationOpen: true,
};

let loading: Promise<Rules> | null = null;

function fetchRules(): Promise<Rules> {
  loading ??= fetch(`${BASE}/rules`)
    .then((res) => (res.ok ? res.json() : DEFAULT_RULES))
    .then((rules: Rules) => ({ ...DEFAULT_RULES, ...rules }))
    .catch(() => {
      loading = null;
      return DEFAULT_RULES;
    });
  return loading;
}

export function useRules(): Rules {
  const [rules, setRules] = useState(DEFAULT_RULES);
  useEffect(() => {
    let live = true;
    fetchRules().then((r) => {
      if (live) setRules(r);
    });
    return () => {
      live = false;
    };
  }, []);
  return rules;
}

/** 0.2 → "20%". */
export function pct(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}
