import { cn } from '@/lib/utils';

/** The small round color swatch used wherever a point category is shown. */
export function CategoryDot({ className, color }: { color: string; className?: string }) {
  return (
    <span className={cn('size-2.5 rounded-full', className)} style={{ backgroundColor: color }} />
  );
}

/** A category's color dot followed by its name (inline). */
export function CategoryChip({ color, name }: { color: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CategoryDot color={color} />
      {name}
    </span>
  );
}
