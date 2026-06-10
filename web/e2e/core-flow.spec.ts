import { expect, test } from '@playwright/test';

import {
  addControlPoint,
  createProjectAndOpen,
  gotoTab,
  importCsv,
  signUpAndLogin,
} from './helpers';

// The full surveyor workflow end-to-end against the real stack (web + api + db):
// project → control points → solve → import → convert, across the workspace tabs.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('core surveyor workflow: control points → solve → import → convert', async ({ page }) => {
  await signUpAndLogin(page, 'core');
  await createProjectAndOpen(page, 'E2E Survey');

  // Tie the building grid to projected space with three control points.
  await addControlPoint(page, { e: 2000, gx: 0, gy: 0, label: 'CP1', n: 1000 });
  await addControlPoint(page, { e: 2100, gx: 100, gy: 0, label: 'CP2', n: 1000 });
  await addControlPoint(page, { e: 2000, gx: 0, gy: 100, label: 'CP3', n: 1100 });

  // Solve the Helmert transform (lives in the Grid tab); residuals appear.
  await gotoTab(page, 'Grid');
  await page.locator('#panel-transform').getByRole('button', { name: 'Solve transform' }).click();
  await expect(page.getByText(/Residuals/)).toBeVisible();

  // Import surveyed points from pasted PNEZD CSV.
  await importCsv(page, 'P,N,E,Z,D\nPT1,100,200,5,MON\nPT2,101,201,,IP\n');
  await expect(page.getByText('PT1', { exact: true })).toBeVisible();

  // Standalone converter (Converter tab) returns every representation.
  await gotoTab(page, 'Points');
  await page.getByLabel('Easting', { exact: true }).fill('545000');
  await page.getByLabel('Northing', { exact: true }).fill('4184000');
  await page.getByRole('button', { exact: true, name: 'Convert' }).click();
  await expect(page.getByText('Latitude')).toBeVisible();
});
