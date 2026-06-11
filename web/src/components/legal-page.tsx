import { IconCompass } from '@tabler/icons-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { LegalBackLink } from '@/components/legal-back-link';

/** Public (no-auth) chrome for legal documents — Terms, Privacy — rendered from
 *  markdown with the same prose styling as the docs site. */
export function LegalPage({
  content,
  lastUpdated,
  title,
}: {
  title: string;
  lastUpdated: string;
  content: string;
}) {
  return (
    <div className="bg-background min-h-svh">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
            <IconCompass className="size-4" />
          </div>
          <span className="tracking-tight">SiteLens</span>
        </Link>
        <LegalBackLink className="text-muted-foreground hover:text-foreground text-sm" />
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-2 text-sm">Last updated: {lastUpdated}</p>
        <article className="prose prose-neutral dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-h2:mb-4 prose-h2:mt-10 prose-h2:text-xl prose-h3:mb-3 prose-h3:mt-8 prose-h3:text-lg prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-li:leading-relaxed mt-8 max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
