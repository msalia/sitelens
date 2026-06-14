import { DocsPageContent } from '@/components/docs-page';
import { JsonLd } from '@/components/json-ld';
import { getDocBreadcrumb, getDocContent, getDocMetadata, getDocNav } from '@/lib/docs';

export const metadata = getDocMetadata('/docs/grid-and-control-points');

export default function Page() {
  const { current, next, prev } = getDocNav('/docs/grid-and-control-points');
  const content = getDocContent('grid-and-control-points');
  const breadcrumb = getDocBreadcrumb('/docs/grid-and-control-points');

  return (
    <>
      {breadcrumb ? <JsonLd data={breadcrumb} /> : null}
      <DocsPageContent
        title={current!.title}
        description={current!.description}
        content={content}
        prev={prev}
        next={next}
      />
    </>
  );
}
