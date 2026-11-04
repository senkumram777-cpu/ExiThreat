/**
 * The type of threat a post is about, chosen by its author (optional). The same list as the
 * server's backend/src/services/categories.ts; the server stores the key.
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

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as Category[];

/** The label for a stored key; null for a post with none (or a key this website does not know). */
export function categoryLabel(key: string | null | undefined): string | null {
  return key && key in CATEGORIES ? CATEGORIES[key as Category] : null;
}

/**
 * The second choice under a type, where it has one (the server's SUBCATEGORIES). Posting asks
 * for it once that type is chosen. A complaint about the police is withheld from officers until
 * its author allows it.
 */
export const SUBCATEGORIES: Partial<Record<Category, Record<string, string>>> = {
  official: {
    police: 'Police or law enforcement',
    other: 'Other government official',
  },
};

/** The second choices for a type, or null when it has none. */
export function subcategoriesOf(category: string): Record<string, string> | null {
  return (category && SUBCATEGORIES[category as Category]) || null;
}

