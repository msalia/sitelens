import { expect, test } from '@playwright/test';

import { signUpAndLogin } from './helpers';

// The theme switcher is a Button Group (Light / Dark / System) in the top bar.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('theme switcher toggles light/dark and back to system', async ({ page }) => {
  await signUpAndLogin(page, 'theme');
  const html = page.locator('html');

  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(html).toHaveClass(/dark/);

  await page.getByRole('button', { name: 'Light' }).click();
  await expect(html).not.toHaveClass(/dark/);

  // System falls back to the OS preference (Playwright defaults to light).
  await page.getByRole('button', { name: 'System' }).click();
  await expect(html).not.toHaveClass(/dark/);
});
