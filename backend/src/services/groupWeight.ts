/**
 * A group's weight, from how active its members are. Pure arithmetic, no database, so the
 * unit tests can load it; groupWeightService.ts gathers the numbers.
 *
 * Each member gets two scores between 0 and 1:
 *  - Logins: the days on which they used ExiThreat signed in, out of the days they could
 *    have (the last WINDOW_DAYS, or since they joined if that is shorter). Using it every
 *    other day already counts as full marks.
 *  - Reviews: of the posts that reached the group while they were in it, the share they went
 *    through: read the first look (the original post) to the end with "Done reading", and
 *    were shown the redacted version afterwards. A post they have not reviewed counts
 *    against them only once it has been in the group for REVIEW_GRACE_MS, so a post that
 *    arrived an hour ago is not yet a miss. Pushing is not required: not voting means
 *    "keep it here", which is a decision too.
 *
 * The group's weight is the average of its members' scores, logins and reviews counting
 * equally. A group that has had no posts to review yet is weighed on logins alone.
 */

export const WINDOW_DAYS = 30;
/** Days in use, out of every two days, for full marks on logins. */
export const ACTIVE_DAY_SHARE_FOR_FULL_MARKS = 0.5;
export const REVIEW_GRACE_MS = 24 * 60 * 60 * 1000;

export interface MemberActivity {
  /** Days in the window on which the member used ExiThreat. */
  activeDays: number;
  /** Days the member could have used it: the window, or since joining if shorter (at least 1). */
  possibleDays: number;
  /** Posts the member went through. */
  reviewed: number;
  /** Posts the member should have gone through by now (reviewed ones included). */
  due: number;
}

export interface GroupWeight {
  /** Between 0 and 1. */
  weight: number;
  loginScore: number;
  /** null while no member has had a post to review. */
  reviewScore: number | null;
}

export function loginScoreOf(m: MemberActivity): number {
  const needed = Math.max(1, m.possibleDays * ACTIVE_DAY_SHARE_FOR_FULL_MARKS);
  return Math.min(m.activeDays / needed, 1);
}

export function reviewScoreOf(m: MemberActivity): number | null {
  if (m.due <= 0) return null;
  return Math.min(m.reviewed / m.due, 1);
}

export function groupWeightOf(members: MemberActivity[]): GroupWeight {
  if (members.length === 0) return { weight: 0, loginScore: 0, reviewScore: null };
  const logins = members.map(loginScoreOf);
  const reviews = members.map(reviewScoreOf).filter((r): r is number => r !== null);
  const loginScore = logins.reduce((sum, v) => sum + v, 0) / logins.length;
  const reviewScore = reviews.length > 0 ? reviews.reduce((sum, v) => sum + v, 0) / reviews.length : null;
  const weight = reviewScore === null ? loginScore : (loginScore + reviewScore) / 2;
  return { weight, loginScore, reviewScore };
}

/** The calendar day in India, as "YYYY-MM-DD", that `date` falls on. */
export function indiaDay(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
