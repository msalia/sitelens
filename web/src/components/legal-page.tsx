import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { PublicHeader } from '@/components/public-header';

/** Public (no-auth) chrome for legal documents — Terms, Privacy — rendered from
 *  markdown with the same prose styling as the docs site. Shares the docs top
 *  bar (via PublicHeader) so the public surfaces stay visually consistent. */
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
      <PublicHeader label="Legal" />

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
