/**
 * AI redaction: the redactor service (../../../redactor, GLiNER on Fly's private network at
 * REDACTOR_URL) finds names, places and organisations that the patterns miss, such as names in
 * lower case, a name on its own, or a place with no word like "Nagar" or "Station" after it. It
 * works on English text (Indian names written in English letters included); it finds next to
 * nothing in Tamil, Hindi or other scripts, so those rely on the author's own check. Its findings are hidden first and
 * then the patterns of redactionService run on the result, so together they hide everything
 * either one finds: the model can add redactions, never remove one.
 *
 * Without REDACTOR_URL (development, tests) only the patterns run. The redactor sleeps when
 * idle, so the first request after a quiet spell waits while it starts; `warmRedactor` starts it
 * early, when someone opens the page for writing a disclosure.
 */

import { isOrdinaryPhrase, isOrdinaryWord, redactContent } from './redactionService';

/** What the model is asked to find, and the label that replaces each. */
export const AI_LABELS: Record<string, string> = {
  person: '[NAME REDACTED]',
  'nickname': '[NAME REDACTED]',
  'location': '[PLACE REDACTED]',
  'village or town': '[PLACE REDACTED]',
  'street or area': '[ADDRESS REDACTED]',
  'landmark': '[PLACE REDACTED]',
  'police station': '[PLACE REDACTED]',
  'government office': '[PLACE REDACTED]',
  'school or college': '[PLACE REDACTED]',
  'shop or business': '[PLACE REDACTED]',
  'organization': '[COMPANY REDACTED]',
  'company': '[COMPANY REDACTED]',
};
// What the labels hide is a person; anything else must be written like a name to count.
const PERSON_LABELS = new Set(['person', 'nickname']);
const THRESHOLD = 0.45;
// Long enough for a machine that was asleep to start and load the model.
const TIMEOUT_MS = Number(process.env.REDACTOR_TIMEOUT_MS) || 45_000;

export interface Entity {
  start: number;
  end: number;
  label: string;
}

/**
 * Narrows a finding to the name in it: ordinary words at either end ("the clerk Selvam" →
 * "Selvam") are left readable. Null when nothing but ordinary words is left.
 */
function trimmed(text: string, e: Entity): Entity | null {
  const words = [...text.slice(e.start, e.end).matchAll(/\S+/g)]
    .map((m) => ({ start: e.start + m.index!, end: e.start + m.index! + m[0].length, word: m[0] }));
  while (words.length && isOrdinaryWord(words[0].word)) words.shift();
  while (words.length && isOrdinaryWord(words[words.length - 1].word)) words.pop();
  if (!words.length) return null;
  const phrase = text.slice(words[0].start, words[words.length - 1].end);
  if (isOrdinaryPhrase(phrase)) return null;
  // A place or organisation in plain lower case is an ordinary noun ("the canteen", "my office");
  // a person in lower case is not ("my neighbour ravi").
  if (!PERSON_LABELS.has(e.label) && /^[^A-Z]*$/.test(phrase) && /[a-z]/.test(phrase)) return null;
  // Keep trailing punctuation outside the label: "Ravi," → "[NAME REDACTED],".
  const end = words[words.length - 1].start + words[words.length - 1].word.replace(/[^\p{L}\p{N}]+$/u, '').length;
  return end > words[0].start ? { start: words[0].start, end, label: e.label } : null;
}

/**
 * Replaces the entities' spans in `text` with their labels. Overlapping spans are joined, and
 * ordinary words ("the police station", "my mother-in-law") are left alone.
 */
export function applyEntities(text: string, entities: Entity[]): string {
  const spans = entities
    .filter((e) => Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.end <= text.length && e.start < e.end)
    .filter((e) => AI_LABELS[e.label])
    .map((e) => trimmed(text, e))
    .filter((e): e is Entity => e !== null)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let at = 0;
  for (let i = 0; i < spans.length; i++) {
    let { start, end } = spans[i];
    const label = AI_LABELS[spans[i].label];
    // Join the ones that overlap this one; the first (widest) one's label wins.
    while (i + 1 < spans.length && spans[i + 1].start < end) end = Math.max(end, spans[++i].end);
    if (start < at) start = at;
    out += text.slice(at, start) + label;
    at = end;
  }
  return out + text.slice(at);
}

async function askRedactor(text: string): Promise<Entity[]> {
  const res = await fetch(`${process.env.REDACTOR_URL}/entities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, labels: Object.keys(AI_LABELS), threshold: THRESHOLD }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`redactor answered ${res.status}`);
  const data = (await res.json()) as { entities?: Entity[] };
  if (!Array.isArray(data.entities)) throw new Error('redactor answered without entities');
  return data.entities;
}

export function aiRedactionEnabled(): boolean {
  return !!process.env.REDACTOR_URL;
}

/**
 * The redacted version of `text`: the AI's findings and the patterns together. `aiChecked` is
 * false when only the patterns ran (no redactor configured, or it failed or took too long).
 */
export async function redactWithAi(text: string): Promise<{ redactedContent: string; aiChecked: boolean }> {
  if (!aiRedactionEnabled()) return { redactedContent: redactContent(text), aiChecked: false };
  try {
    const entities = await askRedactor(text);
    return { redactedContent: redactContent(applyEntities(text, entities)), aiChecked: true };
  } catch (err) {
    // Never the text itself: it is a disclosure.
    console.error('AI redaction failed:', (err as Error).message);
    return { redactedContent: redactContent(text), aiChecked: false };
  }
}

/** Starts a sleeping redactor without waiting for it. */
export function warmRedactor(): void {
  if (!aiRedactionEnabled()) return;
  fetch(`${process.env.REDACTOR_URL}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {});
}
