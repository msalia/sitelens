import { expect, test } from '@playwright/test';

import { createProjectAndOpen, gotoTab, importCsv, signUpAndLogin, upgradeOrg } from './helpers';

// Surface Modeling (P1): build a TIN from survey points via the Surfaces panel,
// render it in the 3D scene with elevation-ramp / wireframe display modes, and
// the Solo-plan gate. Needs the full stack (skips if the API is down).
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

test('Solo plan gates the Surfaces tab behind the upgrade dialog', async ({ page }) => {
  await signUpAndLogin(page, 'surf-gate'); // no upgrade → Solo
  await createProjectAndOpen(page, 'Surface Gate');

  // Clicking the Crew-gated tab opens the upgrade dialog instead of the panel.
  await page.getByRole('button', { exact: true, name: 'Surfaces' }).click();
  await expect(page.getByRole('dialog')).toContainText('Crew');
});
