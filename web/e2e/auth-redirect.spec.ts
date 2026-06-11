import { expect, test } from '@playwright/test';

import { signUpAndLogin } from './helpers';

// Signed-in users should never see an auth page — each one redirects to the app
// (server-side, before the form renders).
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

const AUTH_PAGES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password?token=irrelevant',
  '/accept-invite?token=irrelevant',
  '/verify?token=irrelevant',
];

test('logged-in users are redirected from auth pages to projects', async ({ page }) => {
  await signUpAndLogin(page, 'redirect');

  for (const path of AUTH_PAGES) {
    await page.goto(path);
    await expect(page, `${path} should redirect to /projects`).toHaveURL(/\/projects$/);
  }
});

test('logged-out users can still reach the login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { exact: true, name: 'Login' })).toBeVisible();
});
