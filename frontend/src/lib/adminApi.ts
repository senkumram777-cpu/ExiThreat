/**
 * The admin page's calls to /api/admin (backend routes/admin.ts), signed with the admin's
 * Firebase ID token (adminAuth.ts). Kept apart from api.ts, whose 401 handling signs a member
 * out.
 */

import { BASE } from './api';
import { adminToken } from './adminAuth';

export class AdminError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await adminToken();
  if (!token) throw new AdminError(401, 'Sign in again.');
  let res: Response;
  try {
    res = await fetch(`${BASE}/admin${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new AdminError(0, 'The server could not be reached.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new AdminError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Ref {
  id: string;
  name: string;
}

export interface Person {
  id: string;
  username: string;
  pseudonym: string;
}

export interface AdminAction {
  id: string;
  at: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
}

export interface Overview {
  users: { total: number; newThisWeek: number; suspended: number; withoutContact: number; activeToday: number; activeThisWeek: number };
  groups: { total: number; takingPosts: number };
  posts: { total: number; newThisWeek: number; hidden: number; onCommonPage: number; unlisted: number };
  activity: { comments: number; chatMessages: number; votes: number; firstLooksThisWeek: number };
  reports: { open: number };
  days: { day: string; joined: number; posted: number; active: number }[];
  recentActions: AdminAction[];
}

export interface AdminUserRow {
  id: string;
  username: string;
  pseudonym: string;
  createdAt: string;
  weight: number;
  suspendedAt: string | null;
  suspendedReason: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  groups: Ref[];
  _count: { posts: number; comments: number; pushVotes: number };
}

export interface AdminUserDetail extends Omit<AdminUserRow, 'groups' | '_count'> {
  activityScore: number;
  postScore: number;
  voteScore: number | null;
  tokensValidFrom: string | null;
  proMicLinked: boolean;
  memberships: { joinedAt: string; lastSeenAt: string | null; visitCount: number; group: Ref }[];
  _count: { posts: number; comments: number; pushVotes: number; chatMessages: number; viewRecords: number };
  posts: { id: string; snippet: string; createdAt: string; hiddenAt: string | null; listedAt: string | null; unlistedAt: string | null; reachedGroups: number; eligibleGroups: number }[];
  activeDays: { day: string; seconds: number }[];
}

export interface AdminPost {
  id: string;
  originalContent: string;
  redactedContent: string;
  category: string | null;
  createdAt: string;
  totalWeight: number;
  cycle: number;
  reachedGroups: number;
  eligibleGroups: number;
  spreadScore: number;
  listedAt: string | null;
  unlistedAt: string | null;
  hiddenAt: string | null;
  hiddenReason: string | null;
  lastManualPushAt: string | null;
  author: Person;
  groups: Ref[];
  onCommonPage: boolean;
  _count: { comments: number; pushVotes: number; viewRecords: number; history: number };
}

export interface AdminPostDetail extends AdminPost {
  comments: { id: string; content: string; createdAt: string; user: Person }[];
  history: { arrivedAt: string; movedAt: string; pushPercentage: number; wasManualPush: boolean; group: Ref }[];
}

export interface ChatRow {
  id: string;
  content: string;
  createdAt: string;
  user: Person;
  group: Ref;
}

export interface AdminGroup {
  id: string;
  name: string;
  createdAt: string;
  trustScore: number;
  loginScore: number;
  reviewScore: number | null;
  weightUpdatedAt: string | null;
  _count: { members: number; placements: number; chatMessages: number };
}

export interface AdminGroupDetail extends Omit<AdminGroup, '_count'> {
  members: {
    joinedAt: string; lastSeenAt: string | null; visitCount: number; totalTimeSpent: number; readThroughCount: number;
    user: { id: string; username: string; pseudonym: string; weight: number; suspendedAt: string | null };
  }[];
  posts: { id: string; snippet: string; arrivedAt: string; hiddenAt: string | null; oc: { username: string; pseudonym: string } }[];
}

export interface Setting {
  key: string;
  label: string;
  help: string;
  unit: 'share' | 'hours' | 'count' | 'switch';
  min: number;
  max: number;
  default: number;
  value: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface Officer {
  id: string;
  email: string;
  phone: string;
  branch: string;
  disabled: boolean;
  createdAt: number | null;
  lastLoginAt: number | null;
  passwordIssuedAt: number | null;
  lockedUntil: number | null;
  hasStation: boolean;
}

/** One reported post, comment or chat message, with every member report about it. */
export interface ReportedItem {
  targetType: 'post' | 'comment' | 'chat';
  targetId: string;
  /** What the reporters saw (a post's redacted version), kept if the item has been removed. */
  content: string;
  author: Person & { suspendedAt: string | null };
  /** Still there; for a post, whether it is hidden; a comment's post, a message's group. */
  exists: boolean;
  hidden: boolean;
  postId: string | null;
  groupId: string | null;
  resolution: 'removed' | 'dismissed' | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  reports: { id: string; reason: string; detail: string | null; createdAt: string; reporter: Person }[];
}

const q = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const admin = {
  me: () => call<{ uid: string; email: string }>('GET', '/me'),
  overview: () => call<Overview>('GET', '/overview'),

  users: (query: string, filter: string, offset: number) =>
    call<{ total: number; offset: number; users: AdminUserRow[] }>('GET', `/users${q({ q: query, filter, offset })}`),
  user: (id: string) => call<AdminUserDetail>('GET', `/users/${id}`),
  suspend: (id: string, reason: string) => call('POST', `/users/${id}/suspend`, { reason }),
  restore: (id: string) => call('POST', `/users/${id}/restore`),
  signOutUser: (id: string) => call('POST', `/users/${id}/signout`),
  deleteUser: (id: string) => call('DELETE', `/users/${id}`),

  posts: (query: string, filter: string, offset: number) =>
    call<{ total: number; offset: number; posts: AdminPost[] }>('GET', `/posts${q({ q: query, filter, offset })}`),
  post: (id: string) => call<AdminPostDetail>('GET', `/posts/${id}`),
  hide: (id: string, reason: string) => call('POST', `/posts/${id}/hide`, { reason }),
  unhide: (id: string) => call('POST', `/posts/${id}/unhide`),
  unlist: (id: string) => call('POST', `/posts/${id}/unlist`),
  relist: (id: string) => call('POST', `/posts/${id}/relist`),
  deletePost: (id: string) => call('DELETE', `/posts/${id}`),
  deleteComment: (id: string) => call('DELETE', `/comments/${id}`),

  chat: (groupId: string, offset: number) =>
    call<{ total: number; offset: number; messages: ChatRow[] }>('GET', `/chat${q({ groupId, offset })}`),
  deleteChat: (id: string) => call('DELETE', `/chat/${id}`),

  reports: (status: 'open' | 'resolved') => call<{ items: ReportedItem[] }>('GET', `/reports${q({ status })}`),
  resolveReports: (targetType: string, targetId: string, action: 'remove' | 'dismiss', reason: string) =>
    call<{ ok: boolean; closed: number }>('POST', '/reports/resolve', { targetType, targetId, action, reason }),

  groups: () => call<{ minMembers: number; maxMembers: number; groups: AdminGroup[] }>('GET', '/groups'),
  group: (id: string) => call<AdminGroupDetail>('GET', `/groups/${id}`),
  renameGroup: (id: string, name: string) => call('PATCH', `/groups/${id}`, { name }),
  moveMember: (fromGroupId: string, userId: string, toGroupId: string) =>
    call('POST', `/groups/${fromGroupId}/move`, { userId, toGroupId }),
  recalculate: () => call('POST', '/recalculate'),

  settings: () => call<Setting[]>('GET', '/settings'),
  setSetting: (key: string, value: number) => call('PUT', `/settings/${key}`, { value }),

  log: (offset: number) => call<{ total: number; offset: number; actions: AdminAction[] }>('GET', `/log${q({ offset })}`),

  officers: () => call<Officer[]>('GET', '/officers'),
  createOfficer: (email: string, phone: string, branch: string) =>
    call<{ delivery?: unknown }>('POST', '/officers', { email, phone, branch }),
  resetOfficer: (email: string) => call<{ delivery?: unknown }>('POST', '/officers/reset', { email }),
  setOfficerDisabled: (id: string, disabled: boolean) => call('POST', `/officers/${id}/disabled`, { disabled }),
};
