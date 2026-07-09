'use client';

import { IconChevronRight } from '@tabler/icons-react';
import { type ComponentPropsWithoutRef, forwardRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** A small ghost icon button with a hover tooltip + accessible label — the
 *  standard trailing action for list rows. */
export function TooltipIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** A truncating line that reveals its full text in a shadcn tooltip on hover
 *  (only when the content is a plain string we can echo). */
function TruncText({ className, text }: { className: string; text: ReactNode }) {
  if (typeof text !== 'string') {
    return <span className={className}>{text}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className={className} />}>{text}</TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

/** Shared visual for the panel list rows (Manage Points actions, utility
 *  inventory, field comparisons) so they read as one consistent component.
 *  `ListRowButton` is the whole-row button variant (dialog triggers /
 *  navigation); `ListRow` is a container variant for rows that carry their own
 *  action buttons and/or a row-level click. */

const ROW_BASE = 'flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors';
const ROW_INTERACTIVE = 'bg-muted/50 hover:bg-muted cursor-pointer';
const ROW_SELECTED = 'bg-primary/10 ring-1 ring-primary/30';

interface RowContent {
  /** Right-aligned affordance inside the content (e.g. a "Select" cue). */
  hint?: ReactNode;
  /** Leading icon or color swatch. */
  leading?: ReactNode;
  /** Optional extra line under the subtitle (e.g. tag chips). */
  meta?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}

function RowBody({ hint, leading, meta, subtitle, title }: RowContent) {
  // Truncating lines reveal their full text in a shadcn tooltip on hover.
  return (
    <>
      {leading ? <span className="text-muted-foreground shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <TruncText className="block truncate font-medium" text={title} />
        {subtitle ? (
          <TruncText className="text-muted-foreground block truncate text-sm" text={subtitle} />
        ) : null}
        {meta}
      </span>
      {hint ? <span className="shrink-0">{hint}</span> : null}
    </>
  );
}

/** Whole-row button — icon, title, subtitle, trailing chevron. Forwards props so
 *  it works as a dialog trigger (base-ui injects onClick/ref). */
export const ListRowButton = forwardRef<
  HTMLButtonElement,
  RowContent & { trailing?: ReactNode } & ComponentPropsWithoutRef<'button'>
>(function ListRowButton(
  { className, hint, leading, meta, subtitle, title, trailing, ...props },
  ref,
) {
  return (
    <button ref={ref} type="button" className={cn(ROW_BASE, ROW_INTERACTIVE, className)} {...props}>
      <RowBody leading={leading} title={title} subtitle={subtitle} meta={meta} hint={hint} />
      {trailing ?? <IconChevronRight className="text-muted-foreground size-4 shrink-0" />}
    </button>
  );
});

/** Container row for lists whose rows carry their own action buttons. When
 *  `onClick` is set the content region becomes clickable (the row toggles /
 *  opens) while `actions` stay independently clickable beside it. */
export function ListRow({
  actions,
  className,
  hint,
  leading,
  meta,
  onClick,
  selected,
  subtitle,
  title,
}: RowContent & {
  /** Trailing action buttons (delete, etc.) — independent of the row click. */
  actions?: ReactNode;
  /** Makes the content region clickable (row toggle / open). */
  onClick?: () => void;
  /** Highlights the row as active. */
  selected?: boolean;
  className?: string;
}) {
  // One box holds both the (optionally clickable) content and the trailing
  // actions, so the delete button sits inside the row on the right.
  return (
    <div
      className={cn(
        'flex items-center rounded-xl',
        selected ? ROW_SELECTED : onClick ? ROW_INTERACTIVE : 'bg-muted/50',
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(ROW_BASE, 'min-w-0 flex-1 bg-transparent hover:bg-transparent')}
        >
          <RowBody leading={leading} title={title} subtitle={subtitle} meta={meta} hint={hint} />
        </button>
      ) : (
        <div className={cn(ROW_BASE, 'min-w-0 flex-1')}>
          <RowBody leading={leading} title={title} subtitle={subtitle} meta={meta} hint={hint} />
        </div>
      )}
      {actions ? <div className="flex shrink-0 items-center pr-2">{actions}</div> : null}
    </div>
  );
}
