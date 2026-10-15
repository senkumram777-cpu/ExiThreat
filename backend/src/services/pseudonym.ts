/**
 * Pseudonyms: the name shown with a member's posts, in groups and on the common page, so that
 * a post can be told apart by its author without saying who that is. Random, given once at
 * registration, and never shown next to the username.
 */

import { randomInt } from 'crypto';

// Letters and digits that are not mistaken for one another.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PSEUDONYM_PATTERN = /^Voice-[A-Z0-9]{8}$/;

export function randomPseudonym(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `Voice-${code}`;
}
