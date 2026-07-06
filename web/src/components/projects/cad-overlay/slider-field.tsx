'use client';

import { type ReactNode } from 'react';

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';

/** One control row: icon + label on the left, a slider + a synced number input
 * (with a unit suffix) on the right. For offsets, pass a `base` + `window` to
 * make the slider a fine-nudge jog around the current value over a huge range. */
export function SliderField({
  base,
  icon,
  id,
  label,
  max,
  min,
  onChange,
  onCommit,
  step,
  suffix,
  value,
  window: win,
}: {
  id: string;
  label: string;
  icon: ReactNode;
  value: number;
  onChange: (v: number) => void;
  base?: number;
  window?: number;
  min?: number;
  max?: number;
  step: number;
  suffix?: string;
  onCommit?: (v: number) => void;
}) {
  const lo = win !== undefined ? (base ?? value) - win : (min ?? 0);
  const hi = win !== undefined ? (base ?? value) + win : (max ?? 100);
  return (
    <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <label htmlFor={id} className="w-16 shrink-0 text-sm font-medium">
        {label}
      </label>
      <Slider
        className="min-w-0 flex-1"
        value={[value]}
        min={lo}
        max={hi}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        onValueCommitted={(v) => onCommit?.(Array.isArray(v) ? v[0] : v)}
      />
      <InputGroup className="w-28 shrink-0">
        <InputGroupInput
          id={id}
          type="number"
          value={value}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!Number.isNaN(n)) {
              onChange(n);
              onCommit?.(n);
            }
          }}
        />
        {suffix ? (
          <InputGroupAddon align="inline-end">
            <InputGroupText>{suffix}</InputGroupText>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}
