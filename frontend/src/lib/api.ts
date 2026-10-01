/**
 * API client — typed wrappers around all ExiThreat backend endpoints.
 * Auth token is read from localStorage and attached to every request.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// ── Types ─────────────────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  userId: string;
  username: string;
}

export interface Post {
  id: string;
  redactedContent: string;
  totalWeight: number;
  createdAt: string;
  currentGroupId: string;
  ocUserId: string;
  lastManualPushAt: string | null;
  _count: { pushVotes: number; comments: number };
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

export interface PushStatus {
  hasVoted: boolean;
  voteCount: number;
  totalMembers: number;
  pushPercentage: number;
  thresholdReached: boolean;
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

  if (binary) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob() as unknown as T;
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export const auth = {
  register: (username: string, password: string) =>
    req<AuthResponse>('POST', '/auth/register', { username, password }),
  login: (username: string, password: string) =>
    req<AuthResponse>('POST', '/auth/login', { username, password }),
};

// ── Posts ─────────────────────────────────────────────────────────────────

export const posts = {
  create: (content: string) =>
    req<Pick<Post, 'id' | 'redactedContent' | 'totalWeight' | 'createdAt' | 'currentGroupId'>>('POST', '/posts', { content }),
  get: (id: string) => req<Post>('GET', `/posts/${id}`),
  /** Fetches the unredacted PNG strip as a Blob. Only works on first call per device. */
  getStrip: (id: string) => req<Blob>('GET', `/posts/${id}/strip`, undefined, true),
  getComments: (id: string) => req<Comment[]>('GET', `/posts/${id}/comments`),
  addComment: (id: string, content: string) =>
    req<Comment>('POST', `/posts/${id}/comments`, { content }),
};

// ── Groups ────────────────────────────────────────────────────────────────

export const groups = {
  list: () => req<Group[]>('GET', '/groups'),
  get: (id: string) => req<Group & { members: unknown[]; currentPosts: unknown[] }>('GET', `/groups/${id}`),
  create: (name: string) => req<Group>('POST', '/groups', { name }),
  join: (id: string) => req<unknown>('POST', `/groups/${id}/join`),
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
