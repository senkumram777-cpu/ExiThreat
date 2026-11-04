import { categoryLabel, subcategoriesOf } from '@/lib/categories';

/** A post's type of threat as a small tag (its second choice, where it has one); nothing when its author chose none. */
export default function CategoryTag({ category, subcategory, className = '' }: {
  category: string | null | undefined; subcategory?: string | null; className?: string;
}) {
  const label = categoryLabel(category);
  if (!label) return null;
  const second = subcategory ? subcategoriesOf(category ?? '')?.[subcategory] : undefined;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border border-accent-teal/40 text-accent-teal text-[11px] font-mono ${className}`}>
      {second ?? label}
    </span>
  );
}
