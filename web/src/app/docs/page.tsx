import { DocsPageContent } from '@/components/docs-page';
import { getDocContent, getDocNav } from '@/lib/docs';

export default function DocsPage() {
  const { current, next, prev } = getDocNav('/docs');
  const content = getDocContent('introduction');

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
