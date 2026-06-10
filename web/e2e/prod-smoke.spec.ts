import { expect, test } from '@playwright/test';

// Phase 10 deliverable: "End-to-end smoke on the production environment (verify
// post-deploy)." Read-only checks against the live deploy — it must NOT create
// data in prod, so there is no signup here. Run this AFTER a deploy finishes.
//
//   PROD: npx playwright test prod-smoke
//   Override target: SITELENS_PROD_URL=https://staging... npx playwright test prod-smoke

const PROD_URL = process.env.SITELENS_PROD_URL ?? 'https://sitelens.msalia.org';

// Hit prod directly, regardless of the local baseURL used by the other specs.
test.use({ baseURL: PROD_URL });

test.describe('production smoke', () => {
  test('home page is live and links to auth', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'SiteLens' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign up' })).toBeVisible();
  });

  test('docs are behind the auth wall in prod', async ({ page }) => {
    // Docs require login; an unauthenticated visit redirects to /login.
    await page.goto('/docs');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('GraphQL API is reachable through the web proxy', async ({ request }) => {
    const res = await request.post(`${PROD_URL}/api/graphql`, {
      data: { query: '{ __typename }' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    // async-graphql names the root type "QueryRoot".
    expect(body?.data?.__typename).toBe('QueryRoot');
  });

  test('auth is enforced in prod (me is null when logged out)', async ({ request }) => {
    // A protected query should resolve to null/empty rather than leak data.
    const res = await request.post(`${PROD_URL}/api/graphql`, {
      data: { query: '{ me { id email } }' },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body?.data?.me ?? null).toBeNull();
  });

  test('TLS certificate is valid (HTTPS served)', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.url().startsWith('https://')).toBeTruthy();
    expect(response?.status()).toBeLessThan(400);
  });
});
