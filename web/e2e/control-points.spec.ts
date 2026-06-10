import { expect, test } from '@playwright/test';

import { addControlPoint, createProjectAndOpen, signUpAndLogin } from './helpers';

// Control points card: add via Field inputs, edit + delete via the row dropdown.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('add a control point', async ({ page }) => {
  await signUpAndLogin(page, 'cp-add');
  await createProjectAndOpen(page, 'CP Add');
  await addControlPoint(page, { e: 2000, gx: 0, gy: 0, label: 'MON1', n: 1000 });
  await expect(page.getByRole('cell', { exact: true, name: 'MON1' })).toBeVisible();
});

test('edit a control point from the row dropdown', async ({ page }) => {
  await signUpAndLogin(page, 'cp-edit');
  await createProjectAndOpen(page, 'CP Edit');
  await addControlPoint(page, { e: 2000, label: 'OLDCP', n: 1000 });

  await page.getByRole('button', { name: 'Control point actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit control point' })).toBeVisible();
  await page.locator('#ecp-label').fill('NEWCP');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { exact: true, name: 'NEWCP' })).toBeVisible();
});

test('delete a control point requires confirmation', async ({ page }) => {
  await signUpAndLogin(page, 'cp-delete');
  await createProjectAndOpen(page, 'CP Delete');
  await addControlPoint(page, { e: 2000, label: 'DELME', n: 1000 });

  await page.getByRole('button', { name: 'Control point actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/Delete DELME\?/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('cell', { exact: true, name: 'DELME' })).toBeHidden();
});
