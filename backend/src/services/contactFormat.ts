/**
 * How email addresses and mobile numbers are written down before their fingerprint is taken
 * (see contactService.ts). No database here, so the unit tests can load it.
 */

export type Channel = 'email' | 'phone';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Lower case, without a "+tag", and for Gmail without dots: all of these reach the same
 * inbox, so they must count as one address. `null` if it is not an email address.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (value.length > 254 || !EMAIL_PATTERN.test(value)) return null;
  const at = value.lastIndexOf('@');
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  local = local.split('+')[0];
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return null;
  return `${local}@${domain}`;
}

/**
 * An Indian mobile number as 91 followed by its 10 digits, however it was written
 * ("+91 98765 43210", "098765-43210", "9876543210"). `null` if it is not one.
 */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string' || /[A-Za-z@]/.test(raw)) return null;
  let digits = raw.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(digits)) return null;
  digits = digits.replace(/^\+/, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return `91${digits}`;
}

export function normalize(channel: Channel, raw: unknown): string | null {
  return channel === 'email' ? normalizeEmail(raw) : normalizePhone(raw);
}
