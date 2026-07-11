import { afterEach, describe, expect, it, vi } from 'vitest';

import { assetUrls, fetchAssetBuffer, fetchAssetText } from './asset';

describe('assetUrls', () => {
  it('builds same-origin proxy paths per asset kind', () => {
    expect(assetUrls.surfaceMesh('s1')).toBe('/api/asset/surface/s1/mesh');
    expect(assetUrls.volumeHeatmap('v1')).toBe('/api/asset/volume/v1/heatmap');
    expect(assetUrls.projectTerrain('p1')).toBe('/api/asset/project/p1/terrain');
    expect(assetUrls.projectDetailedTerrain('p1')).toBe('/api/asset/project/p1/terrain-detailed');
    expect(assetUrls.projectBuildings('p1')).toBe('/api/asset/project/p1/buildings');
  });
});

describe('fetchAssetBuffer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the ArrayBuffer on 200', async () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ arrayBuffer: async () => buf, ok: true, status: 200 }),
    );
    expect(await fetchAssetBuffer('/api/asset/surface/s/mesh')).toBe(buf);
  });

  it('returns null on 404 (asset absent)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchAssetBuffer('/api/asset/project/p/terrain')).toBeNull();
  });

  it('throws on other errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchAssetBuffer('/api/asset/surface/s/mesh')).rejects.toThrow('500');
  });

  it('sends same-origin credentials so the session cookie rides along', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0), ok: true, status: 200 });
    vi.stubGlobal('fetch', spy);
    await fetchAssetBuffer('/api/asset/surface/s/mesh');
    expect(spy).toHaveBeenCalledWith('/api/asset/surface/s/mesh', {
      credentials: 'same-origin',
    });
  });
});

describe('fetchAssetText', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns text on 200 and null on 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '[]' }),
    );
    expect(await fetchAssetText('/api/asset/project/p/buildings')).toBe('[]');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await fetchAssetText('/api/asset/project/p/buildings')).toBeNull();
  });
});
