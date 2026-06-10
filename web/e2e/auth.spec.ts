import { expect, test } from '@playwright/test';

// Auth surfaces: login (login-02 split), signup (login-03 card), and the
// docs-behind-auth gate. Layout checks are static; the verify flow needs the API.

test('login page renders the login-02 layout', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Login to your account' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'Login' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
});

test('forgot-password shows a coming-soon notice', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Forgot your password?' }).click();
  await expect(page.getByText(/coming soon/i)).toBeVisible();
});

test('social login routes to the SSO placeholder', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: /Continue with Google/ }).click();
  await expect(page).toHaveURL(/\/auth\/google$/);
  await expect(page.getByText(/coming soon/i)).toBeVisible();
});

test('signup page renders the login-03 layout', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByText('Create your organization')).toBeVisible();
  await expect(page.getByLabel('Organization name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Sign up with Google/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
});

test('docs are behind the auth wall', async ({ page }) => {
  await page.goto('/docs');
  await expect(page).toHaveURL(/\/login$/);
});

test.describe('full auth flow', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
    test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
  });

  test('sign up → verify → log in lands on projects', async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e+auth-${stamp}@sitelens.test`;
    await page.goto('/signup');
    await page.getByLabel('Organization name').fill(`E2E Auth ${stamp}`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Verify & continue' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { exact: true, name: 'Login' }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  });
});
