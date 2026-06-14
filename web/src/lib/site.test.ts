import { describe, expect, it } from 'vitest';

import { absoluteUrl, SITE_URL } from '@/lib/site';

describe('absoluteUrl', () => {
  it('collapses the root path to the bare origin (no trailing slash)', () => {
    expect(absoluteUrl('/')).toBe(SITE_URL);
    expect(absoluteUrl()).toBe(SITE_URL);
  });

  it('joins a leading-slash path onto the origin', () => {
    expect(absoluteUrl('/docs')).toBe(`${SITE_URL}/docs`);
    expect(absoluteUrl('/docs/getting-started')).toBe(`${SITE_URL}/docs/getting-started`);
  });

  it('normalizes a path missing its leading slash', () => {
    expect(absoluteUrl('privacy')).toBe(`${SITE_URL}/privacy`);
  });

  it('strips a trailing slash from non-root paths to avoid duplicate canonicals', () => {
    expect(absoluteUrl('/docs/')).toBe(`${SITE_URL}/docs`);
  });

  it('passes through already-absolute URLs untouched', () => {
    expect(absoluteUrl('https://example.com/foo')).toBe('https://example.com/foo');
    expect(absoluteUrl('http://example.com')).toBe('http://example.com');
  });
});
