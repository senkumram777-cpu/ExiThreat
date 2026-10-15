/**
 * A member's own weightage (the "source member", whose posts are disclosures), from how they
 * use ExiThreat. Pure arithmetic, no database, so the unit tests can load it;
 * memberWeightService.ts gathers the numbers.
 *
 * Three parts, each between 0 and 1, counting equally, over the last WINDOW_DAYS (or since
 * the member joined, if that is shorter):
 *  1. Activity: half how often they use it (days of use; every other day is full marks),
 *     half how long they stay (minutes on the site; FULL_MINUTES_PER_DAY on each of those
 *     days is full marks).
 *  2. Posting: how often they post (DAYS_PER_POST_FOR_FULL_MARKS: one post a week is full
 *     marks, and more does not add).
 *  3. Voting: of the posts that reached their group while they were in it, the share they
 *     went through (first look read with "Done reading", redacted version shown), the same
 *     measure as the group weight. Left out until they have had a post to go through.
 */

import { ACTIVE_DAY_SHARE_FOR_FULL_MARKS } from './groupWeight';

export const FULL_MINUTES_PER_DAY = 10;
export const DAYS_PER_POST_FOR_FULL_MARKS = 7;

export interface MemberUsage {
  /** Days the member could have used it: the window, or since joining if shorter (at least 1). */
  possibleDays: number;
  activeDays: number;
  /** Seconds on the site in the window. */
  seconds: number;
  posts: number;
  /** Posts gone through, and posts that should have been by now. */
  reviewed: number;
  due: number;
}

export interface MemberWeight {
  /** Between 0 and 1. */
  weight: number;
  activityScore: number;
  postScore: number;
  /** null while the member has had no post to go through. */
  voteScore: number | null;
}

export function activityScoreOf(u: MemberUsage): number {
  const expectedDays = Math.max(1, u.possibleDays * ACTIVE_DAY_SHARE_FOR_FULL_MARKS);
  const days = Math.min(u.activeDays / expectedDays, 1);
  const time = Math.min(u.seconds / 60 / (expectedDays * FULL_MINUTES_PER_DAY), 1);
  return (days + time) / 2;
}

export function postScoreOf(u: MemberUsage): number {
  const expectedPosts = Math.max(1, u.possibleDays / DAYS_PER_POST_FOR_FULL_MARKS);
  return Math.min(u.posts / expectedPosts, 1);
}

export function voteScoreOf(u: MemberUsage): number | null {
  return u.due > 0 ? Math.min(u.reviewed / u.due, 1) : null;
}

export function memberWeightOf(u: MemberUsage): MemberWeight {
  const activityScore = activityScoreOf(u);
  const postScore = postScoreOf(u);
  const voteScore = voteScoreOf(u);
  const parts = [activityScore, postScore, ...(voteScore === null ? [] : [voteScore])];
  return { weight: parts.reduce((s, v) => s + v, 0) / parts.length, activityScore, postScore, voteScore };
}
