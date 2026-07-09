import { DocsPageContent } from '@/components/docs-page';
import { JsonLd } from '@/components/json-ld';
import { getDocBreadcrumb, getDocContent, getDocMetadata, getDocNav } from '@/lib/docs';

export const metadata = getDocMetadata('/docs/surfaces');

export default function Page() {
  const { current, next, prev } = getDocNav('/docs/surfaces');
  const content = getDocContent('surfaces');
  const breadcrumb = getDocBreadcrumb('/docs/surfaces');

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
