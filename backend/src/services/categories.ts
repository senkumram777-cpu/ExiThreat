/**
 * The type of threat a post is about, chosen by its author when posting (optional). ExiThreat
 * covers any threat to a person, not only abuse at work. Stored as the key; the website shows the
 * label (frontend/src/lib/categories.ts keeps the same list).
 */
export const CATEGORIES = {
  workplace: 'Workplace',
  street: 'Street or public place',
  neighbourhood: 'Neighbourhood',
  official: 'Police or government official',
  sexual: 'Sexual abuse',
  physical: 'Physical abuse',
  domestic: 'Domestic or family',
  online: 'Online',
  other: 'Other',
} as const;

export type Category = keyof typeof CATEGORIES;

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

/** A post's category from a request: missing or empty means none was chosen. */
export function readCategory(value: unknown): { ok: true; category: Category | null } | { ok: false; error: string } {
  if (value === undefined || value === null || value === '') return { ok: true, category: null };
  if (isCategory(value)) return { ok: true, category: value };
  return { ok: false, error: 'Unknown type of threat' };
}
