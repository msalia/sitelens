'use client';

import { Toaster } from 'sonner';

import { AppShell } from '@/components/app-shell';

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      {children}
      <Toaster />
    </AppShell>
  );
}
