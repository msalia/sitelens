'use client';

import { IconDeviceDesktop, IconMoon, IconSun } from '@tabler/icons-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';

const noop = () => () => {};

const OPTIONS = [
  { icon: IconSun, label: 'Light', value: 'light' },
  { icon: IconMoon, label: 'Dark', value: 'dark' },
  { icon: IconDeviceDesktop, label: 'System', value: 'system' },
] as const;

/** Theme switcher: one click to pick Light, Dark, or System (defaults to System
 *  on the provider). Highlights the chosen setting once mounted (avoids an
 *  SSR/client mismatch on `theme`). */
export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  // `false` on the server and first client render, `true` thereafter — keeps the
  // active highlight off until hydration so SSR markup matches (no effect needed).
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

  return (
    <ButtonGroup>
      {OPTIONS.map(({ icon: Icon, label, value }) => {
        const active = mounted && theme === value;
        return (
          <Button
            key={value}
            type="button"
            size="icon"
            variant={active ? 'default' : 'outline'}
            aria-label={label}
            aria-pressed={active}
            onClick={() => setTheme(value)}
          >
            <Icon className="size-4" />
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
