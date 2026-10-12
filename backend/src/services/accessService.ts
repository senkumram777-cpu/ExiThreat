/**
 * Access Service
 *
 * One place that decides who may read a post and what travels with it (comments, votes,
 * weightage): members of the group it is currently in, and its author.
 */

import { prisma } from '../index';

export interface PostAccess {
  isAuthor: boolean;
  isMember: boolean;
  canRead: boolean;
}

export async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true },
  });
  return membership !== null;
}

export async function postAccess(
  post: { currentGroupId: string; ocUserId: string },
  userId: string,
): Promise<PostAccess> {
  const isAuthor = post.ocUserId === userId;
  const isMember = await isGroupMember(post.currentGroupId, userId);
  return { isAuthor, isMember, canRead: isAuthor || isMember };
}

/** Looks the post up first. `null` means there is no such post. */
export async function postAccessById(postId: string, userId: string): Promise<PostAccess | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { currentGroupId: true, ocUserId: true },
  });
  if (!post) return null;
  return postAccess(post, userId);
}

export const NOT_IN_GROUP = 'Not a member of this post\'s current group';
