import { expect, test } from '@playwright/test';

import { addGridAxis, createProjectAndOpen, gotoTab, signUpAndLogin } from './helpers';

// Building grid card: a read-only table (Family / Label / Position) with add,
// edit, and delete via the row dropdown, plus CSV import (append or replace).
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('add a grid axis', async ({ page }) => {
  await signUpAndLogin(page, 'grid-add');
  await createProjectAndOpen(page, 'Grid Add');
  await addGridAxis(page, { family: 'Lettered', label: 'A', position: 0 });
  // addGridAxis already asserts the row is visible; sanity-check the family cell.
  await expect(page.locator('#panel-grid').getByRole('cell', { name: 'Lettered' })).toBeVisible();
});

test('edit a grid axis from the row dropdown', async ({ page }) => {
  await signUpAndLogin(page, 'grid-edit');
  await createProjectAndOpen(page, 'Grid Edit');
  await addGridAxis(page, { family: 'Lettered', label: 'A', position: 0 });

  const grid = page.locator('#panel-grid');
  await grid.getByRole('button', { name: 'Axis actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit axis' })).toBeVisible();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#gad-label').fill('B');
  await dialog.locator('#gad-position').fill('12.5');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();

  await expect(grid.getByRole('cell', { exact: true, name: 'B' })).toBeVisible();
  await expect(grid.getByRole('cell', { exact: true, name: 'A' })).toBeHidden();
});

test('delete a grid axis requires confirmation', async ({ page }) => {
  await signUpAndLogin(page, 'grid-del');
  await createProjectAndOpen(page, 'Grid Del');
  await addGridAxis(page, { family: 'Numbered', label: '1', position: 5 });

  const grid = page.locator('#panel-grid');
  await grid.getByRole('button', { name: 'Axis actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/Delete axis 1\?/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(grid.getByRole('cell', { exact: true, name: '1' })).toBeHidden();
});

test('import a grid from pasted CSV appends to existing axes', async ({ page }) => {
  await signUpAndLogin(page, 'grid-import');
  await createProjectAndOpen(page, 'Grid Import');
  // Seed one axis so we can verify append keeps it.
  await addGridAxis(page, { family: 'Lettered', label: 'A', position: 0 });

  const grid = page.locator('#panel-grid');
  await grid.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(/paste here/).fill('LETTERED,B,6\nNUMBERED,1,0');
  // Preview is debounced; the assertion auto-retries until it settles.
  await expect(dialog.getByText(/2 valid axes/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import grid' }).click();
  await expect(dialog).toBeHidden();

  await expect(grid.getByRole('cell', { exact: true, name: 'A' })).toBeVisible();
  await expect(grid.getByRole('cell', { exact: true, name: 'B' })).toBeVisible();
  await expect(grid.getByRole('cell', { exact: true, name: '1' })).toBeVisible();
});

test('import a grid with replace clears existing axes', async ({ page }) => {
  await signUpAndLogin(page, 'grid-replace');
  await createProjectAndOpen(page, 'Grid Replace');
  await addGridAxis(page, { family: 'Lettered', label: 'OLD', position: 0 });

  const grid = page.locator('#panel-grid');
  await grid.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(/paste here/).fill('LETTERED,NEW,3');
  await dialog.getByRole('switch', { name: 'Replace existing grid' }).click();
  await dialog.getByRole('button', { name: 'Import grid' }).click();
  await expect(dialog).toBeHidden();

  await expect(grid.getByRole('cell', { exact: true, name: 'NEW' })).toBeVisible();
  await expect(grid.getByRole('cell', { exact: true, name: 'OLD' })).toBeHidden();
});

test('shows an error count for invalid CSV lines', async ({ page }) => {
  await signUpAndLogin(page, 'grid-bad');
  await createProjectAndOpen(page, 'Grid Bad');
  await gotoTab(page, 'Grid');

  const grid = page.locator('#panel-grid');
  await grid.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder(/paste here/).fill('LETTERED,A,0\nBOGUS,B,1');
  await expect(dialog.getByText(/1 valid axis/)).toBeVisible();
  await expect(dialog.getByText(/1 invalid/)).toBeVisible();
});
