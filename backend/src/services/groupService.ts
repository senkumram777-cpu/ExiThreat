/**
 * Group Service
 *
 * How people get into groups, where a post goes, and when a group's votes move it on.
 *
 * Nobody chooses or creates a group: the server places each user in one at random, so that
 * nobody can put themselves in the group that reads a particular post. A group only receives
 * posts, and its votes only count, once it has GROUP_MIN_MEMBERS members.
 */

import { prisma } from '../index';
import { recalculateTotalWeight } from './weightageService';

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
  return groupId;
}

/** Notes that a member has just used their group. */
export async function touchMember(groupId: string, userId: string): Promise<void> {
  await prisma.groupMember.updateMany({ where: { groupId, userId }, data: { lastSeenAt: new Date() } });
}

/**
 * Picks the group a post goes to next: one with enough members, that its author is not in,
 * other than the one it is in now. Groups it has not been through yet come first.
 * `null` when there is no such group.
 */
export async function pickGroupForPost(
  authorId: string,
  post?: { id: string; currentGroupId: string },
): Promise<string | null> {
  const [sizes, authorGroups, history] = await Promise.all([
    groupSizes(),
    prisma.groupMember.findMany({ where: { userId: authorId }, select: { groupId: true } }),
    post
      ? prisma.postHistory.findMany({ where: { postId: post.id }, select: { groupId: true } })
      : Promise.resolve([]),
  ]);
  const authorIn = new Set(authorGroups.map((m) => m.groupId));
  const visited = new Set(history.map((h) => h.groupId));

  const eligible = [...sizes]
    .filter(([id, size]) => size >= GROUP_MIN_MEMBERS && !authorIn.has(id) && id !== post?.currentGroupId)
    .map(([id]) => id);
  if (eligible.length === 0) return null;

  const fresh = eligible.filter((id) => !visited.has(id));
  return pickRandom(fresh.length > 0 ? fresh : eligible);
}

export interface VoteTally {
  voteCount: number;
  /** The number the votes are measured against. */
  totalMembers: number;
  pushPercentage: number;
  thresholdReached: boolean;
}

/**
 * Counts a post's votes in the group it is in. They are measured against the members who
 * have used the group lately, leaving the author out, and never against fewer than
 * GROUP_MIN_MEMBERS, so a handful of people cannot move a post on their own.
 */
export async function voteTally(post: { id: string; currentGroupId: string; ocUserId: string }): Promise<VoteTally> {
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const [voteCount, activeMembers] = await Promise.all([
    prisma.pushVote.count({ where: { postId: post.id, groupId: post.currentGroupId } }),
    prisma.groupMember.count({
      where: {
        groupId: post.currentGroupId,
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
 * Moves a post from one group to another: records the group it leaves in its history, clears
 * that group's votes and brings the weight up to date. Returns false, changing nothing, if the
 * post is no longer in `fromGroupId`, which is what happens when a vote and the author's
 * manual push try to move it at the same moment.
 */
export async function movePost(
  postId: string,
  fromGroupId: string,
  toGroupId: string,
  pushPercentage: number,
  wasManualPush: boolean,
): Promise<boolean> {
  const moved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.post.updateMany({
      where: { id: postId, currentGroupId: fromGroupId },
      data: {
        currentGroupId: toGroupId,
        ...(wasManualPush ? { lastManualPushAt: new Date() } : {}),
      },
    });
    if (claimed.count === 0) return false;
    await tx.postHistory.create({
      data: { postId, groupId: fromGroupId, pushPercentage, wasManualPush },
    });
    await tx.pushVote.deleteMany({ where: { postId, groupId: fromGroupId } });
    return true;
  });
  if (moved) await recalculateTotalWeight(postId);
  return moved;
}
