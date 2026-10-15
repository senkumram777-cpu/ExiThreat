/**
 * Group Service
 *
 * How people get into groups, where a post goes, and when a push forwards it on: a group's
 * votes, or its author. A push sends the post to several groups at once (forwarding.ts).
 *
 * Nobody chooses or creates a group: the server places each user in one at random, so that
 * nobody can put themselves in the group that reads a particular post. A group only receives
 * posts, and its votes only count, once it has GROUP_MIN_MEMBERS members.
 */

import { prisma } from '../index';
import { weightOf } from './weight';
import { recalculateGroupWeight } from './groupWeightService';
import { Candidate, MAX_GROUPS_AT_ONCE, chooseInCycle, reachFor } from './forwarding';
import { recalculateSpread } from './spreadService';

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

/** Below this a group gets no posts, and a vote is measured against at least this many. */
export const GROUP_MIN_MEMBERS = envNumber('GROUP_MIN_MEMBERS', 5);
/** No one is added to a group that has this many members. */
export const GROUP_MAX_MEMBERS = envNumber('GROUP_MAX_MEMBERS', 25);
/** New groups are opened until there are this many, so that posts have somewhere to move. */
const MIN_GROUPS = 3;
/** A member who has not opened the group for this long is left out of the vote count. */
const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
/** Share of the counted members whose votes move a post on. */
const PUSH_THRESHOLD = 0.5;

// Letters and digits that are not mistaken for one another.
const NAME_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomGroupName(): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += NAME_ALPHABET[Math.floor(Math.random() * NAME_ALPHABET.length)];
  return `Group ${code}`;
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Member count of every group, including groups with nobody in them. */
async function groupSizes(): Promise<Map<string, number>> {
  const [groups, counts] = await Promise.all([
    prisma.group.findMany({ select: { id: true } }),
    prisma.groupMember.groupBy({ by: ['groupId'], _count: { _all: true } }),
  ]);
  const sizes = new Map<string, number>(groups.map((g) => [g.id, 0]));
  for (const c of counts) sizes.set(c.groupId, c._count._all);
  return sizes;
}

/**
 * Makes sure the user is in a group and returns one they are in.
 *
 * A new member goes to a random group that has room, emptier groups being more likely. A new
 * group is opened when every group is full, or while there are fewer than MIN_GROUPS and the
 * existing ones have reached the minimum size.
 */
export async function ensureGroup(userId: string): Promise<string> {
  const existing = await prisma.groupMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: { groupId: true },
  });
  if (existing) return existing.groupId;

  const sizes = await groupSizes();
  const withRoom = [...sizes].filter(([, size]) => size < GROUP_MAX_MEMBERS);
  const allEstablished = [...sizes.values()].every((size) => size >= GROUP_MIN_MEMBERS);

  let groupId: string;
  if (withRoom.length === 0 || (sizes.size < MIN_GROUPS && allEstablished)) {
    groupId = (await prisma.group.create({ data: { name: randomGroupName() } })).id;
  } else {
    const total = withRoom.reduce((sum, [, size]) => sum + (GROUP_MAX_MEMBERS - size), 0);
    let ticket = Math.random() * total;
    groupId = withRoom[withRoom.length - 1][0];
    for (const [id, size] of withRoom) {
      ticket -= GROUP_MAX_MEMBERS - size;
      if (ticket < 0) {
        groupId = id;
        break;
      }
    }
  }

  // Two requests for the same new user at once would both get here; the second one keeps
  // whatever the first one wrote.
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId, userId } },
    create: { groupId, userId, lastSeenAt: new Date() },
    update: {},
  });

  // This member may be the one that makes the group big enough to receive posts. Posts that
  // have their votes but had nowhere to go can move now. Signing in does not wait for it.
  if ((sizes.get(groupId) ?? 0) + 1 === GROUP_MIN_MEMBERS) void sweepPushes();
  return groupId;
}

/** Notes that a member has just used their group. */
export async function touchMember(groupId: string, userId: string): Promise<void> {
  await prisma.groupMember.updateMany({ where: { groupId, userId }, data: { lastSeenAt: new Date() } });
}

/**
 * Picks the group a new post starts in: one with enough members that its author is not in.
 * `null` when there is no such group.
 */
export async function pickGroupForPost(authorId: string): Promise<string | null> {
  const [sizes, authorGroups] = await Promise.all([
    groupSizes(),
    prisma.groupMember.findMany({ where: { userId: authorId }, select: { groupId: true } }),
  ]);
  const authorIn = new Set(authorGroups.map((m) => m.groupId));
  const eligible = [...sizes]
    .filter(([id, size]) => size >= GROUP_MIN_MEMBERS && !authorIn.has(id))
    .map(([id]) => id);
  return eligible.length > 0 ? pickRandom(eligible) : null;
}

export interface VoteTally {
  voteCount: number;
  /** The number the votes are measured against. */
  totalMembers: number;
  pushPercentage: number;
  thresholdReached: boolean;
}

/**
 * Counts a post's votes in one of the groups it is in. They are measured against the members
 * who have used that group lately, leaving the author out, and never against fewer than
 * GROUP_MIN_MEMBERS, so a handful of people cannot move a post on their own.
 */
export async function voteTally(post: { id: string; ocUserId: string }, groupId: string): Promise<VoteTally> {
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const [voteCount, activeMembers] = await Promise.all([
    prisma.pushVote.count({ where: { postId: post.id, groupId } }),
    prisma.groupMember.count({
      where: {
        groupId,
        userId: { not: post.ocUserId },
        // Members from before `lastSeenAt` existed are judged by when they joined.
        OR: [{ lastSeenAt: { gte: activeSince } }, { lastSeenAt: null, joinedAt: { gte: activeSince } }],
      },
    }),
  ]);
  const totalMembers = Math.max(activeMembers, GROUP_MIN_MEMBERS);
  const share = Math.min(voteCount / totalMembers, 1);
  return {
    voteCount,
    totalMembers,
    pushPercentage: share * 100,
    thresholdReached: share >= PUSH_THRESHOLD,
  };
}

/**
 * The groups a post could be forwarded to now, with their weights: enough members, author not
 * in them, and the post not already in them (nor in `leaving`, the group pushing it on).
 * `visited` marks the groups it has reached in the current cycle.
 */
async function forwardCandidates(
  post: { id: string; ocUserId: string },
  leaving: string | null,
): Promise<{ candidates: Candidate[]; placed: Array<{ groupId: string; weight: number }> }> {
  const cycle = await prisma.post.findUniqueOrThrow({
    where: { id: post.id },
    select: { cycleStartedAt: true, createdAt: true },
  });
  const since = { arrivedAt: { gte: cycle.cycleStartedAt ?? cycle.createdAt } };
  const [sizes, groups, authorGroups, history, placements] = await Promise.all([
    groupSizes(),
    prisma.group.findMany({ select: { id: true, trustScore: true } }),
    prisma.groupMember.findMany({ where: { userId: post.ocUserId }, select: { groupId: true } }),
    prisma.postHistory.findMany({ where: { postId: post.id, ...since }, select: { groupId: true } }),
    prisma.postPlacement.findMany({ where: { postId: post.id }, select: { groupId: true } }),
  ]);
  const weights = new Map(groups.map((g) => [g.id, g.trustScore]));
  const authorIn = new Set(authorGroups.map((m) => m.groupId));
  // Reached in this cycle: groups it has left, and the one pushing it on now.
  const visited = new Set(history.map((h) => h.groupId));
  const placedIn = new Set(placements.map((p) => p.groupId));

  const candidates = [...sizes]
    .filter(([id, size]) => size >= GROUP_MIN_MEMBERS && !authorIn.has(id) && !placedIn.has(id) && id !== leaving)
    .map(([id]) => ({ id, weight: weights.get(id) ?? 0, visited: visited.has(id) || id === leaving }));
  const placed = placements
    .filter((p) => p.groupId !== leaving)
    .map((p) => ({ groupId: p.groupId, weight: weights.get(p.groupId) ?? 0 }));
  return { candidates, placed };
}

/** `moved`: it left the group. `waiting`: it has the votes but no group can take it yet. */
export type PushOutcome = 'moved' | 'waiting' | 'below';

export interface PushResult {
  tally: VoteTally;
  outcome: PushOutcome;
  /** The groups it was forwarded to (empty unless this call forwarded it). */
  destinations: string[];
}

/**
 * Counts a post's votes in one of its groups and, if they have reached the threshold, forwards
 * it from that group to as many groups as the group's weight allows (see forwarding.ts).
 * Called when a vote is cast, and by sweepPushes for the cases no vote announces.
 */
export async function pushIfReady(post: { id: string; ocUserId: string }, groupId: string): Promise<PushResult> {
  const tally = await voteTally(post, groupId);
  if (!tally.thresholdReached) return { tally, outcome: 'below', destinations: [] };

  // The weight that decides the reach is the pushing group's, as of now.
  const groupWeight = await recalculateGroupWeight(groupId);
  const { candidates, placed } = await forwardCandidates(post, groupId);
  // Leaving this group frees a place, so there is always room for at least one.
  const count = Math.min(reachFor(groupWeight), MAX_GROUPS_AT_ONCE - placed.length);
  const { destinations, newCycle } = chooseInCycle(candidates, count, groupWeight);
  if (destinations.length === 0) return { tally, outcome: 'waiting', destinations: [] };

  const sent = await forwardFromGroup(post.id, groupId, destinations, tally.pushPercentage, newCycle);
  if (sent.length > 0) {
    console.log(`Post ${post.id} pushed on with ${tally.pushPercentage.toFixed(1)}% of the votes to ${sent.length} group(s)`);
    await recalculateSpread(post.id);
  }
  // Nothing sent means another request forwarded it from this group first: it has left either way.
  return { tally, outcome: 'moved', destinations: sent };
}

/**
 * The group's push: the post leaves `fromGroupId` (recorded in its history with the vote
 * share, that group's votes cleared) and is placed in `destinations`. Returns the groups it
 * was placed in; empty, changing nothing, if the post was no longer in `fromGroupId`.
 */
async function forwardFromGroup(
  postId: string,
  fromGroupId: string,
  destinations: string[],
  pushPercentage: number,
  newCycle: boolean,
): Promise<string[]> {
  const sent = await prisma.$transaction(async (tx) => {
    const placement = await tx.postPlacement.findUnique({
      where: { postId_groupId: { postId, groupId: fromGroupId } },
    });
    if (!placement) return [];
    const claimed = await tx.postPlacement.deleteMany({ where: { id: placement.id } });
    if (claimed.count === 0) return [];
    await tx.postHistory.create({
      data: {
        postId,
        groupId: fromGroupId,
        arrivedAt: placement.arrivedAt,
        arrivedBy: placement.arrivedBy,
        fromGroupId: placement.fromGroupId,
        pushPercentage,
        wasManualPush: false,
      },
    });
    await tx.pushVote.deleteMany({ where: { postId, groupId: fromGroupId } });
    // The weight changes with the history, in the same step, so nobody sees one without the other.
    const history = await tx.postHistory.findMany({
      where: { postId },
      orderBy: { movedAt: 'asc' },
      select: { groupId: true, pushPercentage: true, wasManualPush: true },
    });
    const now = new Date();
    await tx.post.update({
      where: { id: postId },
      data: { totalWeight: weightOf(history), ...(newCycle ? { cycleStartedAt: now, cycle: { increment: 1 } } : {}) },
    });
    return placeIn(tx, postId, destinations, { arrivedBy: 'group', fromGroupId }, now);
  });
  return sent;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Who sent the post to a group: a group's votes (from which group) or its author. */
type Arrival = { arrivedBy: 'group'; fromGroupId: string } | { arrivedBy: 'author'; fromGroupId: null };

/**
 * Places the post in as many of `destinations` as the limit still allows (another push may
 * have added groups since they were chosen), in order. Returns the ones it was placed in.
 */
async function placeIn(tx: Tx, postId: string, destinations: string[], arrival: Arrival, at: Date): Promise<string[]> {
  const already = await tx.postPlacement.findMany({ where: { postId }, select: { groupId: true } });
  const inNow = new Set(already.map((p) => p.groupId));
  const room = MAX_GROUPS_AT_ONCE - inNow.size;
  const chosen = destinations.filter((id) => !inNow.has(id)).slice(0, Math.max(0, room));
  if (chosen.length > 0) {
    await tx.postPlacement.createMany({
      data: chosen.map((groupId) => ({ postId, groupId, arrivedAt: at, ...arrival })),
      skipDuplicates: true,
    });
  }
  return chosen;
}

export type ManualPushResult =
  | { ok: true; destinations: string[] }
  | { ok: false; status: number; error: string; remainingMs?: number };

export const MANUAL_PUSH_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * The author's push: the post stays in the groups it is in and is also placed in as many new
 * groups as the author's weightage allows. Once per MANUAL_PUSH_COOLDOWN_MS; adds no weight
 * and clears no votes.
 */
export async function forwardByAuthor(
  post: { id: string; ocUserId: string; lastManualPushAt: Date | null },
  authorWeight: number,
): Promise<ManualPushResult> {
  const now = Date.now();
  if (post.lastManualPushAt && now - post.lastManualPushAt.getTime() < MANUAL_PUSH_COOLDOWN_MS) {
    const remainingMs = MANUAL_PUSH_COOLDOWN_MS - (now - post.lastManualPushAt.getTime());
    return {
      ok: false,
      status: 429,
      error: `Manual push on cooldown. Try again in ${Math.ceil(remainingMs / 3_600_000)} hour(s).`,
      remainingMs,
    };
  }

  const { candidates, placed } = await forwardCandidates(post, null);
  const room = MAX_GROUPS_AT_ONCE - placed.length;
  if (room <= 0) {
    return { ok: false, status: 409, error: `Your post is already in ${MAX_GROUPS_AT_ONCE} groups, the most at once.` };
  }
  // "Better weighted" than the best group the post is in now.
  const best = placed.reduce((max, p) => Math.max(max, p.weight), 0);
  const { destinations, newCycle } = chooseInCycle(candidates, Math.min(reachFor(authorWeight), room), best);
  if (destinations.length === 0) {
    return { ok: false, status: 503, error: 'No other group with enough members is available yet' };
  }

  const sent = await prisma.$transaction(async (tx) => {
    // Claims this 24 hours' push; a second request at the same moment finds it taken.
    const claimed = await tx.post.updateMany({
      where: {
        id: post.id,
        OR: [{ lastManualPushAt: null }, { lastManualPushAt: { lt: new Date(now - MANUAL_PUSH_COOLDOWN_MS) } }],
      },
      data: {
        lastManualPushAt: new Date(now),
        ...(newCycle ? { cycleStartedAt: new Date(now), cycle: { increment: 1 } } : {}),
      },
    });
    if (claimed.count === 0) return null;
    return placeIn(tx, post.id, destinations, { arrivedBy: 'author', fromGroupId: null }, new Date(now));
  });
  if (sent === null) return { ok: false, status: 409, error: 'The post has just been pushed' };
  await recalculateSpread(post.id);
  return { ok: true, destinations: sent };
}

let sweeping = false;
let sweepAgain = false;

/**
 * Checks every post that has votes, in each group that has voted. A vote is checked as it is
 * cast, so this is only for what changes without one: members going inactive (fewer votes are
 * then needed), a group becoming big enough to take a post that was waiting, and a server
 * that stopped between a vote and the push. Returns how many pushes it made.
 */
export async function sweepPushes(): Promise<number> {
  // One at a time. A request that arrives during a sweep makes it run once more afterwards,
  // so that posts it had already passed are looked at again.
  if (sweeping) {
    sweepAgain = true;
    return 0;
  }
  sweeping = true;
  let moved = 0;
  try {
    do {
      sweepAgain = false;
      const voted = await prisma.pushVote.groupBy({ by: ['postId', 'groupId'] });
      for (const { postId, groupId } of voted) {
        const [post, placement] = await Promise.all([
          prisma.post.findUnique({ where: { id: postId }, select: { id: true, ocUserId: true } }),
          prisma.postPlacement.findUnique({ where: { postId_groupId: { postId, groupId } }, select: { id: true } }),
        ]);
        if (!post) continue;
        if (!placement) {
          // A vote that arrived just as the post left that group.
          await prisma.pushVote.deleteMany({ where: { postId, groupId } });
          continue;
        }
        if ((await pushIfReady(post, groupId)).outcome === 'moved') moved++;
      }
    } while (sweepAgain);
  } catch (err) {
    console.error('Push sweep failed:', err);
  } finally {
    sweeping = false;
  }
  return moved;
}
