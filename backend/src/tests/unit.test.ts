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

test('strip: any text becomes a PNG', async () => {
  const png = await generatePaperStrip('A <b>tag</b> & a control \u0001 character.\nமேலாளர் मेरे');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
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
