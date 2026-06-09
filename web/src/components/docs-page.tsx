'use client';

import { IconArrowLeft, IconArrowRight, IconCopy } from '@tabler/icons-react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-');
}

function Heading2({ children }: { children?: React.ReactNode }) {
  const text = typeof children === 'string' ? children : String(children);
  return <h2 id={slugify(text)}>{children}</h2>;
}

function Heading3({ children }: { children?: React.ReactNode }) {
  const text = typeof children === 'string' ? children : String(children);
  return <h3 id={slugify(text)}>{children}</h3>;
}

interface DocLink {
  href: string;
  title: string;
}

interface DocsPageProps {
  content: string;
  description: string;
  next: DocLink | null;
  prev: DocLink | null;
  title: string;
}

export function DocsPageContent({ content, description, next, prev, title }: DocsPageProps) {
  const bodyContent = content.replace(/^#[^\n]+\n+/, '');

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl">
          <div className="mb-10 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
              <p className="text-muted-foreground mt-2 text-base">{description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(bodyContent);
                  toast.success('Page copied to clipboard');
                }}
              >
                <IconCopy className="mr-1 h-3.5 w-3.5" />
                Copy
              </Button>
              {prev ? (
                <Link
                  href={prev.href}
                  aria-label={`Previous: ${prev.title}`}
                  className={cn(buttonVariants({ size: 'icon-sm', variant: 'outline' }))}
                >
                  <IconArrowLeft className="h-4 w-4" />
                </Link>
              ) : (
                <span
                  className={cn(
                    buttonVariants({ size: 'icon-sm', variant: 'outline' }),
                    'pointer-events-none opacity-50',
                  )}
                >
                  <IconArrowLeft className="h-4 w-4" />
                </span>
              )}
              {next ? (
                <Link
                  href={next.href}
                  aria-label={`Next: ${next.title}`}
                  className={cn(buttonVariants({ size: 'icon-sm', variant: 'outline' }))}
                >
                  <IconArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <span
                  className={cn(
                    buttonVariants({ size: 'icon-sm', variant: 'outline' }),
                    'pointer-events-none opacity-50',
                  )}
                >
                  <IconArrowRight className="h-4 w-4" />
                </span>
              )}
            </div>
          </div>

          <article className="prose prose-neutral dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-h2:mb-4 prose-h2:mt-10 prose-h2:text-xl prose-h3:mb-3 prose-h3:mt-8 prose-h3:text-lg prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-li:leading-relaxed prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-sm prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-table:text-sm prose-th:text-left prose-pre:bg-muted prose-pre:text-foreground max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ h2: Heading2, h3: Heading3 }}>
              {bodyContent}
            </ReactMarkdown>
          </article>

          <nav className="mt-12 flex items-center justify-between border-t pt-6 pb-8">
            {prev ? (
              <Link
                href={prev.href}
                className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-2 rounded-md border px-4 py-2 text-sm"
              >
                <IconArrowLeft className="h-4 w-4" />
                {prev.title}
              </Link>
            ) : (
              <div />
            )}
            {next ? (
              <Link
                href={next.href}
                className="hover:bg-muted flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium"
              >
                {next.title}
                <IconArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <div />
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
