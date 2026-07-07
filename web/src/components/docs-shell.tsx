import { PublicHeader } from '@/components/public-header';

/** Public, server-rendered chrome for the documentation site. Unlike the
 *  authenticated `AppShell`, this renders its children directly into the SSR
 *  HTML and requires no login, so the docs are crawlable and indexable. */
export function DocsShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-svh flex-col">
      <PublicHeader label="Docs" />
      <div className="flex-1">{children}</div>
    </div>
  );
}
