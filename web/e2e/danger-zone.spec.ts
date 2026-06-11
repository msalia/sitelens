import { expect, test } from '@playwright/test';

import { signUpAndLogin } from './helpers';

// The admin "Danger zone": deleting the organization closes the account for
// everyone, gated behind a type-the-org-name confirmation.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('deleting the organization requires typing its name and signs you out', async ({ page }) => {
  await signUpAndLogin(page, 'org-del');
  await page.goto('/settings');

  // Open the destructive confirmation from the Danger zone.
  await page.getByRole('button', { name: 'Delete organization' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/delete this organization/i)).toBeVisible();

  // The action stays disabled until the exact org name is typed (placeholder
  // carries the org name).
  const confirm = dialog.getByRole('button', { name: 'Delete organization' });
  await expect(confirm).toBeDisabled();
  const orgName = await dialog.locator('#ttc-input').getAttribute('placeholder');
  expect(orgName).toBeTruthy();
  await dialog.locator('#ttc-input').fill(orgName!);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // The account is gone — we're returned to login and can no longer get in.
  await expect(page).toHaveURL(/\/login$/);
});
