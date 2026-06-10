'use client';

import { IconFileImport, IconLayoutGrid, IconMapPin, IconTransform } from '@tabler/icons-react';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Step {
  /** Label for the action button. */
  action: string;
  description: string;
  done: boolean;
  icon: typeof IconLayoutGrid;
  key: string;
  label: string;
  /** Element id / tab target to navigate to. */
  target: string;
}

type Status = 'done' | 'next' | 'todo';

/** Coordinated color tones per status — applied to the alert, icon, title,
 *  badge, and button so each step reads as a single colored unit. */
const TONE: Record<
  Status,
  { alert: string; icon: string; title: string; description: string; badge: string; button: string }
> = {
  done: {
    alert: 'border-emerald-500/40 bg-emerald-500/5',
    badge: 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400',
    button: '',
    description: 'text-emerald-700/80 dark:text-emerald-400/80',
    icon: 'text-emerald-600! dark:text-emerald-400!',
    title: 'text-emerald-700 dark:text-emerald-400',
  },
  next: {
    alert: 'border-amber-500/40 bg-amber-500/5',
    badge: 'border-amber-500/30 text-amber-600 dark:text-amber-400',
    button:
      'bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400 dark:hover:bg-amber-500/25',
    description: 'text-amber-700/80 dark:text-amber-400/80',
    icon: 'text-amber-600! dark:text-amber-400!',
    title: 'text-amber-700 dark:text-amber-400',
  },
  todo: {
    alert: '',
    badge: 'border-border text-muted-foreground',
    button: '',
    description: '',
    icon: 'text-muted-foreground!',
    title: '',
  },
};

/** Scrolls a workspace section into view (sections set `scroll-mt` for offset). */
function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * The project setup guide. Surfaces the natural order of work — grid → control
 * points → transform → import — with live status, so a new user always knows
 * the next step. Collapses to a one-line "complete" summary once all steps pass.
 */
export function SetupChecklist({
  axesCount,
  controlPointsWithGrid,
  onNavigate,
  pointCount,
  transformSolved,
}: {
  axesCount: number;
  controlPointsWithGrid: number;
  transformSolved: boolean;
  pointCount: number;
  /** Navigate to a step's target (lets the workspace switch tabs as needed). */
  onNavigate?: (target: string) => void;
}) {
  const steps: Step[] = [
    {
      action: 'Add control points',
      description: 'Enter at least two city control points with their grid coordinates.',
      done: controlPointsWithGrid >= 2,
      icon: IconMapPin,
      key: 'control',
      label: 'Add control points',
      target: 'panel-control',
    },
    {
      action: 'Define grid',
      description: 'Lay out the lettered and numbered gridlines that frame the site.',
      done: axesCount > 0,
      icon: IconLayoutGrid,
      key: 'grid',
      label: 'Define the building grid',
      target: 'panel-grid',
    },
    {
      action: 'Solve transform',
      description: 'Compute the Helmert tie from building grid to projected coordinates.',
      done: transformSolved,
      icon: IconTransform,
      key: 'transform',
      label: 'Solve the transform',
      target: 'panel-transform',
    },
    {
      action: 'Import points',
      description: 'Bring in surveyed points from a CSV or LandXML machine export.',
      done: pointCount > 0,
      icon: IconFileImport,
      key: 'import',
      label: 'Import surveyed points',
      target: 'panel-points',
    },
  ];

  const firstPending = steps.find((s) => !s.done)?.key;

  return (
    <div className="flex flex-col gap-3">
      {steps.map((s) => {
        const status: Status = s.done ? 'done' : s.key === firstPending ? 'next' : 'todo';
        const Icon = s.icon;
        return (
          <Alert key={s.key} className={TONE[status].alert}>
            <Icon className={TONE[status].icon} />
            <AlertAction>
              <StatusBadge status={status} />
            </AlertAction>
            <AlertTitle className={TONE[status].title}>{s.label}</AlertTitle>
            <AlertDescription className={cn('block', TONE[status].description)}>
              {s.description}
              {!s.done && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    className={TONE[status].button}
                    onClick={() => (onNavigate ? onNavigate(s.target) : jumpTo(s.target))}
                  >
                    {s.action}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const labels: Record<Status, string> = { done: 'Done', next: 'Next', todo: 'To do' };
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE[status].badge,
      )}
    >
      {labels[status]}
    </span>
  );
}
