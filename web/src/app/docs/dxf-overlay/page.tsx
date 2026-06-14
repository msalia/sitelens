import { DocsPageContent } from '@/components/docs-page';
import { JsonLd } from '@/components/json-ld';
import { getDocBreadcrumb, getDocContent, getDocMetadata, getDocNav } from '@/lib/docs';

export const metadata = getDocMetadata('/docs/dxf-overlay');

export default function Page() {
  const { current, next, prev } = getDocNav('/docs/dxf-overlay');
  const content = getDocContent('dxf-overlay');
  const breadcrumb = getDocBreadcrumb('/docs/dxf-overlay');

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
