'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';

// Wraps next-themes: toggles the `.dark` class on <html> (see globals.css's
// `@custom-variant dark`). `attribute="class"` + `disableTransitionOnChange`
// avoids a flash and a transition sweep when switching themes.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
