import { expect, test } from '@playwright/test';

import { addControlPoint, createProjectAndOpen, gotoTab, signUpAndLogin } from './helpers';

// The command-center workspace: tabs, setup alerts, grid, transform, converter.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('workspace shows all tabs, setup alerts, and stat pills', async ({ page }) => {
  await signUpAndLogin(page, 'ws-tabs');
  await createProjectAndOpen(page, 'Tabs Site');

  for (const tab of ['Setup', 'Grid', 'Points', 'Overlays']) {
    await expect(page.getByRole('button', { exact: true, name: tab })).toBeVisible();
  }

  // Setup tab: the first (control) step is "Next", others "To do".
  await expect(page.getByRole('alert').filter({ hasText: 'Add control points' })).toBeVisible();
  await expect(page.getByText('Next')).toBeVisible();

  // Stat pill over the hero: no transform yet.
  await expect(page.getByText('Not tied')).toBeVisible();
});

test('define and save the building grid', async ({ page }) => {
  await signUpAndLogin(page, 'ws-grid');
  await createProjectAndOpen(page, 'Grid Site');
  await gotoTab(page, 'Grid');

  await page.getByRole('button', { name: 'Add axis' }).click();
  await page.locator('#panel-grid').getByRole('textbox').first().fill('A');
  await page.locator('#panel-grid').getByRole('spinbutton').first().fill('0');
  await page.getByRole('button', { name: 'Save grid' }).click();
  await expect(page.getByText('Grid saved')).toBeVisible();
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
