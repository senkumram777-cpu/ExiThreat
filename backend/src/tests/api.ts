/**
 * API test: starts the real server against an empty, throwaway PostgreSQL schema and walks
 * through the rules that matter: who can read what, the first look, voting and moving, and
 * the accounts: one per email address and mobile number, sign-in and password reset. Run with `npm run test:api`.
 *
 * Needs DATABASE_URL to point at a PostgreSQL server it may create a schema on (the local
 * development database is fine: it works in a schema of its own and removes it afterwards).
 * The schema is built with `prisma migrate deploy`, so this also proves the migrations.
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const ROOT = path.join(__dirname, '..', '..');
// Not 4190: fetch refuses a list of ports reserved for other protocols, and that is one.
const PORT = 4180;
const API = `http://localhost:${PORT}/api`;
const PASSWORD = 'test-password-1';

const baseUrl = process.env.DATABASE_URL;
if (!baseUrl) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}
const schema = `apitest_${Date.now().toString(36)}`;
const testUrl = `${baseUrl.split('?')[0]}?schema=${schema}`;
const env = {
  ...process.env,
  DATABASE_URL: testUrl,
  PORT: String(PORT),
  JWT_SECRET: 'api-test-secret-0123456789-0123456789',
  GROUP_MIN_MEMBERS: '2',
  // With full groups, a new account can only go where the test has made room.
  GROUP_MAX_MEMBERS: '2',
  REGISTER_LIMIT_PER_DAY: '1000',
  LOGIN_ATTEMPTS: '3',
  CODE_SENDS_PER_HOUR: '1000',
  CODE_RESEND_SECONDS: '2',
  // The test sets group weights itself; the start-up recalculation must not undo them.
  SWEEP_START_DELAY_SECONDS: '3600',
  // No Gmail account: the server prints each email code, and the test reads it there.
  GMAIL_USER: '',
  GMAIL_APP_PASSWORD: '',
  // Mobile numbers are confirmed with "test-phone:<number>" instead of a Firebase token.
  PHONE_TOKEN_TEST: '1',
  // Officers are "test-officer:<id>" instead of a ProMic session.
  LE_OFFICER_TEST: '1',
  NODE_ENV: 'test',
};
const prisma = new PrismaClient({ datasources: { db: { url: testUrl } } });

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The groups a post is in now. */
async function groupsHolding(postId: string): Promise<string[]> {
  return (await prisma.postPlacement.findMany({ where: { postId }, select: { groupId: true } })).map((p) => p.groupId);
}

interface Reply {
  status: number;
  json: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

async function call(method: string, route: string, token?: string, body?: unknown): Promise<Reply> {
  const res = await fetch(API + route, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) return { status: res.status, json: true, data: await res.json() };
  return { status: res.status, json: false, data: Buffer.from(await res.arrayBuffer()) };
}

interface TestUser {
  token: string;
  userId: string;
  username: string;
}

// Codes the server printed, by verification id.
const codes = new Map<string, string>();

async function codeFor(verificationId: string): Promise<string> {
  for (let i = 0; i < 50 && !codes.has(verificationId); i++) await sleep(50);
  const code = codes.get(verificationId);
  if (!code) throw new Error(`No code was printed for ${verificationId}`);
  return code;
}

/** Confirms an email (code) or mobile number (test token); returns the verification id. */
async function confirm(channel: 'email' | 'phone', value: string): Promise<string> {
  if (channel === 'phone') {
    const r = await call('POST', '/auth/verify/phone', undefined, { idToken: `test-phone:${value}` });
    if (r.status !== 200) throw new Error(`verify/phone ${value}: ${JSON.stringify(r.data)}`);
    return r.data.verificationId;
  }
  const started = await call('POST', '/auth/verify/start', undefined, { channel, value });
  if (started.status !== 200) throw new Error(`verify/start ${value}: ${JSON.stringify(started.data)}`);
  const { verificationId } = started.data;
  await call('POST', '/auth/verify/check', undefined, { verificationId, code: await codeFor(verificationId) });
  return verificationId;
}

let nextContact = 0;
/** A fresh email address and mobile number for each test account. */
function newContact(): { email: string; phone: string } {
  nextContact++;
  return { email: `person${nextContact}@example.com`, phone: `98${String(nextContact).padStart(8, '0')}` };
}

async function registerWith(username: string, email: string, phone: string): Promise<Reply> {
  return call('POST', '/auth/register', undefined, {
    username,
    password: PASSWORD,
    emailVerificationId: await confirm('email', email),
    phoneVerificationId: await confirm('phone', phone),
  });
}

async function register(username: string): Promise<TestUser> {
  const { email, phone } = newContact();
  return (await registerWith(username, email, phone)).data;
}

async function accountChecks(): Promise<void> {
  // ── sign-up needs a confirmed email address and mobile number ──
  check('sign-up without them is refused',
    (await call('POST', '/auth/register', undefined, { username: 'nobody', password: PASSWORD })).status === 400);
  check('a malformed email is refused',
    (await call('POST', '/auth/verify/start', undefined, { channel: 'email', value: 'not-an-email' })).status === 400);
  check('a number that is not an Indian mobile is refused',
    (await call('POST', '/auth/verify/phone', undefined, { idToken: 'test-phone:+14155552671' })).status === 400);
  check('a Firebase token that is not genuine is refused',
    [400, 503].includes((await call('POST', '/auth/verify/phone', undefined, { idToken: 'not-a-token' })).status));
  check('the server sends no SMS itself',
    (await call('POST', '/auth/verify/start', undefined, { channel: 'phone', value: '9876543210' })).status === 400);

  let r = await call('POST', '/auth/verify/start', undefined, { channel: 'email', value: 'wrong.codes@example.com' });
  const wrongId: string = r.data.verificationId;
  check('a new code cannot be asked for straight away',
    (await call('POST', '/auth/verify/start', undefined, { channel: 'email', value: 'Wrong.Codes@example.com' })).status === 429);
  const right = await codeFor(wrongId);
  const wrong = right === '000000' ? '111111' : '000000';
  r = await call('POST', '/auth/verify/check', undefined, { verificationId: wrongId, code: wrong });
  check('a wrong code is refused and says how many tries are left', r.status === 400 && /4 tries left/.test(r.data.error), r.data);
  for (let i = 0; i < 4; i++) r = await call('POST', '/auth/verify/check', undefined, { verificationId: wrongId, code: wrong });
  check('after five wrong codes even the right one is refused',
    (await call('POST', '/auth/verify/check', undefined, { verificationId: wrongId, code: right })).status === 410);

  const asha = newContact();
  const ashaEmail = 'asha.k@gmail.com';
  r = await registerWith('asha', ashaEmail, asha.phone);
  check('sign-up with both confirmed works', r.status === 201 && r.data.needsContact === false, r.data);
  const ashaToken: string = r.data.token;
  const stored = await prisma.user.findUniqueOrThrow({ where: { username: 'asha' } });
  check('only fingerprints are stored, not the email or number',
    /^[0-9a-f]{64}$/.test(stored.emailHash ?? '') && /^[0-9a-f]{64}$/.test(stored.phoneHash ?? '')
      && !JSON.stringify(stored).includes('asha.k') && !JSON.stringify(stored).includes(asha.phone));
  check('the same email in another form cannot sign up again',
    (await registerWith('asha2', 'Asha.K+second@GMAIL.com', newContact().phone)).status === 409);
  check('the same mobile number in another form cannot sign up again',
    (await registerWith('asha3', newContact().email, `+91 ${asha.phone.slice(0, 5)} ${asha.phone.slice(5)}`)).status === 409);
  const reused = await confirm('email', newContact().email);
  await call('POST', '/auth/register', undefined, {
    username: 'once', password: PASSWORD, emailVerificationId: reused, phoneVerificationId: await confirm('phone', newContact().phone),
  });
  check('a confirmation is used up by the sign-up it was for',
    (await call('POST', '/auth/register', undefined, {
      username: 'twice', password: PASSWORD, emailVerificationId: reused, phoneVerificationId: await confirm('phone', newContact().phone),
    })).status === 400);
  check('a username of digits only is refused', (await registerWith('9876501234', newContact().email, newContact().phone)).status === 400);

  // ── sign in with any of the three ──
  for (const [how, identifier] of [['username', 'asha'], ['email', 'ASHA.K@gmail.com'], ['mobile number', `0${asha.phone}`]]) {
    r = await call('POST', '/auth/login', undefined, { identifier, password: PASSWORD });
    check(`sign in with the ${how}`, r.status === 200 && r.data.username === 'asha', r.data);
  }
  check('a wrong password with the email is refused',
    (await call('POST', '/auth/login', undefined, { identifier: ashaEmail, password: 'wrong-password' })).status === 401);

  // ── password reset with a code ──
  await sleep(2100);
  r = await call('POST', '/auth/reset', undefined, {
    channel: 'phone', verificationId: await confirm('phone', asha.phone), newPassword: 'reset-password-1',
  });
  check('a code to the mobile number resets the password', r.status === 200 && r.data.username === 'asha', r.data);
  check('the new token works and the old one does not',
    (await call('GET', '/groups', r.data.token)).status === 200 && (await call('GET', '/groups', ashaToken)).status === 401);
  check('the new password signs in',
    (await call('POST', '/auth/login', undefined, { identifier: ashaEmail, password: 'reset-password-1' })).status === 200);
  check('a reset for an address no account uses is refused',
    (await call('POST', '/auth/reset', undefined, {
      channel: 'email', verificationId: await confirm('email', 'stranger@example.com'), newPassword: 'reset-password-2',
    })).status === 404);

  // ── an account from before contact details were required ──
  await prisma.user.create({ data: { username: 'oldtimer', pseudonym: 'Voice-OLDTIMER', passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  r = await call('POST', '/auth/login', undefined, { username: 'oldtimer', password: PASSWORD });
  check('an older account signs in and is told to add its details', r.status === 200 && r.data.needsContact === true, r.data);
  const oldToken: string = r.data.token;
  r = await call('GET', '/groups', oldToken);
  check('until then the site refuses it', r.status === 403 && r.data.code === 'CONTACT_REQUIRED', r.data);
  r = await call('GET', '/auth/me', oldToken);
  check('it can see what is missing', r.status === 200 && r.data.hasEmail === false && r.data.hasPhone === false, r.data);
  const old = newContact();
  check('it cannot take an email another account has',
    (await call('POST', '/auth/contact', oldToken, {
      emailVerificationId: await confirm('email', ashaEmail), phoneVerificationId: await confirm('phone', old.phone),
    })).status === 409);
  await sleep(2100);
  r = await call('POST', '/auth/contact', oldToken, {
    emailVerificationId: await confirm('email', old.email), phoneVerificationId: await confirm('phone', old.phone),
  });
  check('with its own details added it can use the site',
    r.status === 200 && r.data.needsContact === false && (await call('GET', '/groups', oldToken)).status === 200, r.data);
  check('the details cannot be changed afterwards',
    (await call('POST', '/auth/contact', oldToken, { emailVerificationId: await confirm('email', newContact().email) })).status === 409);

  // The users above are not part of the group checks that follow.
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  await prisma.user.deleteMany();
}

async function run(): Promise<void> {
  check('health answers, database included', (await call('GET', '/health')).status === 200);
  await accountChecks();

  // ── groups are assigned ──
  const users: TestUser[] = [];
  for (let i = 1; i <= 6; i++) users.push(await register(`user_${i}`));
  const [u1, u2, u3, u4, u5, u6] = users;
  const memberships = await prisma.groupMember.groupBy({ by: ['userId'], _count: { _all: true } });
  check('every new account is in exactly one group', memberships.length === 6 && memberships.every((m) => m._count._all === 1));
  check('creating a group is not possible', (await call('POST', '/groups', u1.token, { name: 'mine' })).status === 404);

  // Three groups of two, so that the rest of the test knows who is where.
  await prisma.groupMember.deleteMany();
  await prisma.group.deleteMany();
  const groups: Record<string, string> = {};
  for (const [name, members] of [['A', [u1, u2]], ['B', [u3, u4]], ['C', [u5, u6]]] as const) {
    const group = await prisma.group.create({ data: { name: `Group ${name}` } });
    groups[name] = group.id;
    for (const u of members) await prisma.groupMember.create({ data: { groupId: group.id, userId: u.userId } });
  }
  const membersOf = (groupId: string) => (groupId === groups.B ? [u3, u4] : [u5, u6]);

  // ── posting ──
  const text = 'My manager Ravi Kumar at Sunrise Textiles took my phone 9876543210 on the night shift.';
  let r = await call('POST', '/posts/preview', u1.token, { content: text });
  check('preview shows the redacted text and saves nothing',
    r.status === 200 && !/Ravi|Kumar|Sunrise|9876543210/.test(r.data.redactedContent) && (await prisma.post.count()) === 0, r.data);
  check('a post over 5,000 characters is refused', (await call('POST', '/posts', u1.token, { content: 'x'.repeat(5001) })).status === 400);
  r = await call('POST', '/posts', u1.token, { content: text });
  check('a post goes to one group its author is not in', r.status === 201 && r.data.groupId !== groups.A, r.data);
  const postId: string = r.data.id;
  const firstGroup: string = r.data.groupId;
  const [reader, second] = membersOf(firstGroup);
  const [outsider] = membersOf(firstGroup === groups.B ? groups.C : groups.B);

  r = await call('GET', '/posts/mine', u1.token);
  check('the author finds it under their own posts', r.status === 200 && r.data.length === 1 && r.data[0].id === postId, r.data);
  check('nobody else has it under theirs', (await call('GET', '/posts/mine', reader.token)).data.length === 0);

  // ── who can read ──
  r = await call('GET', `/posts/${postId}`, reader.token);
  check('a member reads it and is not told who wrote it',
    r.status === 200 && r.data.isAuthor === false && !JSON.stringify(r.data).includes(u1.userId), r.data);
  for (const route of [`/posts/${postId}`, `/posts/${postId}/comments`, `/posts/${postId}/strip`, `/push/${postId}/status`, `/weightage/${postId}`, `/groups/${firstGroup}`, `/groups/${firstGroup}/chat`]) {
    check(`someone outside the group is refused: ${route.replace(postId, ':id').replace(firstGroup, ':group')}`,
      (await call('GET', route, outsider.token)).status === 403);
  }
  r = await call('GET', `/posts/${postId}`, u1.token);
  check('the author reads their own post', r.status === 200 && r.data.isAuthor === true && r.data.firstLook === 'used', r.data);
  check('the author sees it has passed no group, is in one, and arrived when it was posted',
    r.data.journey?.groupsPassed === 0 && r.data.journey?.inGroups === 1
      && Math.abs(Date.parse(r.data.journey.arrivedAt) - Date.parse(r.data.createdAt)) < 1000, r.data.journey);
  check('a member is not sent the journey', (await call('GET', `/posts/${postId}`, reader.token)).data.journey === undefined);

  // ── first look and votes ──
  check('no vote before the first look', (await call('POST', `/push/${postId}/vote`, reader.token)).status === 403);
  r = await call('GET', `/posts/${postId}/strip`, reader.token);
  check('the first look is a PNG', r.status === 200 && !r.json && r.data.subarray(1, 4).toString() === 'PNG', r.status);
  check('it can be reopened until it is closed', (await call('GET', `/posts/${postId}/strip`, reader.token)).status === 200);
  await call('POST', `/posts/${postId}/strip/done`, reader.token, { reason: 'done' });
  const seen = await prisma.viewRecord.findFirstOrThrow({ where: { postId, userId: reader.userId } });
  check('"Done reading" counts as having gone through the post', !!seen.completedAt && !!seen.redactedSeenAt);
  check('the day of use is recorded', (await prisma.userActiveDay.count({ where: { userId: reader.userId } })) === 1);
  let groupNow: Reply = { status: 0, json: true, data: null };
  for (let i = 0; i < 20; i++) {
    groupNow = await call('GET', `/groups/${firstGroup}`, reader.token);
    if (groupNow.data?.reviewScore !== null && groupNow.data?.reviewScore !== undefined) break;
    await sleep(100);
  }
  // Two members: the reader went through the post, the other has not yet (and is not late).
  check('the group weight follows at once: reviews and logins',
    groupNow.data.reviewScore === 1 && groupNow.data.loginScore === 1 && groupNow.data.trustScore === 1, groupNow.data);
  check('once closed it is used up', (await call('GET', `/posts/${postId}/strip`, reader.token)).status === 403
    && (await call('GET', `/posts/${postId}`, reader.token)).data.firstLook === 'used');
  check('the author cannot vote', (await call('POST', `/push/${postId}/vote`, u1.token)).status === 403);
  const beforeVote = Date.now();
  r = await call('POST', `/push/${postId}/vote`, reader.token);
  check('one of two votes reaches the threshold and the voter is told the post has moved',
    r.status === 200 && r.data.pushPercentage === 50 && r.data.thresholdReached === true && r.data.moved === true, r.data);

  // No waiting: the post has moved by the time the vote is answered. Only one group is free
  // (the author's is excluded), so however far the push could reach, it goes there.
  let holding = await groupsHolding(postId);
  let moved = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  check('the vote moves the post at once, to the only group it may go to',
    holding.length === 1 && holding[0] !== firstGroup && holding[0] !== groups.A, holding);
  check('the vote that came too late is refused',
    (await call('POST', `/push/${postId}/vote`, second.token)).status === 403);
  r = await call('GET', `/posts/${postId}`, u1.token);
  check('the author sees one group passed and the time it arrived in the new one',
    r.data.journey?.groupsPassed === 1 && Date.parse(r.data.journey.arrivedAt) >= beforeVote - 1000
      && Date.parse(r.data.journey.arrivedAt) > Date.parse(r.data.createdAt), r.data.journey);
  r = await call('GET', '/posts/mine', u1.token);
  check('and the same in their list', r.data[0]._count.history === 1 && Date.parse(r.data[0].arrivedAt) >= beforeVote - 1000, r.data[0]);
  const history = await prisma.postHistory.findMany({ where: { postId } });
  check('the vote share is in its history, with when it arrived, and is its weight',
    history.length === 1 && history[0].groupId === firstGroup && moved.totalWeight === history[0].pushPercentage
      && moved.totalWeight > 0 && history[0].arrivedAt < history[0].movedAt, history);
  check('the group it left can no longer read it', (await call('GET', `/posts/${postId}`, reader.token)).status === 403);

  // ── a post with nowhere to go waits, and moves when a group can take it ──
  // The group it came from loses a member, so it is too small to take the post back.
  const secondGroup = holding[0];
  await prisma.groupMember.deleteMany({ where: { groupId: firstGroup, userId: second.userId } });
  const [nextReader] = membersOf(secondGroup);
  await call('GET', `/posts/${postId}/strip`, nextReader.token);
  r = await call('POST', `/push/${postId}/vote`, nextReader.token);
  check('with no group to go to, the post stays and the voter is told it has not moved',
    r.status === 200 && r.data.thresholdReached === true && r.data.moved === false
      && (await groupsHolding(postId)).join() === secondGroup, r.data);
  check('a vote that changes nothing can be withdrawn',
    (await call('DELETE', `/push/${postId}/vote`, nextReader.token)).status === 200
      && (await call('GET', `/push/${postId}/status`, nextReader.token)).data.voteCount === 0);
  await call('POST', `/push/${postId}/vote`, nextReader.token);

  // The only group with room is the one that lost a member: the new account fills it.
  const newcomer = await register('user_7');
  check('a new account goes to the group with room',
    (await prisma.groupMember.findFirstOrThrow({ where: { userId: newcomer.userId } })).groupId === firstGroup);
  holding = await groupsHolding(postId);
  for (let i = 0; i < 30 && holding.join() !== firstGroup; i++) {
    await sleep(100);
    holding = await groupsHolding(postId);
  }
  moved = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  check('the waiting post moves as soon as that group is big enough', holding.join() === firstGroup, holding);
  check('the second group is in its history and its share is added to the weight',
    (await prisma.postHistory.count({ where: { postId } })) === 2 && moved.totalWeight === 100, moved.totalWeight);
  check('no votes are left behind', (await prisma.pushVote.count({ where: { postId } })) === 0);

  // ── group weight: a post left unread for over a day counts against a member ──
  const longAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await prisma.groupMember.updateMany({ where: { groupId: groups.A }, data: { joinedAt: longAgo } });
  const old = await prisma.post.create({
    data: { originalContent: 'An older post in group A.', redactedContent: 'An older post in group A.', ocUserId: u3.userId, createdAt: longAgo, placements: { create: { groupId: groups.A, arrivedAt: longAgo } } },
  });
  // u1 finished its first look earlier; coming back shows the redacted version.
  await prisma.viewRecord.create({ data: { postId: old.id, userId: u1.userId, completedAt: new Date() } });
  await call('GET', `/posts/${old.id}`, u1.token);
  let weightA: Reply = { status: 0, json: true, data: null };
  for (let i = 0; i < 20; i++) {
    weightA = await call('GET', `/groups/${groups.A}`, u1.token);
    if (weightA.data?.reviewScore === 0.5) break;
    await sleep(100);
  }
  check('one member went through it and one let it sit for days: reviews at half',
    weightA.data.reviewScore === 0.5, weightA.data);
  check('days of use are judged over the days since joining',
    weightA.data.loginScore > 0 && weightA.data.loginScore < 1, weightA.data);

  // ── forwarding to several groups ──
  // Four more groups of two (D to G), so that a push has somewhere to spread.
  const extra: TestUser[] = [];
  for (let i = 1; i <= 8; i++) extra.push(await register(`spread_${i}`));
  await prisma.groupMember.deleteMany({ where: { userId: { in: extra.map((u) => u.userId) } } });
  await prisma.group.deleteMany({ where: { members: { none: {} } } });
  const membersIn = new Map<string, TestUser[]>([[groups.B, [u3, u4]], [groups.C, [u5, u6]]]);
  for (let i = 0; i < 4; i++) {
    const group = await prisma.group.create({ data: { name: `Group ${'DEFG'[i]}` } });
    membersIn.set(group.id, extra.slice(i * 2, i * 2 + 2));
    for (const u of extra.slice(i * 2, i * 2 + 2)) await prisma.groupMember.create({ data: { groupId: group.id, userId: u.userId } });
  }
  // B and C may have changed: whoever is in them now.
  for (const g of [groups.B, groups.C]) {
    const ids = (await prisma.groupMember.findMany({ where: { groupId: g }, select: { userId: true } })).map((m) => m.userId);
    membersIn.set(g, [...users, newcomer].filter((u) => ids.includes(u.userId)));
  }

  r = await call('POST', '/posts', u1.token, { content: 'The night supervisor locks the fire exit during every shift.' });
  const spreadId: string = r.data.id;
  const g0: string = r.data.groupId;
  const [voter, other] = membersIn.get(g0)!;
  // Every other group is weaker except one, which is the best available.
  const others = [...membersIn.keys()].filter((g) => g !== g0);
  const best = others[others.length - 1];
  await prisma.group.updateMany({ where: { id: { in: others } }, data: { trustScore: 0.1 } });
  await prisma.group.update({ where: { id: best }, data: { trustScore: 0.9 } });

  // Both members of g0 go through it, so g0's weight is full: its push reaches 3 groups.
  for (const u of [voter, other]) {
    await call('GET', `/posts/${spreadId}/strip`, u.token);
    await call('POST', `/posts/${spreadId}/strip/done`, u.token, { reason: 'done' });
  }
  r = await call('POST', `/push/${spreadId}/vote`, voter.token);
  holding = await groupsHolding(spreadId);
  check('a full-weight group\'s push reaches 3 groups and the post leaves it',
    r.data.moved === true && holding.length === 3 && !holding.includes(g0) && !holding.includes(groups.A), holding);
  check('with no group better than the pusher, the best-weighted one is among them', holding.includes(best), { best, holding });
  check('the group it left is in its history and its votes are cleared',
    (await prisma.postHistory.count({ where: { postId: spreadId, groupId: g0 } })) === 1
      && (await prisma.pushVote.count({ where: { postId: spreadId } })) === 0);
  check('members of every group holding it can read it',
    (await Promise.all(holding.map((g) => call('GET', `/posts/${spreadId}`, membersIn.get(g)![0].token))))
      .every((x) => x.status === 200 && x.data.groupId !== undefined));
  check('the group it left cannot', (await call('GET', `/posts/${spreadId}`, voter.token)).status === 403);
  check('each group holding it lists it', (await call('GET', `/groups/${holding[0]}`, membersIn.get(holding[0])![0].token))
    .data.currentPosts.some((p: { id: string }) => p.id === spreadId));

  // The author's push: stays where it is, adds as many groups as their weightage allows,
  // but never past five at once.
  r = await call('POST', `/push/${spreadId}/manual`, u1.token);
  const afterManual = await groupsHolding(spreadId);
  check('the author\'s push adds groups and keeps the ones it was in',
    r.status === 200 && r.data.groupsAdded >= 1 && holding.every((g) => afterManual.includes(g))
      && afterManual.length === holding.length + r.data.groupsAdded && afterManual.length <= 5, { r: r.data, afterManual });
  check('it does not say which groups', r.data.newGroupId === undefined && !JSON.stringify(r.data).includes(afterManual[0]));
  check('a second push within 24 hours is refused', (await call('POST', `/push/${spreadId}/manual`, u1.token)).status === 429);
  r = await call('GET', `/posts/${spreadId}`, u1.token);
  check('the author sees how many groups hold it now', r.data.journey?.inGroups === afterManual.length && r.data.journey?.groupsPassed === 1, r.data.journey);
  // The author's map: groups by name and weight, where it has been and where it is, and who sent it.
  r = await call('GET', `/posts/${spreadId}/map`, u1.token);
  const groupName = new Map((await prisma.group.findMany({ select: { id: true, name: true } })).map((g) => [g.id, g.name]));
  const mapNode = (g: string) => r.data.nodes?.find((n: { name: string }) => n.name === groupName.get(g));
  const keyOf = (g: string) => mapNode(g)?.key;
  const edgeSet = new Set((r.data.edges ?? []).map((e: { from: string; to: string; by: string }) => `${e.from}>${e.to}:${e.by}`));
  check('the author\'s map marks the group it passed through and the ones reading it now',
    r.status === 200 && mapNode(g0)?.passed === true && mapNode(g0)?.current === afterManual.includes(g0)
      && afterManual.every((g) => mapNode(g)?.current === true && typeof mapNode(g)?.weight === 'number'
        && !Number.isNaN(Date.parse(mapNode(g)?.arrivedAt))), r.data);
  check('its edges: posted into the first group, that group\'s push, the author\'s push',
    edgeSet.has(`you>${keyOf(g0)}:start`)
      && holding.every((g) => edgeSet.has(`${keyOf(g0)}>${keyOf(g)}:group`))
      && afterManual.filter((g) => !holding.includes(g)).every((g) => edgeSet.has(`you>${keyOf(g)}:author`)), [...edgeSet]);
  check('the map shows groups by name only: no members, no counts, no group ids',
    !/username|members|_count/.test(JSON.stringify(r.data)) && [...groupName.keys()].every((id) => !JSON.stringify(r.data).includes(id)));
  const authorGroups = (await prisma.groupMember.findMany({ where: { userId: u1.userId }, select: { groupId: true } })).map((m) => m.groupId);
  check('every group is on the map; the author\'s own are marked and cannot get it',
    r.data.nodes.length === groupName.size
      && authorGroups.length > 0 && authorGroups.every((g) => mapNode(g)?.own === true && mapNode(g)?.eligible === false), r.data.nodes);
  check('the map counts the groups covered in this round',
    r.data.round === 1 && r.data.coveredGroups === afterManual.length + 1 && r.data.eligibleGroups >= r.data.coveredGroups, r.data);
  check('nobody but the author gets the map', (await call('GET', `/posts/${spreadId}/map`, membersIn.get(afterManual[0])![0].token)).status === 403);
  // Fill it to five, then the author's push has no room left.
  const free = others.filter((g) => !afterManual.includes(g) && g !== g0);
  for (const g of free.slice(0, 5 - afterManual.length)) await prisma.postPlacement.create({ data: { postId: spreadId, groupId: g } });
  await prisma.post.update({ where: { id: spreadId }, data: { lastManualPushAt: new Date(Date.now() - 25 * 3_600_000) } });
  r = await call('POST', `/push/${spreadId}/manual`, u1.token);
  check('a post in five groups cannot be pushed into more', (await groupsHolding(spreadId)).length === 5 && r.status === 409, r.data);

  // ── forwarding in cycles ──
  // A post that has been to every eligible group but one goes to that one first; after that, a
  // new cycle opens the others again.
  const everyone = [...users, newcomer, ...extra];
  const membersOf2 = async (g: string) => (await prisma.groupMember.findMany({ where: { groupId: g }, select: { userId: true } }))
    .map((m) => everyone.find((u) => u.userId === m.userId)).filter((u): u is TestUser => !!u);
  const pushFrom = async (postIdToPush: string, g: string) => {
    const [first] = await membersOf2(g);
    await call('GET', `/posts/${postIdToPush}/strip`, first.token);
    await call('POST', `/posts/${postIdToPush}/strip/done`, first.token, { reason: 'done' });
    return call('POST', `/push/${postIdToPush}/vote`, first.token);
  };
  r = await call('POST', '/posts', u1.token, { content: 'The canteen serves food past its expiry date every single week.' });
  const cycleId: string = r.data.id;
  const startGroup: string = r.data.groupId;
  const u1Groups = new Set((await prisma.groupMember.findMany({ where: { userId: u1.userId }, select: { groupId: true } })).map((m) => m.groupId));
  const eligibleNow = (await prisma.groupMember.groupBy({ by: ['groupId'], _count: { _all: true } }))
    .filter((c) => c._count._all >= 2 && !u1Groups.has(c.groupId)).map((c) => c.groupId);
  const lastFresh = eligibleNow.find((g) => g !== startGroup)!;
  const seenBefore = eligibleNow.filter((g) => g !== startGroup && g !== lastFresh);
  for (const g of seenBefore) {
    await prisma.postHistory.create({ data: { postId: cycleId, groupId: g, pushPercentage: 0, arrivedBy: 'group', fromGroupId: startGroup } });
  }
  r = await pushFrom(cycleId, startGroup);
  let cycleHolding = await groupsHolding(cycleId);
  let cyclePost = await prisma.post.findUniqueOrThrow({ where: { id: cycleId } });
  check('a push goes first to the group the post has not reached in this cycle',
    r.data.moved === true && cycleHolding.includes(lastFresh), { holding: cycleHolding, lastFresh });
  check('more groups than that only by starting a new cycle',
    cycleHolding.length === 1
      ? cyclePost.cycleStartedAt === null
      : cyclePost.cycleStartedAt !== null && cycleHolding.filter((g) => g !== lastFresh).every((g) => seenBefore.includes(g)),
    { holding: cycleHolding, cycleStartedAt: cyclePost.cycleStartedAt });
  const beforeSecond = new Set(cycleHolding);
  r = await pushFrom(cycleId, lastFresh);
  cycleHolding = await groupsHolding(cycleId);
  cyclePost = await prisma.post.findUniqueOrThrow({ where: { id: cycleId } });
  const added = cycleHolding.filter((g) => !beforeSecond.has(g));
  check('once every eligible group has had it, it goes round again',
    r.data.moved === true && added.length >= 1 && added.every((g) => seenBefore.includes(g) || g === startGroup)
      && cyclePost.cycleStartedAt !== null, { added, cycleStartedAt: cyclePost.cycleStartedAt });
  r = await call('GET', `/posts/${cycleId}/map`, u1.token);
  check('the map shows round 2 once every eligible group has had it',
    cyclePost.cycle === 2 && r.data.round === 2 && r.data.coveredGroups <= r.data.eligibleGroups
      && r.data.nodes.filter((n: { covered: boolean; eligible: boolean }) => n.covered && n.eligible).length === r.data.coveredGroups, r.data);

  // ── pseudonyms ──
  const u1Me = (await call('GET', '/auth/me', u1.token)).data;
  check('every member has a pseudonym', /^Voice-[A-Z0-9]{8}$/.test(u1Me.pseudonym) && u1Me.pseudonym !== u1.username, u1Me);
  const holderGroup = cycleHolding[0];
  const holder = (await membersOf2(holderGroup))[0];
  r = await call('GET', `/posts/${cycleId}`, holder.token);
  check('a group sees the author\'s pseudonym, not their username',
    r.status === 200 && r.data.author === u1Me.pseudonym && !JSON.stringify(r.data).includes(u1.username), r.data);
  r = await call('GET', `/groups/${holderGroup}`, holder.token);
  check('and on the group page', r.data.currentPosts.find((p: { id: string }) => p.id === cycleId)?.author === u1Me.pseudonym);

  // ── the common page ──
  const spreadPost = await prisma.post.findUniqueOrThrow({ where: { id: spreadId } });
  check('a post that has reached 20% of the eligible groups is listed',
    spreadPost.listedAt !== null && spreadPost.reachedGroups / spreadPost.eligibleGroups >= 0.2 && spreadPost.spreadScore > 0, spreadPost);
  const allPosts = await prisma.post.findMany({ select: { listedAt: true, reachedGroups: true, eligibleGroups: true } });
  check('no post is listed before it reaches 20%',
    allPosts.every((p) => p.listedAt === null || (p.eligibleGroups > 0 && p.reachedGroups / p.eligibleGroups >= 0.2)), allPosts);
  // Under 20%: one group of more than five.
  const quiet = await prisma.post.create({
    data: { originalContent: 'Quiet post original.', redactedContent: 'Quiet post.', ocUserId: u2.userId, placements: { create: { groupId: startGroup } } },
  });
  await prisma.post.update({ where: { id: spreadId }, data: { spreadScore: 50 } });
  await prisma.post.update({ where: { id: cycleId }, data: { spreadScore: 0.001 } });
  r = await call('GET', '/common', newcomer.token);
  const listedIds = (r.data.posts ?? []).map((p: { id: string }) => p.id);
  const listedSpread = r.data.posts?.find((p: { id: string }) => p.id === spreadId);
  check('every member sees the common page, fastest spreading first',
    r.status === 200 && listedIds.indexOf(spreadId) === 0 && listedIds.includes(cycleId) && !listedIds.includes(quiet.id)
      && listedSpread?.rank === 1, listedIds);
  check('with the redacted version and the author\'s pseudonym only',
    listedSpread?.author === u1Me.pseudonym && typeof listedSpread?.redactedContent === 'string'
      && listedSpread?.originalContent === undefined && !JSON.stringify(r.data).includes(u1.username)
      && typeof listedSpread?.listedAfterMs === 'number', listedSpread);
  check('nobody signed out sees it', (await call('GET', '/common')).status === 401);
  r = await call('GET', '/common/officer', 'test-officer:officer-1');
  const officerSpread = r.data.posts?.find((p: { id: string }) => p.id === spreadId);
  check('an officer sees both versions', r.status === 200 && officerSpread?.originalContent === spreadPost.originalContent
    && officerSpread?.redactedContent === spreadPost.redactedContent && officerSpread?.author === u1Me.pseudonym, officerSpread);
  check('a member\'s token is not an officer\'s', (await call('GET', '/common/officer', u1.token)).status === 401
    && (await call('GET', '/common/officer')).status === 401);

  // ── a member's own weightage ──
  check('time on the site is added to the day',
    (await call('POST', '/auth/heartbeat', reader.token, { seconds: 60 })).status === 200
      && (await call('POST', '/auth/heartbeat', reader.token, { seconds: 100000 })).status === 200
      && (await prisma.userActiveDay.findFirstOrThrow({ where: { userId: reader.userId } })).seconds === 180);
  r = await call('GET', '/auth/weight', reader.token);
  // The reader's group is random, so they may be the member who wrote the older post.
  const readerPosts = await prisma.post.count({ where: { ocUserId: reader.userId } });
  check('the reader sees their own weightage: activity, posting, voting',
    r.status === 200 && r.data.activeDays === 1 && r.data.minutes === 3 && r.data.posts === readerPosts
      && r.data.postScore === (readerPosts > 0 ? 1 : 0) && r.data.reviewed >= 1 && r.data.voteScore > 0
      && r.data.weight > 0 && r.data.weight < 1, r.data);
  r = await call('GET', '/auth/weight', u1.token);
  check('the author gets credit for posting', r.status === 200 && r.data.posts === 3 && r.data.postScore === 1, r.data);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: u1.userId } });
  check('and it is kept on their account', stored.weight === r.data.weight && !!stored.weightUpdatedAt);
  check('nobody else is sent another member\'s weightage',
    !JSON.stringify((await call('GET', `/groups/${groups.A}`, u2.token)).data).includes('"weight"'));

  // ── accounts ──
  check('a comment over 500 characters is refused',
    (await call('POST', `/posts/${postId}/comments`, newcomer.token, { content: 'y'.repeat(501) })).status === 400);
  await sleep(1100);
  r = await call('POST', '/auth/password', u2.token, { currentPassword: PASSWORD, newPassword: 'new-password-2' });
  check('a password change gives a new token and ends the old one',
    r.status === 200 && (await call('GET', '/groups', r.data.token)).status === 200 && (await call('GET', '/groups', u2.token)).status === 401);
  const tries: number[] = [];
  for (let i = 0; i < 4; i++) tries.push((await call('POST', '/auth/login', undefined, { identifier: 'user_3', password: `wrong-${i}` })).status);
  check('wrong passwords are cut off', tries.join() === '401,401,401,429', tries);
  r = await call('GET', '/posts/a%00b', u1.token);
  check('a database error is answered as JSON, without details', r.status === 500 && r.json && !/prisma/i.test(JSON.stringify(r.data)), r.data);
}

async function main(): Promise<void> {
  const migrate = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: ROOT, env, encoding: 'utf8',
  });
  if (migrate.status !== 0) {
    console.error(migrate.stdout, migrate.stderr);
    throw new Error('The migrations could not be applied to the test schema');
  }
  console.log(`Migrations applied to schema ${schema}.`);

  const server = spawn(process.execPath, ['--require', 'ts-node/register/transpile-only', 'src/index.ts'], {
    cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.setEncoding('utf8');
  server.stdout.on('data', (chunk: string) => {
    for (const [, id, code] of chunk.matchAll(/\[local code\] \w+ (\S+) (\d{6})/g)) codes.set(id, code);
  });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await sleep(1000);
      up = await fetch(`${API}/health`).then((res) => res.ok).catch(() => false);
    }
    if (!up) throw new Error('The server did not start');
    await run();
  } finally {
    server.kill();
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
