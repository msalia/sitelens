import { expect, test } from '@playwright/test';

import { createProjectAndOpen, gotoTab, importCsv, signUpAndLogin, upgradeOrg } from './helpers';

// Terrain-rendering Phase 1a: the render blobs ride the binary `/asset` route
// (raw bytes + gzip/brotli + sha256 ETag/304) instead of base64-in-GraphQL. This
// verifies the surface mesh — the representative render blob — end to end through
// the Next.js cookie proxy: it loads over `/api/asset/...` (not inlined JSON) and
// revalidates with a conditional 304. Needs the full stack.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('surface mesh loads over /asset (200 + ETag) and revalidates (304)', async ({ page }) => {
  const email = await signUpAndLogin(page, 'asset-mesh');
  upgradeOrg(email); // Surfaces is a Crew feature
  await createProjectAndOpen(page, 'Asset Transport');

  // Four non-collinear design points → a 2-triangle TIN.
  await importCsv(
    page,
    ['P,N,E,Z,D', 'P1,0,0,10,GRD', 'P2,0,100,12,GRD', 'P3,100,100,15,GRD', 'P4,100,0,11,GRD'].join(
      '\n',
    ),
  );
  await gotoTab(page, 'Surfaces');

  // Arm the listener BEFORE building, so we catch the mesh fetch the scene issues
  // when the freshly-built surface renders.
  const meshResponse = page.waitForResponse((r) =>
    /\/api\/asset\/surface\/[^/]+\/mesh/.test(r.url()),
  );
  await page.getByLabel('Name').fill('Existing grade');
  await page.getByRole('button', { name: 'Build surface' }).click();
  await expect(page.getByText(/2 triangles/)).toBeVisible();

  // The mesh came over the binary route as octet-stream with an ETag — not base64.
  const resp = await meshResponse;
  expect(resp.status()).toBe(200);
  const headers = resp.headers();
  expect(headers['content-type']).toContain('octet-stream');
  expect(headers['etag']).toBeTruthy();

  // Conditional revalidation: re-requesting with the ETag returns 304 (proves the
  // proxy forwards If-None-Match and the API short-circuits). `page.request` shares
  // the browser's session cookie but not its HTTP cache, so we send the header.
  const meshUrl = new URL(resp.url()).pathname;
  const first = await page.request.get(meshUrl);
  expect(first.status()).toBe(200);
  const etag = first.headers()['etag'];
  expect(etag).toBeTruthy();
  const second = await page.request.get(meshUrl, { headers: { 'If-None-Match': etag } });
  expect(second.status()).toBe(304);
});

test('an unauthenticated /asset request is rejected', async ({ browser }) => {
  // A fresh context with no session cookie must not read a render blob.
  const ctx = await browser.newContext();
  const res = await ctx.request.get('/api/asset/surface/00000000-0000-0000-0000-000000000000/mesh');
  expect(res.status()).toBe(401);
  await ctx.close();
});
