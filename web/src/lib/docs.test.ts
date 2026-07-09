import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { docsOrder, getDocContent } from '@/lib/docs';

describe('docs', () => {
  it('every nav entry has a content file and a route page', () => {
    for (const doc of docsOrder) {
      // Content markdown exists and is non-trivial.
      const content = getDocContent(doc.slug);
      expect(content.length, `${doc.slug}.md content`).toBeGreaterThan(50);
      expect(content, `${doc.slug}.md heading`).toContain('# ');

      // The route page.tsx resolves (root doc lives at /docs, others at /docs/<slug>).
      const dir =
        doc.href === '/docs' ? 'src/app/docs' : `src/app/docs/${doc.href.split('/').pop()}`;
      const page = path.join(process.cwd(), dir, 'page.tsx');
      expect(fs.existsSync(page), `${page}`).toBe(true);
    }
  });

  it('slugs and hrefs are unique', () => {
    expect(new Set(docsOrder.map((d) => d.slug)).size).toBe(docsOrder.length);
    expect(new Set(docsOrder.map((d) => d.href)).size).toBe(docsOrder.length);
  });

  it('includes the surfaces page in the Visualization group', () => {
    const surfaces = docsOrder.find((d) => d.slug === 'surfaces');
    expect(surfaces?.group).toBe('Visualization');
    expect(getDocContent('surfaces')).toContain('Cut / fill volumes');
  });
});
