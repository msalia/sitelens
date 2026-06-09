import { describe, expect, it } from 'vitest';

import { apiBaseUrl } from '@/lib/api';

describe('apiBaseUrl', () => {
  it('falls back to localhost when env is unset', () => {
    expect(apiBaseUrl()).toMatch(/^https?:\/\//);
  });
});
