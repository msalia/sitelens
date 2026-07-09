import { expect, test } from '@playwright/test';

import { createProjectAndOpen, gotoTab, importCsv, signUpAndLogin, upgradeOrg } from './helpers';

// Surface Modeling (P1 + P2): build a TIN from survey points, constrain it with
// an auto boundary (rebuild → new version), and drive the display modes. Needs
// the full stack (skips if the API is down).
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('build a TIN from points → renders, then toggle ramp/wireframe', async ({ page }) => {
  const email = await signUpAndLogin(page, 'surf-build');
  upgradeOrg(email); // Surfaces is a Crew feature
  await createProjectAndOpen(page, 'Surface Build');

  // Four non-collinear design points (PNEZD): a square with varied elevation.
  await importCsv(
    page,
    ['P,N,E,Z,D', 'P1,0,0,10,GRD', 'P2,0,100,12,GRD', 'P3,100,100,15,GRD', 'P4,100,0,11,GRD'].join(
      '\n',
    ),
  );

  await gotoTab(page, 'Surfaces');

  // Build a TIN from all design points.
  await page.getByLabel('Name').fill('Existing grade');
  await page.getByRole('button', { name: 'Build surface' }).click();

  // It appears in the surfaces list, reporting its triangle count (a square → 2).
  await expect(page.getByText('Existing grade')).toBeVisible();
  await expect(page.getByText(/2 triangles/)).toBeVisible();

  // With a surface active, the Display menu offers the Surface toggle + shading.
  await page.getByRole('button', { name: 'Display' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Surface' })).toBeVisible();
  await expect(page.getByRole('menuitemradio', { name: 'Wireframe' })).toBeVisible();
  // Switch to wireframe shading.
  await page.getByRole('menuitemradio', { name: 'Wireframe' }).click();
  await page.keyboard.press('Escape');

  // Delete it → it leaves the list.
  await page.getByRole('button', { name: 'Delete Existing grade' }).click();
  await page.getByRole('button', { exact: true, name: 'Delete' }).click();
  await expect(page.getByText('Existing grade')).toHaveCount(0);
});

test('auto boundary → rebuild bumps the version, and slope shading is offered', async ({
  page,
}) => {
  const email = await signUpAndLogin(page, 'surf-constrain');
  upgradeOrg(email);
  await createProjectAndOpen(page, 'Surface Constrain');

  // A 3×3 grid of design points so a boundary has something to clip.
  await importCsv(
    page,
    [
      'P,N,E,Z,D',
      'P1,0,0,10,GRD',
      'P2,0,50,11,GRD',
      'P3,0,100,12,GRD',
      'P4,50,0,11,GRD',
      'P5,50,50,13,GRD',
      'P6,50,100,14,GRD',
      'P7,100,0,12,GRD',
      'P8,100,50,14,GRD',
      'P9,100,100,15,GRD',
    ].join('\n'),
  );

  await gotoTab(page, 'Surfaces');
  await page.getByLabel('Name').fill('Grade');
  await page.getByRole('button', { name: 'Build surface' }).click();
  await expect(page.getByText('Grade')).toBeVisible();
  await expect(page.getByText('v1')).toBeVisible();

  // Generate an auto boundary → a Boundary constraint badge appears in the list
  // (exact match avoids the "Auto boundary" button + the card description text).
  await page.getByRole('button', { name: 'Auto boundary' }).click();
  await expect(page.getByText('Boundary', { exact: true })).toBeVisible();

  // Rebuild the surface with the constraint → version increments to v2.
  await page.getByRole('button', { name: 'Rebuild Grade' }).click();
  await expect(page.getByText('v2')).toBeVisible();

  // Slope shading is available in the Display menu.
  await page.getByRole('button', { name: 'Display' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Slope' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Slope' }).click();
});

test('enable contours → the API returns iso-lines and the controls appear', async ({ page }) => {
  const email = await signUpAndLogin(page, 'surf-contour');
  upgradeOrg(email);
  await createProjectAndOpen(page, 'Surface Contours');

  await importCsv(
    page,
    ['P,N,E,Z,D', 'P1,0,0,10,GRD', 'P2,0,100,12,GRD', 'P3,100,100,15,GRD', 'P4,100,0,11,GRD'].join(
      '\n',
    ),
  );

  await gotoTab(page, 'Surfaces');
  await page.getByLabel('Name').fill('Grade');
  await page.getByRole('button', { name: 'Build surface' }).click();
  await expect(page.getByText('Grade')).toBeVisible();

  // Enabling contours fetches them from the API; assert the response carries a
  // non-empty SCTR blob, and that the interval/label controls appear.
  const contourResp = page.waitForResponse(
    (r) =>
      r.url().includes('/api/graphql') &&
      (r.request().postData()?.includes('SurfaceContours') ?? false) &&
      r.ok(),
  );
  await page.getByLabel('Show contours').click();
  await expect(page.getByLabel(/Interval/)).toBeVisible();
  await expect(page.getByLabel('Elevation labels on majors')).toBeVisible();

  const body = (await (await contourResp).json()) as {
    data: { surfaceContours: { contentBase64: string } };
  };
  expect(body.data.surfaceContours.contentBase64.length).toBeGreaterThan(0);
});

test('compute a surface-to-elevation volume → totals appear + heatmap loads', async ({ page }) => {
  const email = await signUpAndLogin(page, 'surf-volume');
  upgradeOrg(email);
  await createProjectAndOpen(page, 'Surface Volume');

  await importCsv(
    page,
    ['P,N,E,Z,D', 'P1,0,0,10,GRD', 'P2,0,100,12,GRD', 'P3,100,100,15,GRD', 'P4,100,0,11,GRD'].join(
      '\n',
    ),
  );

  await gotoTab(page, 'Surfaces');
  await page.getByLabel('Name').fill('Grade');
  await page.getByRole('button', { name: 'Build surface' }).click();
  await expect(page.getByText('Grade')).toBeVisible();

  // The Volumes card defaults to a surface-to-elevation comparison; the base
  // surface auto-selects the one just built. Fill the datum + compute.
  await page.getByLabel(/Reference elevation/).fill('0');
  const volResp = page.waitForResponse(
    (r) =>
      r.url().includes('/api/graphql') &&
      (r.request().postData()?.includes('ComputeVolume') ?? false) &&
      r.ok(),
  );
  await page.getByRole('button', { name: 'Compute volume' }).click();

  const body = (await (await volResp).json()) as {
    data: { computeVolume: { cutVolume: number } };
  };
  // A surface entirely above the datum is all cut.
  expect(body.data.computeVolume.cutVolume).toBeGreaterThan(0);

  // Results render (cut/fill/net/area), and the cut/fill heatmap toggle appears.
  await expect(page.getByText(/Cut:/)).toBeVisible();
  await page.getByRole('button', { name: 'Display' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Cut/fill heatmap' })).toBeVisible();
});

test('Solo plan gates the Surfaces tab behind the upgrade dialog', async ({ page }) => {
  await signUpAndLogin(page, 'surf-gate'); // no upgrade → Solo
  await createProjectAndOpen(page, 'Surface Gate');

  // Clicking the Crew-gated tab opens the upgrade dialog instead of the panel.
  await page.getByRole('button', { exact: true, name: 'Surfaces' }).click();
  await expect(page.getByRole('dialog')).toContainText('Crew');
});
