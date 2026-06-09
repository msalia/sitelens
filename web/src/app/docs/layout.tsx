import { Toaster } from 'sonner';

import { DocsNav } from '@/components/docs-nav';
import { getDocsNav } from '@/lib/docs';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const items = getDocsNav();

  return (
    <div className="flex min-h-screen">
      <DocsNav items={items} />
      <div className="flex flex-1 flex-col">{children}</div>
      <Toaster />
    </div>
  );
}
