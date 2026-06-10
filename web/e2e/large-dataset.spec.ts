import { expect, test } from '@playwright/test';

import { createProjectAndOpen, importCsv, signUpAndLogin } from './helpers';

// Large-dataset: the survey table stays responsive via server-side pagination
// (50/page) and search. (The 3D scene is excluded — needs real WebGL.)
const POINT_COUNT = 1_000;
const NAV_BUDGET_MS = 4_000;
const SEARCH_BUDGET_MS = 4_000;

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test.setTimeout(120_000);

function makeCsv(n: number): string {
  const lines = ['P,N,E,Z,D'];
  for (let i = 0; i < n; i++) {
    lines.push(
      `PT${String(i).padStart(4, '0')},${1000 + (i % 100)},${2000 + Math.floor(i / 100)},${(i % 10) + 1},pt-${i}`,
    );
  }
  return lines.join('\n');
}

test('1,000 points: table paginates and stays responsive', async ({ page }) => {
  await signUpAndLogin(page, 'large');
  await createProjectAndOpen(page, 'Large Site');
  await importCsv(page, makeCsv(POINT_COUNT));

  await expect(page.getByText('Page 1 / 20')).toBeVisible();
  await expect(page.getByText('1–50 of 1000')).toBeVisible();
  // Only one page (50) of rows is in the DOM, not all 1,000.
  await expect(page.getByRole('checkbox', { name: /^Select PT/ })).toHaveCount(50);

  const navStart = Date.now();
  await page.getByRole('button', { exact: true, name: 'Next' }).click();
  await expect(page.getByText('51–100 of 1000')).toBeVisible();
  await expect(page.getByText('Page 2 / 20')).toBeVisible();
  expect(Date.now() - navStart).toBeLessThan(NAV_BUDGET_MS);

  const searchStart = Date.now();
  await page.getByPlaceholder(/Search label/).fill('PT0777');
  await expect(page.getByText('PT0777', { exact: true })).toBeVisible();
  await expect(page.getByText('PT0000', { exact: true })).toBeHidden();
  expect(Date.now() - searchStart).toBeLessThan(SEARCH_BUDGET_MS);
});
