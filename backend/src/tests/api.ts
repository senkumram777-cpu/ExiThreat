/**
 * API test: starts the real server against an empty, throwaway PostgreSQL schema and walks
 * through the rules that matter: who can read what, the first look, voting and moving, and
 * the account limits. Run with `npm run test:api`.
 *
 * Needs DATABASE_URL to point at a PostgreSQL server it may create a schema on (the local
 * development database is fine: it works in a schema of its own and removes it afterwards).
 * The schema is built with `prisma migrate deploy`, so this also proves the migrations.
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
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

async function register(username: string): Promise<TestUser> {
  return (await call('POST', '/auth/register', undefined, { username, password: PASSWORD })).data;
}

async function run(): Promise<void> {
  check('health answers, database included', (await call('GET', '/health')).status === 200);

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
  check('a post goes to a group its author is not in', r.status === 201 && r.data.currentGroupId !== groups.A, r.data);
  const postId: string = r.data.id;
  const firstGroup: string = r.data.currentGroupId;
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
  check('the author sees it has passed no group and arrived when it was posted',
    r.data.journey?.groupsPassed === 0 && r.data.journey?.arrivedAt === r.data.createdAt, r.data.journey);
  check('a member is not sent the journey', (await call('GET', `/posts/${postId}`, reader.token)).data.journey === undefined);

  // ── first look and votes ──
  check('no vote before the first look', (await call('POST', `/push/${postId}/vote`, reader.token)).status === 403);
  r = await call('GET', `/posts/${postId}/strip`, reader.token);
  check('the first look is a PNG', r.status === 200 && !r.json && r.data.subarray(1, 4).toString() === 'PNG', r.status);
  check('it can be reopened until it is closed', (await call('GET', `/posts/${postId}/strip`, reader.token)).status === 200);
  await call('POST', `/posts/${postId}/strip/done`, reader.token);
  check('once closed it is used up', (await call('GET', `/posts/${postId}/strip`, reader.token)).status === 403
    && (await call('GET', `/posts/${postId}`, reader.token)).data.firstLook === 'used');
  check('the author cannot vote', (await call('POST', `/push/${postId}/vote`, u1.token)).status === 403);
  const beforeVote = Date.now();
  r = await call('POST', `/push/${postId}/vote`, reader.token);
  check('one of two votes reaches the threshold and the voter is told the post has moved',
    r.status === 200 && r.data.pushPercentage === 50 && r.data.thresholdReached === true && r.data.moved === true, r.data);

  // No waiting: the post has moved by the time the vote is answered.
  let moved = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  check('the vote moves the post at once, to the group it has not been in',
    moved.currentGroupId !== firstGroup && moved.currentGroupId !== groups.A, moved.currentGroupId);
  check('the vote that came too late is refused',
    (await call('POST', `/push/${postId}/vote`, second.token)).status === 403);
  r = await call('GET', `/posts/${postId}`, u1.token);
  check('the author sees one group passed and the time it arrived in the new one',
    r.data.journey?.groupsPassed === 1 && Date.parse(r.data.journey.arrivedAt) >= beforeVote - 1000
      && Date.parse(r.data.journey.arrivedAt) > Date.parse(r.data.createdAt), r.data.journey);
  r = await call('GET', '/posts/mine', u1.token);
  check('and the same in their list', r.data[0]._count.history === 1 && Date.parse(r.data[0].arrivedAt) >= beforeVote - 1000, r.data[0]);
  const history = await prisma.postHistory.findMany({ where: { postId } });
  check('the vote share is in its history and is its weight',
    history.length === 1 && history[0].groupId === firstGroup && moved.totalWeight === history[0].pushPercentage && moved.totalWeight > 0, history);
  check('the group it left can no longer read it', (await call('GET', `/posts/${postId}`, reader.token)).status === 403);

  // ── a post with nowhere to go waits, and moves when a group can take it ──
  // The group it came from loses a member, so it is too small to take the post back.
  const secondGroup = moved.currentGroupId;
  await prisma.groupMember.deleteMany({ where: { groupId: firstGroup, userId: second.userId } });
  const [nextReader] = membersOf(secondGroup);
  await call('GET', `/posts/${postId}/strip`, nextReader.token);
  r = await call('POST', `/push/${postId}/vote`, nextReader.token);
  check('with no group to go to, the post stays and the voter is told it has not moved',
    r.status === 200 && r.data.thresholdReached === true && r.data.moved === false
      && (await prisma.post.findUniqueOrThrow({ where: { id: postId } })).currentGroupId === secondGroup, r.data);
  check('a vote that changes nothing can be withdrawn',
    (await call('DELETE', `/push/${postId}/vote`, nextReader.token)).status === 200
      && (await call('GET', `/push/${postId}/status`, nextReader.token)).data.voteCount === 0);
  await call('POST', `/push/${postId}/vote`, nextReader.token);

  // The only group with room is the one that lost a member: the new account fills it.
  const newcomer = await register('user_7');
  check('a new account goes to the group with room',
    (await prisma.groupMember.findFirstOrThrow({ where: { userId: newcomer.userId } })).groupId === firstGroup);
  moved = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  for (let i = 0; i < 30 && moved.currentGroupId === secondGroup; i++) {
    await sleep(100);
    moved = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  }
  check('the waiting post moves as soon as that group is big enough', moved.currentGroupId === firstGroup, moved.currentGroupId);
  check('the second group is in its history and its share is added to the weight',
    (await prisma.postHistory.count({ where: { postId } })) === 2 && moved.totalWeight === 100, moved.totalWeight);
  check('no votes are left behind', (await prisma.pushVote.count({ where: { postId } })) === 0);

  // ── accounts ──
  check('a comment over 500 characters is refused',
    (await call('POST', `/posts/${postId}/comments`, newcomer.token, { content: 'y'.repeat(501) })).status === 400);
  await sleep(1100);
  r = await call('POST', '/auth/password', u2.token, { currentPassword: PASSWORD, newPassword: 'new-password-2' });
  check('a password change gives a new token and ends the old one',
    r.status === 200 && (await call('GET', '/groups', r.data.token)).status === 200 && (await call('GET', '/groups', u2.token)).status === 401);
  const tries: number[] = [];
  for (let i = 0; i < 4; i++) tries.push((await call('POST', '/auth/login', undefined, { username: 'user_3', password: `wrong-${i}` })).status);
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
    cwd: ROOT, env, stdio: ['ignore', 'ignore', 'inherit'],
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
