import { expect, test } from '@playwright/test';

test('home page renders and links to docs', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'SiteLens', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /documentation/i })).toBeVisible();
});

test('docs index renders with navigation', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.getByRole('heading', { name: 'Introduction', level: 1 })).toBeVisible();
  // Grouped nav is present.
  await expect(page.getByText('Guides', { exact: true })).toBeVisible();
  await expect(page.getByText('Reference', { exact: true })).toBeVisible();
});

test('can navigate to a docs topic', async ({ page }) => {
  await page.goto('/docs');
  await page.getByRole('link', { name: 'The Transform' }).click();
  await expect(page).toHaveURL(/\/docs\/the-transform$/);
  await expect(page.getByRole('heading', { name: 'The Transform', level: 1 })).toBeVisible();
  await expect(page.getByText(/Helmert/i).first()).toBeVisible();
});
