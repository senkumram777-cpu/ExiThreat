/**
 * Rules an admin can change on the admin page without a redeploy. Each has a default (some
 * from the server's environment) and limits; a changed value is stored in `Setting` and kept
 * here in memory, so reading a rule costs nothing. The server runs on one machine, so the
 * copy in memory is always the latest; it is loaded at start (index.ts).
 */

import { prisma } from '../index';
import { RULES, RuleKey, isRuleKey, ruleError } from './rules';

export { RULES, isRuleKey, ruleError };
export type { RuleKey };

const current = Object.fromEntries(
  (Object.keys(RULES) as RuleKey[]).map((key) => [key, RULES[key].default]),
) as Record<RuleKey, number>;

/** The rule's value now. */
export function rule(key: RuleKey): number {
  return current[key];
}

export function allRules(): Record<RuleKey, number> {
  return { ...current };
}

/** Reads the changed rules from the database. A stored value that is no longer valid is ignored. */
export async function loadRules(): Promise<void> {
  const rows = await prisma.setting.findMany();
  // All stored values first, then each checked against the others.
  const next = { ...current };
  for (const row of rows) if (isRuleKey(row.key)) next[row.key] = row.value;
  for (const key of Object.keys(RULES) as RuleKey[]) {
    if (ruleError(key, next[key], next) !== null) next[key] = RULES[key].default;
  }
  Object.assign(current, next);
}

/** Stores a new value; the caller has checked it with ruleError. Returns the old value. */
export async function setRule(key: RuleKey, value: number, by: string): Promise<number> {
  const old = current[key];
  await prisma.setting.upsert({
    where: { key },
    create: { key, value, updatedBy: by },
    update: { value, updatedBy: by },
  });
  current[key] = value;
  return old;
}
