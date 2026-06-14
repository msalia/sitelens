import { expect, test } from '@playwright/test';

import { signUpAndLogin } from './helpers';

// Auth surfaces: login (email/password, no SSO), signup card, and the
// docs-behind-auth gate. Layout checks are static; the verify flow needs the API.

test('login page renders the email/password layout', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Login to your account' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'Login' })).toBeVisible();
  // SSO has been removed — no social login button.
  await expect(page.getByRole('button', { name: /Continue with Google/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
});

test('the forgot-password link opens the reset-request page', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
});

test('signup page renders the create-organization card', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByText('Create your organization')).toBeVisible();
  await expect(page.getByLabel('Organization name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  // SSO has been removed — no social signup button.
  await expect(page.getByRole('button', { name: /Sign up with Google/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
});

test('docs are public and render content without login', async ({ page }) => {
  // Docs are a public, server-rendered help site (for SEO) — no auth wall.
  await page.goto('/docs');
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Introduction' })).toBeVisible();
});

test.describe('full auth flow', () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
    test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
  });

  test('sign up → verify → log in lands on projects', async ({ page }) => {
    await signUpAndLogin(page, 'auth');
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
  });
});
