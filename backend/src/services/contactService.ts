/**
 * Email addresses and mobile numbers: one account per email and per mobile number.
 *
 * Neither is ever stored. The database keeps only a fingerprint, a keyed one-way hash
 * (HMAC-SHA256 with CONTACT_HASH_SECRET) of the normalised value. That is enough to refuse a
 * second sign-up, to sign in, and to find the account for a password reset, but the address
 * or number cannot be read back from it. Losing or changing CONTACT_HASH_SECRET makes every
 * stored fingerprint useless, so it must never change once accounts exist.
 *
 * Owning an address or number is proved with a 6-digit code. Email codes are made and sent
 * here; mobile numbers are confirmed by Firebase Phone Authentication in the browser and
 * recorded through phoneVerification.ts. Either way the proof is a ContactVerification row,
 * used once: by sign-up, by adding contact details to an older account, or by a reset.
 */

import crypto from 'crypto';
import { prisma } from '../index';
import { DeliveryUnavailable, sendEmailCode } from './delivery';
import { Channel, normalize } from './contactFormat';

export type { Channel } from './contactFormat';
export { normalize, normalizeEmail, normalizePhone } from './contactFormat';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_WRONG_CODES = 5;
const RESEND_AFTER_MS = (Number(process.env.CODE_RESEND_SECONDS) || 60) * 1000;
const MAX_SENDS_PER_DAY = 5;
/** A confirmed address or number must be used within this time. */
const PROOF_TTL_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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

const SECRET = readSecret();

export class ContactError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const NOT_SET_UP = 'Sign-up and contact details are not set up on this server yet. Please try again later.';

// ── Fingerprints ─────────────────────────────────────────────────────────

function hmac(text: string): string {
  if (!SECRET) throw new ContactError(503, NOT_SET_UP);
  return crypto.createHmac('sha256', SECRET).update(text).digest('hex');
}

/** The fingerprint of an already normalised address or number. */
export function fingerprint(channel: Channel, normalized: string): string {
  return hmac(`${channel}:${normalized}`);
}

/** The fingerprint of what someone typed, or `null` if it is not a valid one (or no key). */
export function fingerprintOf(channel: Channel, raw: unknown): string | null {
  const value = normalize(channel, raw);
  if (!value || !SECRET) return null;
  return fingerprint(channel, value);
}

function codeHash(targetHash: string, code: string): string {
  return hmac(`code:${targetHash}:${code}`);
}

// ── Codes ────────────────────────────────────────────────────────────────

export const CHANNEL_NAMES: Record<Channel, string> = { email: 'email address', phone: 'mobile number' };

/**
 * Sends a code to an email address and returns the id of the verification. The answer is
 * the same whether or not an account already uses the address, so that only its owner finds
 * out.
 */
export async function startEmailVerification(raw: unknown): Promise<{ verificationId: string }> {
  const channel: Channel = 'email';
  const value = normalize(channel, raw);
  if (!value) throw new ContactError(400, 'Enter a valid email address');
  const targetHash = fingerprint(channel, value);
  const now = Date.now();

  await prisma.contactVerification.deleteMany({ where: { createdAt: { lt: new Date(now - DAY_MS) } } });
  const recent = await prisma.contactVerification.findMany({
    where: { targetHash },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (recent[0] && now - recent[0].createdAt.getTime() < RESEND_AFTER_MS) {
    const wait = Math.ceil((RESEND_AFTER_MS - (now - recent[0].createdAt.getTime())) / 1000);
    throw new ContactError(429, `A code was just sent. You can ask for another in ${wait} seconds.`);
  }
  if (recent.length >= MAX_SENDS_PER_DAY) {
    throw new ContactError(429, `Too many codes sent to this ${CHANNEL_NAMES[channel]} today. Try again tomorrow.`);
  }

  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const record = await prisma.contactVerification.create({
    data: { channel, targetHash, codeHash: codeHash(targetHash, code), expiresAt: new Date(now + CODE_TTL_MS) },
    select: { id: true },
  });
  try {
    await sendEmailCode(String(raw).trim(), code, record.id);
  } catch (err) {
    // Not counted against the daily limit: nothing reached the user.
    await prisma.contactVerification.delete({ where: { id: record.id } });
    if (err instanceof DeliveryUnavailable) throw new ContactError(503, NOT_SET_UP);
    console.error(`Sending the ${channel} code failed:`, err);
    throw new ContactError(502, `The code could not be sent to this ${CHANNEL_NAMES[channel]}. Please try again.`);
  }
  return { verificationId: record.id };
}

/** Records that a mobile number has just been confirmed (by Firebase); returns the proof's id. */
export async function recordPhoneProof(normalized: string): Promise<string> {
  const now = Date.now();
  const record = await prisma.contactVerification.create({
    data: {
      channel: 'phone',
      targetHash: fingerprint('phone', normalized),
      codeHash: 'firebase',
      expiresAt: new Date(now + PROOF_TTL_MS),
      verifiedAt: new Date(now),
    },
    select: { id: true },
  });
  return record.id;
}

/** Checks a code. After MAX_WRONG_CODES wrong ones the verification is used up. */
export async function checkCode(verificationId: unknown, code: unknown): Promise<void> {
  if (typeof verificationId !== 'string' || typeof code !== 'string') {
    throw new ContactError(400, 'verificationId and code required');
  }
  const record = await prisma.contactVerification.findUnique({ where: { id: verificationId } }).catch(() => null);
  if (!record || record.expiresAt.getTime() < Date.now() || record.attempts >= MAX_WRONG_CODES) {
    throw new ContactError(410, 'This code has expired. Ask for a new one.');
  }
  if (record.verifiedAt) return;

  const given = Buffer.from(codeHash(record.targetHash, code.trim()));
  const expected = Buffer.from(record.codeHash);
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) {
    await prisma.contactVerification.update({ where: { id: record.id }, data: { verifiedAt: new Date() } });
    return;
  }
  const updated = await prisma.contactVerification.update({
    where: { id: record.id },
    data: { attempts: { increment: 1 } },
    select: { attempts: true },
  });
  const left = MAX_WRONG_CODES - updated.attempts;
  throw new ContactError(400, left > 0
    ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`
    : 'Wrong code. This code is now used up: ask for a new one.');
}

/**
 * The fingerprint a confirmed verification proves, or an error. Does not use it up; call
 * `consumeProofs` once the action it was for has succeeded.
 */
export async function proofOf(channel: Channel, verificationId: unknown): Promise<string> {
  const missing = new ContactError(400, `Confirm your ${CHANNEL_NAMES[channel]} with the code first`);
  if (typeof verificationId !== 'string' || !verificationId) throw missing;
  const record = await prisma.contactVerification.findUnique({ where: { id: verificationId } }).catch(() => null);
  if (!record || record.channel !== channel || !record.verifiedAt) throw missing;
  if (Date.now() - record.verifiedAt.getTime() > PROOF_TTL_MS) {
    throw new ContactError(410, `Your ${CHANNEL_NAMES[channel]} was confirmed too long ago. Confirm it again.`);
  }
  return record.targetHash;
}

export async function consumeProofs(...ids: Array<string | undefined>): Promise<void> {
  const list = ids.filter((id): id is string => typeof id === 'string');
  if (list.length > 0) await prisma.contactVerification.deleteMany({ where: { id: { in: list } } });
}

/** Refuses an address or number that another account already uses. */
export async function assertUnused(channel: Channel, hash: string, exceptUserId?: string): Promise<void> {
  const owner = await prisma.user.findFirst({
    where: channel === 'email' ? { emailHash: hash } : { phoneHash: hash },
    select: { id: true },
  });
  if (owner && owner.id !== exceptUserId) {
    throw new ContactError(409, `This ${CHANNEL_NAMES[channel]} is already used by another account. `
      + 'Each email address and mobile number can have only one account.');
  }
}
