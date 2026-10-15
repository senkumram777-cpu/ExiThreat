/**
 * Access Service
 *
 * One place that decides who may read a post and what travels with it (comments, votes,
 * weightage): members of any group it is in now, and its author.
 */

import { prisma } from '../index';

export interface PostAccess {
  isAuthor: boolean;
  isMember: boolean;
  canRead: boolean;
  /** The reader's own group among those the post is in; null if they are in none of them. */
  groupId: string | null;
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true },
  });
  return membership !== null;
}

/** The group, among those the post is in now, that the user is a member of. */
export async function readerGroup(postId: string, userId: string): Promise<string | null> {
  const placement = await prisma.postPlacement.findFirst({
    where: { postId, group: { members: { some: { userId } } } },
    select: { groupId: true },
  });
  return placement?.groupId ?? null;
}

export async function postAccess(
  post: { id: string; ocUserId: string },
  userId: string,
): Promise<PostAccess> {
  const isAuthor = post.ocUserId === userId;
  const groupId = await readerGroup(post.id, userId);
  return { isAuthor, isMember: groupId !== null, canRead: isAuthor || groupId !== null, groupId };
}

/** Looks the post up first. `null` means there is no such post. */
export async function postAccessById(postId: string, userId: string): Promise<PostAccess | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, ocUserId: true },
  });
  if (!post) return null;
  return postAccess(post, userId);
}

export const NOT_IN_GROUP = 'Not a member of this post\'s current group';
