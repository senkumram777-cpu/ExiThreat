/**
 * The rules an admin can change on the admin page (settings.ts keeps their values): what each
 * one means, its limits and its default, some from the server's environment. Pure, so the unit
 * tests can load it.
 */

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export type RuleUnit = 'share' | 'hours' | 'count' | 'switch';

export interface RuleDef {
  label: string;
  help: string;
  unit: RuleUnit;
  min: number;
  max: number;
  default: number;
}

export const RULES = {
  pushThreshold: {
    label: 'Votes that move a post on',
    help: 'Share of a group\'s active members (at least the group minimum) whose Push votes move a post to new groups.',
    unit: 'share', min: 0.1, max: 1, default: 0.5,
  },
  listShare: {
    label: 'Common page: groups reached',
    help: 'A post goes on the common page once it has reached this share of the groups that can take it. Posts already on the page stay.',
    unit: 'share', min: 0.05, max: 1, default: 0.2,
  },
  maxGroupsAtOnce: {
    label: 'Most groups a post is in at once',
    help: 'Pushes place a post in at most this many groups at the same time.',
    unit: 'count', min: 1, max: 20, default: 5,
  },
  manualPushCooldownHours: {
    label: 'Author\'s push: hours between pushes',
    help: 'How long an author waits between two pushes of the same post.',
    unit: 'hours', min: 0, max: 720, default: 24,
  },
  groupMinMembers: {
    label: 'Smallest group that takes posts',
    help: 'Below this many members a group gets no posts, and a vote is measured against at least this many.',
    unit: 'count', min: 2, max: 500, default: envNumber('GROUP_MIN_MEMBERS', 5),
  },
  groupMaxMembers: {
    label: 'Largest group',
    help: 'No one new is added to a group with this many members; a new group is opened instead.',
    unit: 'count', min: 2, max: 5000, default: envNumber('GROUP_MAX_MEMBERS', 25),
  },
  registrationOpen: {
    label: 'New accounts',
    help: 'When off, no one can register; existing members are not affected.',
    unit: 'switch', min: 0, max: 1, default: 1,
  },
} satisfies Record<string, RuleDef>;

export type RuleKey = keyof typeof RULES;

export function isRuleKey(key: string): key is RuleKey {
  return Object.prototype.hasOwnProperty.call(RULES, key);
}

/**
 * Why `value` cannot be used for `key` given the other rules' values, or null if it can.
 * Counts and hours must be whole numbers, a switch 0 or 1, and the smallest group no larger
 * than the largest.
 */
export function ruleError(key: RuleKey, value: number, others: Record<RuleKey, number>): string | null {
  const def: RuleDef = RULES[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'A number is required.';
  if (value < def.min || value > def.max) return `Must be between ${def.min} and ${def.max}.`;
  if (def.unit !== 'share' && !Number.isInteger(value)) return 'Must be a whole number.';
  if (key === 'groupMinMembers' && value > others.groupMaxMembers) return 'Cannot be more than the largest group.';
  if (key === 'groupMaxMembers' && value < others.groupMinMembers) return 'Cannot be less than the smallest group that takes posts.';
  return null;
}
