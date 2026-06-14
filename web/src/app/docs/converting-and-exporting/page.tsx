import { DocsPageContent } from '@/components/docs-page';
import { JsonLd } from '@/components/json-ld';
import { getDocBreadcrumb, getDocContent, getDocMetadata, getDocNav } from '@/lib/docs';

export const metadata = getDocMetadata('/docs/converting-and-exporting');

export default function Page() {
  const { current, next, prev } = getDocNav('/docs/converting-and-exporting');
  const content = getDocContent('converting-and-exporting');
  const breadcrumb = getDocBreadcrumb('/docs/converting-and-exporting');

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
