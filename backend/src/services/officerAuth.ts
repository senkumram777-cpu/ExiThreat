/**
 * Officers are not ExiThreat users: their accounts and sign-in live in ProMic (functions/le.js),
 * and the officer page holds a ProMic session token. To show an officer the common page, this
 * server asks ProMic's `leWhoAmI` whose token it is, so that the session secret stays in ProMic
 * alone. The answer is remembered for a few minutes per token.
 */

import { createHash } from 'crypto';

const LE_BASE = process.env.PROMIC_LE_URL ?? 'https://asia-south1-promic-c5567.cloudfunctions.net';
const REMEMBER_MS = 5 * 60 * 1000;
const MAX_REMEMBERED = 1000;

const hosted = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;
// Lets the API test act as an officer without ProMic. Never honoured on the host.
const TEST_TOKENS = !hosted && process.env.LE_OFFICER_TEST === '1';
const TEST_PREFIX = 'test-officer:';

export interface Officer {
  id: string;
  branch: string;
}

const remembered = new Map<string, { officer: Officer; until: number }>();

/** The officer a ProMic session token belongs to, or null if it is not a valid, active one. */
export async function officerFor(token: string): Promise<Officer | null> {
  if (!token) return null;
  if (TEST_TOKENS && token.startsWith(TEST_PREFIX)) return { id: token.slice(TEST_PREFIX.length), branch: 'Test' };

  const key = createHash('sha256').update(token).digest('hex');
  const known = remembered.get(key);
  if (known && known.until > Date.now()) return known.officer;
  remembered.delete(key);

  try {
    const res = await fetch(`${LE_BASE}/leWhoAmI`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: unknown; branch?: unknown };
    if (typeof data.id !== 'string' || !data.id) return null;
    const officer = { id: data.id, branch: typeof data.branch === 'string' ? data.branch : '' };
    if (remembered.size >= MAX_REMEMBERED) remembered.clear();
    remembered.set(key, { officer, until: Date.now() + REMEMBER_MS });
    return officer;
  } catch (err) {
    console.error('Officer check failed:', err);
    return null;
  }
}
