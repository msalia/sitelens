import { expect, test } from '@playwright/test';

test('home page renders and links to auth', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Tie Every Survey/ })).toBeVisible();
  // Both the header and footer link to auth; scope to the header so the
  // locator stays unambiguous (avoids a strict-mode violation).
  const header = page.getByRole('banner');
  await expect(header.getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Sign up' })).toBeVisible();
});

test('docs are public and render content without login', async ({ page }) => {
  // Docs are a public, server-rendered help site (for SEO) — no auth wall.
  await page.goto('/docs');
  await expect(page).toHaveURL(/\/docs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Introduction' })).toBeVisible();
});

test('login page renders the login-02 layout', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Login to your account' })).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'Login' })).toBeVisible();
});
