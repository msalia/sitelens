import { expect, test } from '@playwright/test';

import {
  addControlPoint,
  addGridAxis,
  createProjectAndOpen,
  gotoTab,
  signUpAndLogin,
  upgradeOrg,
} from './helpers';

// The command-center workspace: tabs, setup alerts, grid, transform, converter.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('workspace shows all tabs, setup alerts, and stat pills', async ({ page }) => {
  const email = await signUpAndLogin(page, 'ws-tabs');
  // Overlays is a Crew feature; the tab always renders (free tier gets an upsell
  // on click). Upgrade here so clicking through to its panel would be allowed.
  upgradeOrg(email);
  await createProjectAndOpen(page, 'Tabs Site');

  // Top-level tabs sit in one row; Grid/Points/Field live under "Survey".
  for (const tab of ['Setup', 'Survey', 'Overlays', 'Surfaces', 'Analysis']) {
    await expect(page.getByRole('button', { exact: true, name: tab })).toBeVisible();
  }
  await page.getByRole('button', { exact: true, name: 'Survey' }).click();
  for (const item of ['Grid', 'Points', 'Field']) {
    await expect(page.getByRole('menuitem', { exact: true, name: item })).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // Setup tab: the first (control) step is "Next", others "To do".
  await expect(page.getByRole('alert').filter({ hasText: 'Add control points' })).toBeVisible();
  await expect(page.getByText('Next')).toBeVisible();

  // Stat pill over the hero: no transform yet.
  await expect(page.getByText('Not tied')).toBeVisible();
});

test('define the building grid', async ({ page }) => {
  await signUpAndLogin(page, 'ws-grid');
  await createProjectAndOpen(page, 'Grid Site');
  // Axes are added through the add/edit dialog and persist immediately (the
  // table is read-only with row actions, like control points).
  await addGridAxis(page, { family: 'Lettered', label: 'A', position: 0 });
  await expect(
    page.locator('#panel-grid').getByRole('cell', { exact: true, name: 'A' }),
  ).toBeVisible();
});

test('solve the Helmert transform shows residuals', async ({ page }) => {
  await signUpAndLogin(page, 'ws-transform');
  await createProjectAndOpen(page, 'Transform Site');

  await addControlPoint(page, { e: 2000, gx: 0, gy: 0, label: 'CP1', n: 1000 });
  await addControlPoint(page, { e: 2100, gx: 100, gy: 0, label: 'CP2', n: 1000 });
  await addControlPoint(page, { e: 2000, gx: 0, gy: 100, label: 'CP3', n: 1100 });

  await gotoTab(page, 'Grid');
  await page.locator('#panel-transform').getByRole('button', { name: 'Solve transform' }).click();
  await expect(page.getByText(/Residuals/)).toBeVisible();
});

test('converter returns every representation', async ({ page }) => {
  await signUpAndLogin(page, 'ws-convert');
  await createProjectAndOpen(page, 'Convert Site');
  await gotoTab(page, 'Points');

  await page.getByLabel('Easting', { exact: true }).fill('545000');
  await page.getByLabel('Northing', { exact: true }).fill('4184000');
  await page.getByRole('button', { exact: true, name: 'Convert' }).click();
  // Scope to the result table cells — "Building grid" also appears in the 3D
  // view's setup-overlay copy, so a bare text match is ambiguous.
  await expect(page.getByRole('cell', { name: 'Latitude' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Building grid' })).toBeVisible();
});
