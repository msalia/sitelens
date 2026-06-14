import { DocsPageContent } from '@/components/docs-page';
import { JsonLd } from '@/components/json-ld';
import { getDocBreadcrumb, getDocContent, getDocMetadata, getDocNav } from '@/lib/docs';

export const metadata = getDocMetadata('/docs/visualization');

export default function Page() {
  const { current, next, prev } = getDocNav('/docs/visualization');
  const content = getDocContent('visualization');
  const breadcrumb = getDocBreadcrumb('/docs/visualization');

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
