/**
 * API client — typed wrappers around all ExiThreat backend endpoints.
 * Auth token is read from localStorage and attached to every request.
 */

import { clearSession } from './session';

export const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// ── Types ─────────────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  userId: string;
  username: string;
  /** An older account without its email and mobile number: it must add them first. */
  needsContact?: boolean;
}

export type ContactChannel = 'email' | 'phone';

/** The signed-in member's own weightage; every score is 0 to 1. */
export interface MyWeight {
  weight: number;
  activityScore: number;
  postScore: number;
  /** null until a post has reached their group for them to go through. */
  voteScore: number | null;
  activeDays: number;
  minutes: number;
  posts: number;
  reviewed: number;
  due: number;
  /** The days counted: the last 30, or since the account was made. */
  windowDays: number;
}

export interface Me {
  userId: string;
  username: string;
  /** Shown with their posts instead of the username. */
  pseudonym: string;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface Post {
  id: string;
  redactedContent: string;
  totalWeight: number;
  createdAt: string;
  /** The reader's own group among those the post is in (null for the author). */
  groupId: string | null;
  /** Whether the signed-in user wrote it. */
  isAuthor: boolean;
  /** The author's pseudonym; never their username. */
  author: string;
  isMember: boolean;
  /** Whether the signed-in user can still open the unredacted first look. */
  firstLook: 'available' | 'used';
  /** An admin has hidden it; then only its author can open it. */
  hidden?: boolean;
  lastManualPushAt: string | null;
  _count: { pushVotes: number; comments: number };
  /** Sent to the author only. */
  journey?: PostJourney;
}

/** How far a post has travelled. */
export interface PostJourney {
  /** The number of groups it has left so far. */
  groupsPassed: number;
  /** The number of groups it is in now (up to five). */
  inGroups: number;
  /** When it last reached a group. */
  arrivedAt: string;
}

/** A post on the common page: it has reached 20% of the groups. */
export interface CommonPost {
  id: string;
  /** Its place in the list, 1 first. */
  rank: number;
  /** The author's pseudonym. */
  author: string;
  redactedContent: string;
  /** Officers only. */
  originalContent?: string;
  createdAt: string;
  listedAt: string;
  /** How long it took to reach 20% of the groups. */
  listedAfterMs: number;
  reachedGroups: number;
  eligibleGroups: number;
  /** Share of the groups reached per day since it was posted; the list is ordered by it. */
  spreadScore: number;
  totalWeight: number;
}

export interface CommonPage {
  total: number;
  offset: number;
  posts: CommonPost[];
}

/** A group on the author's map: by name and weight only, under a key valid for one answer. */
export interface GroupMapNode {
  key: string;
  name: string;
  /** 0 to 1. */
  weight: number;
  /** The post is in this group now. */
  current: boolean;
  /** The post has been in this group and left it. */
  passed: boolean;
  /** Covered in the current round: arrived since it began, or reading it now. */
  covered: boolean;
  /** Can be sent the post (enough members, and not the author's own group). */
  eligible: boolean;
  /** One of the author's own groups. */
  own: boolean;
  /** When it arrived, for the groups it is in now; null for the others. */
  arrivedAt: string | null;
}

/** Who sent the post where: `from` is a node key, or "you" for the author. */
export interface GroupMapEdge {
  from: string;
  to: string;
  by: 'start' | 'group' | 'author';
  at: string;
}

/** Sent to the author only: every group, the path their post has taken, and its round. */
export interface GroupMap {
  /** 1 at first; one more each time the post has been to every eligible group. */
  round: number;
  eligibleGroups: number;
  /** Eligible groups covered in this round. */
  coveredGroups: number;
  nodes: GroupMapNode[];
  edges: GroupMapEdge[];
}

/** One of the signed-in user's own posts, as listed under "My Disclosures". */
export interface MyPost {
  id: string;
  redactedContent: string;
  totalWeight: number;
  createdAt: string;
  lastManualPushAt: string | null;
  /** When an admin hid it, if they did. */
  hiddenAt: string | null;
  /** `history` is the number of groups the post has left so far. */
  _count: { pushVotes: number; comments: number; history: number };
  /** The number of groups it is in now, and when it last reached one. */
  inGroups: number;
  arrivedAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  /** The writer's pseudonym; never their username. */
  author: string;
  /** Whether the signed-in user wrote it. */
  mine: boolean;
}

export interface Group {
  id: string;
  name: string;
  /** The group's weight, 0 to 1, from how active its members are. */
  trustScore: number;
  /** Members' days of use, 0 to 1. */
  loginScore: number;
  /** How many posts members went through, 0 to 1; null before there were any. */
  reviewScore: number | null;
  weightUpdatedAt: string | null;
  createdAt: string;
  _count: { members: number; currentPosts: number };
}

/** Only sent to members of the group. */
export interface GroupDetail extends Group {
  isMember: boolean;
  /** The reader's own pseudonym, which their messages and comments show. */
  myPseudonym: string;
  currentPosts: Array<{
    id: string;
    redactedContent: string;
    totalWeight: number;
    createdAt: string;
    /** The author's pseudonym. */
    author: string;
    _count: { pushVotes: number; comments: number };
  }>;
}

export interface PushStatus {
  hasVoted: boolean;
  /** Whether the signed-in user has opened the first look; they cannot vote before that. */
  hasRead: boolean;
  voteCount: number;
  /** What the votes are measured against: recently active members, never fewer than the minimum. */
  totalMembers: number;
  pushPercentage: number;
  thresholdReached: boolean;
  /** In the answer to a vote: that vote moved the post on, out of the voter's group. */
  moved?: boolean;
}

export interface WeightageResult {
  postId: string;
  aggregatedWeight: number;
  groupsTraversed: number;
  history: Array<{
    groupId: string;
    groupName: string;
    pushPercentage: number;
    movedAt: string;
    wasManualPush: boolean;
  }>;
}

export interface ChatMessage {
  id: string;
  groupId: string;
  content: string;
  createdAt: string;
  /** The writer's pseudonym; never their username. */
  author: string;
  /** Whether the signed-in user wrote it. */
  mine: boolean;
}

export interface ProMicLinkStatus {
  linked: boolean;
  hostName?: string | null;
  linkedAt?: string;
}

export interface ProMicAudioBackup {
  id: string;
  startTimestamp: number;
  endTimestamp: number;
  durationMs: number;
  isThreatClip: boolean;
  lat: number | null;
  lon: number | null;
}

export interface ProMicVideoBackup {
  id: string;
  cameraFacing: 'FRONT' | 'BACK';
  startTimestamp: number;
  endTimestamp: number;
  durationMs: number;
  lat: number | null;
  lon: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('exithreat_token');
}

// Earlier versions of the service worker kept copies of API responses, the first-look image
// among them, in this cache. next.config.js no longer fills it; this empties what is left.
if (typeof window !== 'undefined' && 'caches' in window) {
  caches.delete('cross-origin').catch(() => {});
}

/**
 * The first look: a PNG (base64) of the original drawn in rows, which the website lays end to
 * end into one line. `rows` are the rows' widths and `rowHeight` their height, in image pixels;
 * the image is drawn `scale` times the size it is shown.
 */
export interface PaperStrip {
  image: string;
  rows: number[];
  rowHeight: number;
  scale: number;
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  binary = false,
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(!binary ? { 'Content-Type': 'application/json' } : {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (binary && res.ok) return res.blob() as unknown as T;

  // Errors are JSON with an `error` message, but a proxy in between may answer in plain text.
  let data: { error?: string; code?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  // The session has run out, the password was changed elsewhere, or the account is gone:
  // forget it and ask the user to sign in again. A wrong password at sign-in is also a 401,
  // and stays on the sign-in page.
  if (res.status === 401 && token && !path.startsWith('/auth/login')) {
    clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
      window.location.assign('/auth/login?expired=1');
    }
    throw new Error('You have been signed out. Please sign in again.');
  }

  // An admin has suspended the account: its sign-in is over; signing in again says why.
  if (res.status === 403 && data?.code === 'SUSPENDED' && token) {
    clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/auth/')) {
      window.location.assign('/auth/login?expired=1');
    }
    throw new Error(data.error ?? 'This account has been suspended.');
  }

  // An older account that has not added its email and mobile number yet.
  if (res.status === 403 && data?.code === 'CONTACT_REQUIRED') {
    if (typeof window !== 'undefined' && window.location.pathname !== '/account/contact') {
      window.location.assign('/account/contact');
    }
    throw new Error(data.error ?? 'Add your email address and mobile number to continue.');
  }

  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export const auth = {
  /** Sends a 6-digit code to an email address (mobile numbers: lib/firebasePhone.ts). */
  verifyStart: (channel: ContactChannel, value: string) =>
    req<{ verificationId: string; expiresInSeconds: number; resendInSeconds: number }>(
      'POST', '/auth/verify/start', { channel, value }),
  /** A mobile number confirmed by Firebase: its ID token, exchanged for a confirmation id. */
  verifyPhone: (idToken: string) => req<{ verificationId: string }>('POST', '/auth/verify/phone', { idToken }),
  verifyCheck: (verificationId: string, code: string) =>
    req<{ verified: boolean }>('POST', '/auth/verify/check', { verificationId, code }),
  register: (username: string, password: string, emailVerificationId: string, phoneVerificationId: string) =>
    req<AuthResponse>('POST', '/auth/register', { username, password, emailVerificationId, phoneVerificationId }),
  /** `identifier` is the username, email address or mobile number. */
  login: (identifier: string, password: string) =>
    req<AuthResponse>('POST', '/auth/login', { identifier, password }),
  me: () => req<Me>('GET', '/auth/me'),
  /** Time on the site since the last report, for the member's weightage. */
  heartbeat: (seconds: number) => req<{ ok: boolean }>('POST', '/auth/heartbeat', { seconds }),
  /** The member's own weightage, worked out now. */
  myWeight: () => req<MyWeight>('GET', '/auth/weight'),
  /** For an older account: adds the email and/or mobile number it lacks. */
  addContact: (emailVerificationId: string | null, phoneVerificationId: string | null) =>
    req<AuthResponse>('POST', '/auth/contact', {
      ...(emailVerificationId ? { emailVerificationId } : {}),
      ...(phoneVerificationId ? { phoneVerificationId } : {}),
    }),
  /** A new password, proved with a code to the account's email or mobile. Signs out everywhere else. */
  reset: (channel: ContactChannel, verificationId: string, newPassword: string) =>
    req<AuthResponse>('POST', '/auth/reset', { channel, verificationId, newPassword }),
  /** Returns a new token; tokens on every other device stop working. */
  changePassword: (currentPassword: string, newPassword: string) =>
    req<AuthResponse>('POST', '/auth/password', { currentPassword, newPassword }),
  /** Every token issued so far stops working, including this device's. */
  signOutAll: () => req<{ ok: boolean }>('POST', '/auth/signout-all'),
  /** Deletes the account and everything it wrote, for good. */
  deleteAccount: (password: string) => req<{ ok: boolean }>('POST', '/auth/delete', { password }),
};

// ── Posts ─────────────────────────────────────────────────────────────────

export const posts = {
  create: (content: string) =>
    req<Pick<Post, 'id' | 'redactedContent' | 'totalWeight' | 'createdAt' | 'groupId'>>('POST', '/posts', { content }),
  /** What the redacted version of this text would be. Nothing is saved. */
  preview: (content: string) => req<{ redactedContent: string }>('POST', '/posts/preview', { content }),
  /** The signed-in user's own posts, newest first. */
  mine: () => req<MyPost[]>('GET', '/posts/mine'),
  get: (id: string) => req<Post>('GET', `/posts/${id}`),
  /** The author's map of the groups (author only). */
  map: (id: string) => req<GroupMap>('GET', `/posts/${id}/map`),
  /** Fetches the unredacted PNG strip as a Blob. Refused once the first look is used up. */
  getStrip: (id: string) => req<PaperStrip>('GET', `/posts/${id}/strip`),
  /** Ends the first look. `keepalive` lets it go out while the page is being left. */
  /** "done": the reader tapped "Done reading" and is shown the redacted version; "left": they left. */
  stripDone: (id: string, reason: 'done' | 'left') => {
    const token = getToken();
    fetch(`${BASE}/posts/${id}/strip/done`, {
      method: 'POST',
      keepalive: true,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).catch(() => {});
  },
  getComments: (id: string) => req<Comment[]>('GET', `/posts/${id}/comments`),
  addComment: (id: string, content: string) =>
    req<Comment>('POST', `/posts/${id}/comments`, { content }),
};

// ── Groups ────────────────────────────────────────────────────────────────

export const groups = {
  /** The signed-in user's own groups. The server assigns them; nobody joins or creates one. */
  list: () => req<Group[]>('GET', '/groups'),
  get: (id: string) => req<GroupDetail>('GET', `/groups/${id}`),
  heartbeat: (id: string, secondsSpent: number) =>
    req<{ ok: boolean }>('POST', `/groups/${id}/heartbeat`, { secondsSpent }),
  getChat: (id: string, limit = 50) =>
    req<ChatMessage[]>('GET', `/groups/${id}/chat?limit=${limit}`),
  sendChat: (id: string, content: string) =>
    req<ChatMessage>('POST', `/groups/${id}/chat`, { content }),
};

// ── Push ──────────────────────────────────────────────────────────────────

export const push = {
  vote: (postId: string) => req<PushStatus>('POST', `/push/${postId}/vote`),
  retractVote: (postId: string) => req<{ voted: boolean }>('DELETE', `/push/${postId}/vote`),
  manualPush: (postId: string) =>
    req<{ moved: boolean; groupsAdded: number; message: string }>('POST', `/push/${postId}/manual`),
  status: (postId: string) => req<PushStatus>('GET', `/push/${postId}/status`),
};

// ── Weightage ─────────────────────────────────────────────────────────────

export const common = {
  /** The common page, 30 posts from `offset`. */
  list: (offset = 0) => req<CommonPage>('GET', `/common?offset=${offset}`),
  /** The same for an officer, with the original versions; `token` is their ProMic session. */
  officerList: async (token: string, offset = 0): Promise<CommonPage> => {
    const res = await fetch(`${BASE}/common/officer?offset=${offset}`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? 'Sign in again.' : data.error ?? `Request failed (${res.status})`);
    return data as CommonPage;
  },
};

export const weightage = {
  get: (postId: string) => req<WeightageResult>('GET', `/weightage/${postId}`),
};

// ── ProMic ────────────────────────────────────────────────────────────────

export const promic = {
  getLink: () => req<ProMicLinkStatus>('GET', '/promic/link'),
  /** Redeems a one-time code from the ProMic app (Settings → Link ExiThreat Account). */
  link: (code: string) => req<ProMicLinkStatus>('POST', '/promic/link', { code }),
  unlink: () => req<ProMicLinkStatus>('DELETE', '/promic/link'),
  listBackups: () =>
    req<{ audio: ProMicAudioBackup[]; video: ProMicVideoBackup[] }>('GET', '/promic/backups'),
  /** Fetches the decrypted backup (WAV or MP4) as a Blob — play it via an object URL. */
  getMedia: (kind: 'audio' | 'video', id: string) =>
    req<Blob>('GET', `/promic/backups/${kind}/${id}`, undefined, true),
};
