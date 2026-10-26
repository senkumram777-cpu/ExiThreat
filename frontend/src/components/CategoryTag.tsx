import { categoryLabel } from '@/lib/categories';

/** A post's type of threat as a small tag; nothing when its author chose none. */
export default function CategoryTag({ category, className = '' }: { category: string | null | undefined; className?: string }) {
  const label = categoryLabel(category);
  if (!label) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full border border-accent-teal/40 text-accent-teal text-[11px] font-mono ${className}`}>
      {label}
    </span>
  );
}
