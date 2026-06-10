import { expect, test } from '@playwright/test';

// This flow needs the full stack (web + api + db). When only the web dev server
// is running (no API), it self-skips. Run `docker compose up` then `npm run test:e2e`.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', {
    data: { query: '{ __typename }' },
  });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('sign up, verify, create a project, and see it listed', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e+${stamp}@sitelens.test`;

  // Sign up.
  await page.goto('/signup');
  await page.getByLabel('Organization name').fill(`E2E Org ${stamp}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Verify (token shown on the page since email delivery is deferred).
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Log in.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // Create a project.
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('E2E Tower');
  await page.getByRole('button', { name: 'Create project' }).click();

  // It appears in the list.
  await expect(page.getByRole('link', { name: 'E2E Tower' })).toBeVisible();
});
