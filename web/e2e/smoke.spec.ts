import { expect, test } from '@playwright/test';

test('home page renders and links to auth', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'SiteLens' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
});

test('docs are behind the auth wall', async ({ page }) => {
  // Docs moved behind login; an unauthenticated visit redirects to /login.
  await page.goto('/docs');
  await expect(page).toHaveURL(/\/login$/);
});

test('login page renders the login-02 layout', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Login to your account' })).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'Login' })).toBeVisible();
});
