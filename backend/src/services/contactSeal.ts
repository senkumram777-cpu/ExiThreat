/**
 * The contact secret (CONTACT_HASH_SECRET), and mobile numbers encrypted with a key derived from
 * it. Kept apart from contactService.ts, which needs the database, so that it can be tested
 * alone. See contactService.ts for what each is for.
 */

import crypto from 'crypto';

const hosted = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;

/**
 * The fingerprint key. A hosted server without a proper one cannot take sign-ups or contact
 * details (the endpoints answer 503) but still starts, so that existing accounts' sessions
 * and the rest of the site keep working while it is being set up.
 */
function readSecret(): string | null {
  const secret = process.env.CONTACT_HASH_SECRET ?? '';
  if (secret.length >= 32 && !secret.includes('change-me')) return secret;
  if (hosted) {
    console.error('CONTACT_HASH_SECRET is missing or shorter than 32 characters: sign-up is off.');
    return null;
  }
  console.warn('CONTACT_HASH_SECRET is not set: using a fixed value. Fine on this computer only.');
  return 'local-development-contact-secret-not-for-hosting';
}

export const CONTACT_SECRET = readSecret();

const SEAL_VERSION = 'v1';
const SEAL_KEY = CONTACT_SECRET
  ? Buffer.from(crypto.hkdfSync('sha256', CONTACT_SECRET, 'exithreat', 'contact-seal-v1', 32))
  : null;

/** An already normalised number, encrypted: "v1:" + base64 of IV(12) || ciphertext || tag(16). */
export function sealContact(normalized: string): string {
  if (!SEAL_KEY) throw new Error('CONTACT_HASH_SECRET is not set up');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SEAL_KEY, iv);
  const body = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  return `${SEAL_VERSION}:${Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64')}`;
}

/** The number in a sealed value, or null if there is none or it cannot be opened. */
export function openContact(sealed: string | null | undefined): string | null {
  if (!sealed || !SEAL_KEY || !sealed.startsWith(`${SEAL_VERSION}:`)) return null;
  try {
    const raw = Buffer.from(sealed.slice(SEAL_VERSION.length + 1), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', SEAL_KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
