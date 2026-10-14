/**
 * API client — typed wrappers around all ExiThreat backend endpoints.
 * Auth token is read from localStorage and attached to every request.
 */

import { clearSession } from './session';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// ── Types ─────────────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  userId: string;
  username: string;
  /** An older account without its email and mobile number: it must add them first. */
  needsContact?: boolean;
}

export type ContactChannel = 'email' | 'phone';

export interface Me {
  userId: string;
  username: string;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface Post {
  id: string;
  redactedContent: string;
  totalWeight: number;
  createdAt: string;
  currentGroupId: string;
  /** Whether the signed-in user wrote it. Who wrote it is never sent. */
  isAuthor: boolean;
  isMember: boolean;
  /** Whether the signed-in user can still open the unredacted first look. */
  firstLook: 'available' | 'used';
  lastManualPushAt: string | null;
  _count: { pushVotes: number; comments: number };
  /** Sent to the author only. */
  journey?: PostJourney;
}

/** How far a post has travelled. */
export interface PostJourney {
  /** The number of groups it has left so far. */
  groupsPassed: number;
  /** When it reached the group it is in now. */
  arrivedAt: string;
}

/** One of the signed-in user's own posts, as listed under "My Disclosures". */
export interface MyPost {
  id: string;
  redactedContent: string;
  totalWeight: number;
  createdAt: string;
  lastManualPushAt: string | null;
  /** `history` is the number of groups the post has left so far. */
  _count: { pushVotes: number; comments: number; history: number };
  /** When it reached the group it is in now. */
  arrivedAt: string;
}

export interface Comment {
  id: string;
  postId: string;
  content: string;
  createdAt: string;
  user: { id: string; username: string };
}

export interface Group {
  id: string;
  name: string;
  trustScore: number;
  createdAt: string;
  _count: { members: number; currentPosts: number };
}

/** Only sent to members of the group. */
export interface GroupDetail extends Group {
  isMember: boolean;
  members: Array<{ username: string }>;
  currentPosts: Array<{
    id: string;
    redactedContent: string;
    totalWeight: number;
    createdAt: string;
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
  user: { id: string; username: string };
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
};

// ── Posts ─────────────────────────────────────────────────────────────────

export const posts = {
  create: (content: string) =>
    req<Pick<Post, 'id' | 'redactedContent' | 'totalWeight' | 'createdAt' | 'currentGroupId'>>('POST', '/posts', { content }),
  /** What the redacted version of this text would be. Nothing is saved. */
  preview: (content: string) => req<{ redactedContent: string }>('POST', '/posts/preview', { content }),
  /** The signed-in user's own posts, newest first. */
  mine: () => req<MyPost[]>('GET', '/posts/mine'),
  get: (id: string) => req<Post>('GET', `/posts/${id}`),
  /** Fetches the unredacted PNG strip as a Blob. Refused once the first look is used up. */
  getStrip: (id: string) => req<Blob>('GET', `/posts/${id}/strip`, undefined, true),
  /** Ends the first look. `keepalive` lets it go out while the page is being left. */
  stripDone: (id: string) => {
    const token = getToken();
    fetch(`${BASE}/posts/${id}/strip/done`, {
      method: 'POST',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    req<{ moved: boolean; newGroupId: string; message: string }>('POST', `/push/${postId}/manual`),
  status: (postId: string) => req<PushStatus>('GET', `/push/${postId}/status`),
};

// ── Weightage ─────────────────────────────────────────────────────────────

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
