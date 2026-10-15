/**
 * Unit tests for the parts that need no database: redaction, strip wrapping, weight and the
 * size checks. Run with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { redactContent } from '../services/redactionService';
import { generatePaperStrip, wrapText } from '../services/imageService';
import { weightOf } from '../services/weight';
import { LIMITS, passwordProblem, readText, USERNAME_PATTERN } from '../services/validation';
import { normalizeEmail, normalizePhone } from '../services/contactFormat';
import { groupWeightOf, indiaDay, loginScoreOf } from '../services/groupWeight';
import { activityScoreOf, memberWeightOf, postScoreOf } from '../services/memberWeight';
import { chooseDestinations, chooseInCycle, reachFor } from '../services/forwarding';
import { LIST_SHARE, reachesList, shareOf, spreadScoreOf } from '../services/spread';
import { PSEUDONYM_PATTERN, randomPseudonym } from '../services/pseudonym';
import { buildGroupMap } from '../services/groupMap';

/** Asserts that none of `secrets` survives redaction of `text`, and returns the result. */
function hides(text: string, ...secrets: string[]): string {
  const out = redactContent(text);
  for (const secret of secrets) assert.ok(!out.includes(secret), `"${secret}" survived in: ${out}`);
  return out;
}

test('redaction: contact details', () => {
  hides('Write to ravi.kumar@example.co.in or see https://example.com/x and www.example.org',
    'ravi.kumar', 'example.com', 'example.org');
  hides('Pay me at ravi99@okhdfcbank today', 'ravi99');
  hides('Call 9876543210 or +91 98765 43210 or 098765 43210', '9876543210', '98765 43210');
  hides('Office line 044-23456789, US line (415) 555-2671', '23456789', '555-2671');
});

test('redaction: identity numbers', () => {
  hides('Aadhaar 2345 6789 0123 and 234567890123', '2345 6789 0123', '234567890123');
  hides('PAN ABCDE1234F, GSTIN 33ABCDE1234F1Z5, IFSC HDFC0001234', 'ABCDE1234F', '33ABCDE', 'HDFC0001234');
  hides('His car TN 09 AB 1234 and bike KA-01-C-5678', 'TN 09 AB 1234', 'KA-01-C-5678');
  hides('SSN 123-45-6789', '123-45-6789');
});

test('redaction: dates and addresses', () => {
  hides('Born 12/03/1990, joined 5 March 2019 and left on March 5, 2021', '12/03/1990', '5 March 2019', 'March 5, 2021');
  hides('Lives at Door No 14/2, 3rd Cross, Gandhi Nagar, Chennai 600042', '14/2', '3rd Cross', 'Gandhi Nagar', '600042');
  hides('The office is at 221 Baker Street and Flat 4B, Sector 21', '221 Baker', '4B', 'Sector 21');
});

test('redaction: names', () => {
  hides('Mr. Ravi Kumar and Dr Anita Desai and Smt. Lakshmi were there', 'Ravi', 'Kumar', 'Anita', 'Desai', 'Lakshmi');
  hides('S. Ramakrishnan and R.K. Narayan signed it', 'Ramakrishnan', 'Narayan');
  hides('My manager Ravi shouted, and a guard called Anil watched', 'Ravi', 'Anil');
  hides('Then Priya Sharma told Arjun Mehta Singh about it', 'Priya', 'Sharma', 'Arjun', 'Mehta', 'Singh');
});

test('redaction: companies', () => {
  hides('I work at Sunrise Textiles and before that at Acme Solutions Pvt Ltd.', 'Sunrise', 'Acme');
  assert.match(redactContent('At Sunrise Textiles we had no breaks'), /^At \[COMPANY REDACTED\] we/);
});

test('redaction: ordinary words are left alone', () => {
  const same = (text: string) => assert.equal(redactContent(text), text);
  same('The Human Resources Department did nothing.');
  same('On Monday the manager shouted at the night shift staff.');
  same('The Company refused. Our Team Lead agreed.');
  same('my manager shouted and the supervisor laughed');
  same('I was paid Rs 45000 instead of ₹1,20,000, about 25000 rupees less per month.');
  same('It happened 3 times in 2024, to 12 workers.');
  // A role word in front of a name stays readable.
  assert.equal(redactContent('The Manager Ravi Kumar refused'), 'The Manager [NAME REDACTED] refused');
});

test('redaction: labels are not redacted a second time', () => {
  const once = redactContent('Mr. Ravi Kumar, 9876543210, ravi@example.com');
  assert.equal(redactContent(once), once);
});

test('strip: lines break between words and never exceed 25 characters', () => {
  const lines = wrapText('My manager at the warehouse threatened to cancel my leave unless I worked.');
  assert.ok(lines.every((l) => Array.from(l).length <= 25), JSON.stringify(lines));
  assert.equal(lines.join(' '), 'My manager at the warehouse threatened to cancel my leave unless I worked.');
  assert.deepEqual(wrapText('a\n\nb'), ['a', '', 'b']);
  assert.deepEqual(wrapText('x'.repeat(60)).map((l) => l.length), [25, 25, 10]);
  // Characters outside the basic plane count as one and are never cut in half.
  assert.deepEqual(wrapText('😀'.repeat(30)).map((l) => Array.from(l).length), [25, 5]);
});

test('strip: any text becomes a PNG of rows, each as wide as its text', async () => {
  const strip = await generatePaperStrip('A <b>tag</b> & a control \u0001 character.\nமேலாளர் मेरे');
  assert.equal(strip.png.subarray(1, 4).toString(), 'PNG');
  assert.equal(strip.rows.length, 1);
  const long = await generatePaperStrip(`${'word '.repeat(30)}end`);
  assert.equal(long.rows.length, 3);
  assert.ok(long.rows[2] < long.rows[0], JSON.stringify(long.rows));
  assert.ok(long.rows.every((w) => w > 0 && w < 60 * 32), JSON.stringify(long.rows));
});

test('weight: one count per group, manual pushes carry nothing, at most 100 each', () => {
  const entry = (groupId: string, pushPercentage: number, wasManualPush = false) => ({ groupId, pushPercentage, wasManualPush });
  assert.equal(weightOf([]), 0);
  assert.equal(weightOf([entry('a', 60), entry('b', 75)]), 135);
  assert.equal(weightOf([entry('a', 60), entry('a', 90)]), 60);
  assert.equal(weightOf([entry('a', 0, true), entry('a', 60)]), 60);
  assert.equal(weightOf([entry('a', 250)]), 100);
});

test('validation: text sizes', () => {
  assert.deepEqual(readText('  hello  ', 'content', 10), { ok: true, text: 'hello' });
  assert.equal(readText('   ', 'content', 10).ok, false);
  assert.equal(readText('x'.repeat(11), 'content', 10).ok, false);
  assert.equal(readText({ a: 1 }, 'content', 10).ok, false);
  assert.equal(readText('short', 'content', LIMITS.postMax, LIMITS.postMin).ok, false);
});

test('validation: passwords and usernames', () => {
  assert.equal(passwordProblem('long-enough-1'), null);
  assert.ok(passwordProblem('short'));
  assert.ok(passwordProblem('p'.repeat(73)));
  assert.ok(passwordProblem(12345678));
  assert.ok(USERNAME_PATTERN.test('Asha_1.k-2'));
  assert.ok(!USERNAME_PATTERN.test('bad name!'));
});

test('contact details: one form per inbox and per number', () => {
  assert.equal(normalizeEmail(' Asha.K+work@GMAIL.com '), 'ashak@gmail.com');
  assert.equal(normalizeEmail('asha.k@googlemail.com'), 'ashak@gmail.com');
  assert.equal(normalizeEmail('Ravi.Kumar@Example.co.in'), 'ravi.kumar@example.co.in');
  assert.equal(normalizeEmail('no-at-sign.example.com'), null);
  for (const written of ['9876543210', '+91 98765 43210', '098765-43210', '91 9876543210', '(+91) 98765.43210']) {
    assert.equal(normalizePhone(written), '919876543210', written);
  }
  for (const wrong of ['5876543210', '98765', '+1 415 555 2671', 'asha', '98765432101']) {
    assert.equal(normalizePhone(wrong), null, wrong);
  }
});

test('group weight: logins and reviews count equally', () => {
  // Every other day of a 30-day window is full marks; a week is about half.
  assert.equal(loginScoreOf({ activeDays: 15, possibleDays: 30, reviewed: 0, due: 0 }), 1);
  assert.equal(loginScoreOf({ activeDays: 7, possibleDays: 30, reviewed: 0, due: 0 }).toFixed(2), '0.47');
  // Someone who joined yesterday is judged on the days they have had.
  assert.equal(loginScoreOf({ activeDays: 1, possibleDays: 1, reviewed: 0, due: 0 }), 1);

  const g = groupWeightOf([
    { activeDays: 15, possibleDays: 30, reviewed: 4, due: 4 },
    { activeDays: 0, possibleDays: 30, reviewed: 0, due: 4 },
  ]);
  assert.equal(g.loginScore, 0.5);
  assert.equal(g.reviewScore, 0.5);
  assert.equal(g.weight, 0.5);

  // No posts yet: weighed on logins alone.
  const quiet = groupWeightOf([{ activeDays: 15, possibleDays: 30, reviewed: 0, due: 0 }]);
  assert.equal(quiet.reviewScore, null);
  assert.equal(quiet.weight, 1);
  assert.equal(groupWeightOf([]).weight, 0);
});

test('group weight: days are counted in India', () => {
  assert.equal(indiaDay(new Date('2026-10-14T20:00:00Z')), '2026-10-15');
  assert.equal(indiaDay(new Date('2026-10-14T10:00:00Z')), '2026-10-14');
});

test('member weight: activity, posting and voting', () => {
  const base = { possibleDays: 30, activeDays: 0, seconds: 0, posts: 0, reviewed: 0, due: 0 };
  // Every other day, ten minutes each time: full activity. Days without time: half.
  assert.equal(activityScoreOf({ ...base, activeDays: 15, seconds: 15 * 10 * 60 }), 1);
  assert.equal(activityScoreOf({ ...base, activeDays: 15 }), 0.5);
  // A post a week is full marks; more adds nothing.
  assert.equal(postScoreOf({ ...base, posts: 2 }).toFixed(2), '0.47');
  assert.equal(postScoreOf({ ...base, posts: 9 }), 1);
  // New member, first day: one post is full marks.
  assert.equal(postScoreOf({ ...base, possibleDays: 1, posts: 1 }), 1);

  const all = memberWeightOf({ ...base, activeDays: 15, seconds: 15 * 600, posts: 5, reviewed: 1, due: 2 });
  assert.equal(all.voteScore, 0.5);
  assert.equal(all.weight.toFixed(3), ((1 + 1 + 0.5) / 3).toFixed(3));
  // No post to go through yet: voting is left out.
  const early = memberWeightOf({ ...base, activeDays: 15, seconds: 15 * 600 });
  assert.equal(early.voteScore, null);
  assert.equal(early.weight, 0.5);
});

test('forwarding: reach follows the pusher\'s weight', () => {
  assert.deepEqual([0, 0.39, 0.4, 0.69, 0.7, 1].map(reachFor), [1, 1, 2, 2, 3, 3]);
});

test('forwarding: at least one better-weighted group, new groups first', () => {
  const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };
  const groups = [
    { id: 'low', weight: 0.2, visited: false },
    { id: 'mid', weight: 0.5, visited: false },
    { id: 'high', weight: 0.8, visited: false },
    { id: 'old-high', weight: 0.9, visited: true },
  ];
  for (let run = 0; run < 20; run++) {
    const picked = chooseDestinations(groups, 2, 0.6, seq([Math.random()]));
    // The first is better than 0.6, and a group it has not been in comes before one it has.
    assert.equal(picked[0], 'high');
    assert.equal(picked.length, 2);
    assert.notEqual(picked[1], 'old-high');
  }
  // Nothing better than the pusher: the best available comes first.
  assert.equal(chooseDestinations(groups.slice(0, 2), 1, 0.95)[0], 'mid');
  // Only visited groups better: one of them is still taken.
  assert.equal(chooseDestinations(groups, 1, 0.85)[0], 'old-high');
  // Never more than there are, never a group twice.
  const all = chooseDestinations(groups, 9, 0);
  assert.equal(new Set(all).size, 4);
  assert.deepEqual(chooseDestinations([], 3, 0), []);
  assert.deepEqual(chooseDestinations(groups, 0, 0), []);
});

test('group map: every group, path, rounds, edges, no ids', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
  const g = (id: string, name: string, weight: number, eligible = true, own = false) => ({ id, name, weight, eligible, own });
  const groups = [
    g('id-a', 'Group A', 0.5),
    g('id-b', 'Group B', 0.8),
    g('id-c', 'Group C', 0.3),
    g('id-d', 'Group D', 0.9),
    g('id-e', 'Group E', 0.1),
    g('id-f', 'Group F', 0.7),
    g('id-own', 'Group Own', 0.6, false, true),
    g('id-small', 'Group Small', 0.95, false),
  ];
  const arrivals = [
    { groupId: 'id-b', arrivedBy: 'group', fromGroupId: 'id-a', arrivedAt: t(2), current: true },
    { groupId: 'id-a', arrivedBy: 'start', fromGroupId: null, arrivedAt: t(1), current: false },
    { groupId: 'id-c', arrivedBy: 'group', fromGroupId: 'id-a', arrivedAt: t(2), current: false },
    { groupId: 'id-d', arrivedBy: 'author', fromGroupId: null, arrivedAt: t(3), current: true },
  ];
  const map = buildGroupMap(groups, arrivals, 1, t(0));
  // The path in the order it was reached, then every other group: eligible ones first, best weighted first.
  assert.deepEqual(map.nodes.map((n) => n.name),
    ['Group A', 'Group B', 'Group C', 'Group D', 'Group F', 'Group E', 'Group Small', 'Group Own']);
  const node = (name: string) => map.nodes.find((n) => n.name === name)!;
  assert.deepEqual([node('Group A').passed, node('Group A').current, node('Group A').covered], [true, false, true]);
  assert.deepEqual([node('Group B').passed, node('Group B').current], [false, true]);
  assert.equal(node('Group B').arrivedAt, t(2).toISOString());
  assert.equal(node('Group A').arrivedAt, null);
  assert.deepEqual([node('Group Own').own, node('Group Own').eligible, node('Group Small').eligible], [true, false, false]);
  // Round 1: A, B, C, D of the 6 eligible groups.
  assert.deepEqual([map.round, map.eligibleGroups, map.coveredGroups], [1, 6, 4]);
  const name = (key: string) => (key === 'you' ? 'you' : map.nodes.find((n) => n.key === key)!.name);
  assert.deepEqual(
    map.edges.map((e) => `${name(e.from)}>${name(e.to)}:${e.by}`),
    ['you>Group A:start', 'Group A>Group B:group', 'Group A>Group C:group', 'you>Group D:author'],
  );
  assert.ok(!JSON.stringify(map).includes('id-'), 'group ids must not be sent');

  // Round 2 began after C: only the groups reached since, and those it is in now, are covered.
  const round2 = buildGroupMap(groups, arrivals, 2, t(2) /* B and C arrived at this moment */);
  assert.equal(round2.round, 2);
  assert.deepEqual(round2.nodes.filter((n) => n.covered).map((n) => n.name), ['Group B', 'Group C', 'Group D']);
  const round2b = buildGroupMap(groups, arrivals, 2, t(3));
  assert.deepEqual(round2b.nodes.filter((n) => n.covered).map((n) => n.name), ['Group B', 'Group D']);
  assert.equal(round2b.coveredGroups, 2);
});

test('forwarding in cycles: groups not reached in this cycle first, then a new cycle', () => {
  const groups = [
    { id: 'seen-high', weight: 0.9, visited: true },
    { id: 'seen-low', weight: 0.1, visited: true },
    { id: 'fresh-low', weight: 0.2, visited: false },
  ];
  // One place: the fresh group, even though a visited one is better weighted.
  assert.deepEqual(chooseInCycle(groups, 1, 0.5), { destinations: ['fresh-low'], newCycle: false });
  // More places than fresh groups: a new cycle fills them from the others.
  const two = chooseInCycle(groups, 2, 0.5);
  assert.equal(two.destinations[0], 'fresh-low');
  assert.equal(two.newCycle, true);
  assert.equal(two.destinations.length, 2);
  // Everything reached: a new cycle, and the better-weighted rule applies there.
  const all = chooseInCycle(groups.slice(0, 2), 1, 0.5);
  assert.deepEqual(all, { destinations: ['seen-high'], newCycle: true });
  assert.deepEqual(chooseInCycle([], 3, 0), { destinations: [], newCycle: false });
});

test('spread: share, listing at 20%, score per day', () => {
  assert.equal(shareOf(1, 5), 0.2);
  assert.equal(shareOf(9, 5), 1);
  assert.equal(shareOf(3, 0), 0);
  assert.equal(LIST_SHARE, 0.2);
  assert.ok(reachesList(shareOf(1, 5)));
  assert.ok(!reachesList(shareOf(1, 6)));
  const day = 24 * 3600_000;
  // 20% in one day is 0.2 a day; the same share in two days scores half.
  assert.equal(spreadScoreOf(0.2, day), 0.2);
  assert.equal(spreadScoreOf(0.2, 2 * day), 0.1);
  // Faster is higher; under an hour counts as an hour.
  assert.ok(spreadScoreOf(0.2, 3600_000) > spreadScoreOf(0.4, 3 * day));
  assert.equal(spreadScoreOf(0.2, 1000), spreadScoreOf(0.2, 3600_000));
});

test('pseudonyms: format and variety', () => {
  const names = new Set(Array.from({ length: 200 }, randomPseudonym));
  assert.ok([...names].every((n) => PSEUDONYM_PATTERN.test(n)));
  assert.ok(names.size > 195);
});
