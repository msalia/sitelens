import { expect, test } from '@playwright/test';

import { createProjectAndOpen, gotoTab, signUpAndLogin } from './helpers';

// Category manager dialog: Custom/Default tabs, create, delete-with-confirm.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

async function openCategories(page: import('@playwright/test').Page) {
  await createProjectAndOpen(page, `Cat ${Date.now()}`);
  await gotoTab(page, 'Points');
  await page.getByRole('button', { name: /Categories/ }).click();
  return page.getByRole('dialog');
}

test('categories dialog has Custom and Default tabs', async ({ page }) => {
  await signUpAndLogin(page, 'cat-tabs');
  const dialog = await openCategories(page);
  await expect(dialog.getByRole('heading', { name: 'Categories' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Custom' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Default' })).toBeVisible();

  // The Default tab lists the org's seeded categories.
  await dialog.getByRole('tab', { name: 'Default' }).click();
  await expect(dialog.getByRole('cell').first()).toBeVisible();
});

test('create and delete a custom category', async ({ page }) => {
  await signUpAndLogin(page, 'cat-crud');
  const dialog = await openCategories(page);

  await dialog.locator('#cat-name').fill('Survey Mark');
  await dialog.getByRole('button', { name: 'Add category' }).click();
  await expect(dialog.getByText('Survey Mark')).toBeVisible();

  await dialog.getByRole('button', { name: 'Delete Survey Mark' }).click();
  const alert = page.getByRole('alertdialog');
  await expect(alert.getByText(/Delete .Survey Mark.\?/)).toBeVisible();
  await alert.getByRole('button', { name: 'Delete' }).click();
  await expect(dialog.getByText('Survey Mark')).toBeHidden();
});
