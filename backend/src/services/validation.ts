/**
 * Size limits for what users send, checked on the server. The browser's own limits
 * (maxLength on the inputs) are a convenience and can be bypassed.
 */

export const LIMITS = {
  postMin: 20,
  postMax: 5000,
  commentMax: 500,
  chatMax: 1000,
  usernameMin: 3,
  usernameMax: 30,
  passwordMin: 8,
  // bcrypt ignores everything after 72 bytes, so a longer password would be misleading.
  passwordMax: 72,
};

export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

export type TextResult = { ok: true; text: string } | { ok: false; error: string };

/** Trims `value` and checks that it is text of an allowed length. */
export function readText(value: unknown, what: string, max: number, min = 1): TextResult {
  if (typeof value !== 'string') return { ok: false, error: `${what} required` };
  const text = value.trim();
  if (text.length < min) {
    return { ok: false, error: min > 1 ? `${what} must be at least ${min} characters` : `${what} required` };
  }
  if (text.length > max) return { ok: false, error: `${what} must be at most ${max} characters` };
  return { ok: true, text };
}

/** `null` when the password is acceptable, otherwise what is wrong with it. */
export function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < LIMITS.passwordMin) {
    return `password must be at least ${LIMITS.passwordMin} characters`;
  }
  if (Buffer.byteLength(value, 'utf8') > LIMITS.passwordMax) {
    return `password must be at most ${LIMITS.passwordMax} characters`;
  }
  return null;
}
