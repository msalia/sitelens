import { expect, test } from '@playwright/test';

import { chooseSelect, createProjectAndOpen, gotoTab, signUpAndLogin } from './helpers';

// The "Add a point" dialog: add a single survey point manually, in any
// coordinate space, and see it land in the table.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('add a projected point via the dialog', async ({ page }) => {
  await signUpAndLogin(page, 'addpt-proj');
  await createProjectAndOpen(page, 'Add Point Site');
  await gotoTab(page, 'Points');

  await page
    .locator('#panel-points')
    .getByRole('button', { name: /Add a point/ })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Add a point', { exact: true })).toBeVisible();

  // Projected is the default coordinate type → Easting / Northing fields.
  await dialog.getByLabel('Label').fill('MANUAL1');
  await dialog.getByLabel('Easting').fill('2000');
  await dialog.getByLabel('Northing').fill('1000');
  await dialog.getByRole('button', { name: 'Add point' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('MANUAL1', { exact: true })).toBeVisible();
});

test('add a geographic point via the dialog (coordinate-type switch)', async ({ page }) => {
  await signUpAndLogin(page, 'addpt-geo');
  await createProjectAndOpen(page, 'Add Geo Site');
  await gotoTab(page, 'Points');

  await page
    .locator('#panel-points')
    .getByRole('button', { name: /Add a point/ })
    .click();
  const dialog = page.getByRole('dialog');

  await dialog.getByLabel('Label').fill('GEO1');
  // Switch the coordinate type → labels become Longitude / Latitude.
  await chooseSelect(page, 'asp-space', 'Geographic (lat/long)');
  await dialog.getByLabel('Longitude').fill('-118.2');
  await dialog.getByLabel('Latitude').fill('34.0');
  await dialog.getByRole('button', { name: 'Add point' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('GEO1', { exact: true })).toBeVisible();
});
