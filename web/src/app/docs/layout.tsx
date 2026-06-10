import { AppShell } from '@/components/app-shell';
import { DocsNav } from '@/components/docs-nav';
import { getDocsNav } from '@/lib/docs';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const items = getDocsNav();

  return (
    <AppShell>
      {/* Center the sidebar + content pair and cap the content width so the nav
          stays adjacent to the reading column instead of drifting left. */}
      <div className="mx-auto flex min-h-full w-full max-w-5xl justify-center">
        <DocsNav items={items} />
        <div className="flex w-full max-w-3xl min-w-0 flex-col">{children}</div>
      </div>
    </AppShell>
  );
}
