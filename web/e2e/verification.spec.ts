import { expect, test } from '@playwright/test';

import { signUpAndLogin } from './helpers';

// Email verification: emailed link → /verify, invalid token rejected, and the
// login resend affordance for an unverified account.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('signup → verify via emailed link → login', async ({ page }) => {
  await signUpAndLogin(page, 'verify-happy');
  await expect(page).toHaveURL(/\/projects$/);
});

test('an invalid verification token is rejected', async ({ page }) => {
  await page.goto('/verify?token=not-a-real-token');
  await expect(page.getByText(/verification failed/i)).toBeVisible();
});

test('signup shows a check-your-email screen and login offers resend when unverified', async ({
  page,
}) => {
  const stamp = Date.now();
  const email = `e2e+unverif-${stamp}@sitelens.test`;
  await page.goto('/signup');
  await page.getByLabel('Organization name').fill(`E2E Unverif ${stamp}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  // Exact card text — avoids colliding with the (similar) toast message.
  await expect(
    page.getByText('Check your email to verify your account.', { exact: true }),
  ).toBeVisible();

  // Logging in before verifying is blocked and surfaces a resend option.
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { exact: true, name: 'Login' }).click();
  await expect(page.getByRole('button', { name: 'Resend verification email' })).toBeVisible();
});
