'use client';

import { IconCircleCheckFilled, IconCircleDashed } from '@tabler/icons-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Step {
  action: string;
  done: boolean;
  /** One-line guidance shown until the step is done. */
  hint: string;
  /** Stable key. */
  key: string;
  label: string;
  /** Element id to scroll to when the user acts on the step. */
  target: string;
}

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
  pointCount,
  transformSolved,
}: {
  axesCount: number;
  controlPointsWithGrid: number;
  transformSolved: boolean;
  pointCount: number;
}) {
  const steps: Step[] = [
    {
      action: 'Define grid',
      done: axesCount > 0,
      hint: 'Add the building grid axes (letters and numbers).',
      key: 'grid',
      label: 'Define the building grid',
      target: 'panel-grid',
    },
    {
      action: 'Add control points',
      done: controlPointsWithGrid >= 2,
      hint: 'Add at least two control points with grid coordinates.',
      key: 'control',
      label: 'Add control points',
      target: 'panel-control',
    },
    {
      action: 'Solve transform',
      done: transformSolved,
      hint: 'Solve the Helmert tie between grid and projected space.',
      key: 'transform',
      label: 'Solve the transform',
      target: 'panel-transform',
    },
    {
      action: 'Import points',
      done: pointCount > 0,
      hint: 'Import surveyed points from a CSV or LandXML file.',
      key: 'import',
      label: 'Import surveyed points',
      target: 'panel-points',
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Project setup</CardTitle>
        <span className="text-muted-foreground text-sm">
          {allDone ? 'All set' : `${doneCount} of ${steps.length} complete`}
        </span>
      </CardHeader>
      <CardContent>
        {allDone ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <IconCircleCheckFilled className="size-5 text-emerald-500" />
            Setup complete — your grid is tied, the transform is solved, and points are loaded.
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {steps.map((s) => (
              <li
                key={s.key}
                className="flex items-center gap-3 rounded-lg border px-3 py-2"
                data-done={s.done}
              >
                {s.done ? (
                  <IconCircleCheckFilled className="size-5 shrink-0 text-emerald-500" />
                ) : (
                  <IconCircleDashed className="text-muted-foreground size-5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm font-medium ${s.done ? 'text-muted-foreground line-through' : ''}`}
                  >
                    {s.label}
                  </p>
                  {!s.done && <p className="text-muted-foreground text-xs">{s.hint}</p>}
                </div>
                {!s.done && (
                  <Button size="sm" variant="outline" onClick={() => jumpTo(s.target)}>
                    {s.action}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
