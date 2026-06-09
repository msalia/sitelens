import { DocsPageContent } from '@/components/docs-page';
import { getDocContent, getDocNav } from '@/lib/docs';

export default function Page() {
  const { current, next, prev } = getDocNav('/docs/grid-and-control-points');
  const content = getDocContent('grid-and-control-points');

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
