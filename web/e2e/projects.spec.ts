import { expect, test } from '@playwright/test';

import { chooseSelect, signUpAndLogin } from './helpers';

// Project lifecycle on the new 3-column create/edit form + delete confirm.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('create a project with a chosen display unit', async ({ page }) => {
  await signUpAndLogin(page, 'proj-create');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Tower A');
  await page.getByLabel('Description').fill('A test high-rise.');
  await chooseSelect(page, 'cp-unit', 'Meter');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('link', { name: 'Tower A' })).toBeVisible();
});

test('edit a project name from the workspace', async ({ page }) => {
  await signUpAndLogin(page, 'proj-edit');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Old Name');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('link', { name: 'Old Name' }).click();

  await page.getByRole('button', { name: 'Edit project' }).click();
  await page.getByLabel('Name').fill('New Name');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New Name' })).toBeVisible();
});

test('delete a project requires confirmation', async ({ page }) => {
  await signUpAndLogin(page, 'proj-delete');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('Doomed Site');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('link', { name: 'Doomed Site' })).toBeVisible();

  await page.getByRole('button', { name: 'Delete project' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/Delete Doomed Site\?/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();

  await expect(page.getByRole('link', { name: 'Doomed Site' })).toBeHidden();
});
