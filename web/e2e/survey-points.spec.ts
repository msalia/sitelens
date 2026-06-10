import { expect, test } from '@playwright/test';

import { createProjectAndOpen, gotoTab, importCsv, signUpAndLogin } from './helpers';

// Survey points: manage card actions, import, row dropdown, bulk ops, search.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

const CSV = ['P,N,E,Z,D', 'MON1,100,200,5,a', 'MON2,101,201,6,b', 'MON3,102,202,7,c'].join('\n');

test('manage-points card exposes import / categories / export', async ({ page }) => {
  await signUpAndLogin(page, 'sp-manage');
  await createProjectAndOpen(page, 'SP Manage');
  await gotoTab(page, 'Points');
  // Scope to the points panel — the 3D view also has a "Categories" control.
  const panel = page.locator('#panel-points');
  await expect(panel.getByRole('button', { name: /Import points/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Categories/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: /Export points/ })).toBeVisible();
});

test('import points and see them listed', async ({ page }) => {
  await signUpAndLogin(page, 'sp-import');
  await createProjectAndOpen(page, 'SP Import');
  await importCsv(page, CSV);
  for (const label of ['MON1', 'MON2', 'MON3']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
});

test('server-side search filters the table', async ({ page }) => {
  await signUpAndLogin(page, 'sp-search');
  await createProjectAndOpen(page, 'SP Search');
  await importCsv(page, CSV);
  await page.getByPlaceholder(/Search label/).fill('MON2');
  await expect(page.getByText('MON2', { exact: true })).toBeVisible();
  await expect(page.getByText('MON1', { exact: true })).toBeHidden();
});

test('delete a point from the row dropdown with confirmation', async ({ page }) => {
  await signUpAndLogin(page, 'sp-del');
  await createProjectAndOpen(page, 'SP Del');
  await importCsv(page, CSV);

  await page.getByRole('button', { name: 'Point actions' }).first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/Delete MON1\?/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('MON1', { exact: true })).toBeHidden();
});

test('bulk select and delete with confirmation', async ({ page }) => {
  await signUpAndLogin(page, 'sp-bulk');
  await createProjectAndOpen(page, 'SP Bulk');
  await importCsv(page, CSV);

  await page.getByRole('checkbox', { name: 'Select all on page' }).check();
  await expect(page.getByText('3 selected')).toBeVisible();
  await page.getByRole('button', { exact: true, name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/Delete 3 point\(s\)\?/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/No points\./)).toBeVisible();
});
