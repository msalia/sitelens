import { DocsPageContent } from '@/components/docs-page';
import { getDocContent, getDocNav } from '@/lib/docs';

export default function Page() {
  const { current, next, prev } = getDocNav('/docs/getting-started');
  const content = getDocContent('getting-started');

  return (
    <DocsPageContent
      title={current!.title}
      description={current!.description}
      content={content}
      prev={prev}
      next={next}
    />
  );
}
