import { expect, test } from '@playwright/test';

import { createProjectAndOpen, importCsv, signUpAndLogin } from './helpers';

// Phase 9 deliverable: "Large-dataset E2E: UI stays responsive with a high point
// count." Imports a realistic point volume, then asserts that pagination, search,
// and the 3D scene all stay responsive (each interaction within a time budget).
// Pagination (50/page) + server-side search + Cesium clustering are what keep the
// UI fast; this test guards against regressions in any of them.

const POINT_COUNT = 1_000;
// Generous wall-clock budgets — the point is to catch O(n) UI regressions
// (e.g. rendering all 1,000 rows), not to micro-benchmark.
const NAV_BUDGET_MS = 4_000;
const SEARCH_BUDGET_MS = 4_000;
const SCENE_BUDGET_MS = 30_000;

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

// Importing 1,000 points + booting the 3D engine needs more than the default.
test.setTimeout(120_000);

function makeCsv(n: number): string {
  const lines = ['P,N,E,Z,D'];
  for (let i = 0; i < n; i++) {
    // Spread points over a ~1km patch so the scene has real extent to cluster.
    const north = 1000 + (i % 100);
    const east = 2000 + Math.floor(i / 100);
    lines.push(`PT${String(i).padStart(4, '0')},${north},${east},${(i % 10) + 1},pt-${i}`);
  }
  return lines.join('\n');
}

test('1,000 points: table paginates and stays responsive', async ({ page }) => {
  await signUpAndLogin(page, 'large');
  await createProjectAndOpen(page, 'Large Site');

  await importCsv(page, makeCsv(POINT_COUNT));

  // The footer reports the full total even though only a page is rendered.
  await expect(page.getByText(`of ${POINT_COUNT}`)).toBeVisible();
  await expect(page.getByText('Page 1 / 20')).toBeVisible();
  await expect(page.getByText('1–50 of 1000')).toBeVisible();

  // Only one page (50) of rows is in the DOM — not all 1,000.
  const rowCheckboxes = page.getByRole('checkbox', { name: /^Select PT/ });
  await expect(rowCheckboxes).toHaveCount(50);

  // Paging forward is fast (server-side offset, not client filtering).
  const navStart = Date.now();
  await page.getByRole('button', { exact: true, name: 'Next' }).click();
  await expect(page.getByText('51–100 of 1000')).toBeVisible();
  await expect(page.getByText('Page 2 / 20')).toBeVisible();
  expect(Date.now() - navStart).toBeLessThan(NAV_BUDGET_MS);

  // Jump to the last page.
  for (let i = 0; i < 18; i++) {
    await page.getByRole('button', { exact: true, name: 'Next' }).click();
  }
  await expect(page.getByText('Page 20 / 20')).toBeVisible();
  await expect(page.getByText('951–1000 of 1000')).toBeVisible();
  await expect(page.getByRole('button', { exact: true, name: 'Next' })).toBeDisabled();

  // Server-side search narrows the set quickly to a single point.
  const searchStart = Date.now();
  await page.getByPlaceholder(/Search label/).fill('PT0777');
  await expect(page.getByText('of 1')).toBeVisible();
  await expect(page.getByRole('cell', { exact: true, name: 'PT0777' })).toBeVisible();
  expect(Date.now() - searchStart).toBeLessThan(SEARCH_BUDGET_MS);

  // Clearing the search restores the full count.
  await page.getByPlaceholder(/Search label/).fill('');
  await expect(page.getByText(`of ${POINT_COUNT}`)).toBeVisible();
});

test('1,000 points: 3D scene loads without choking', async ({ page }) => {
  await signUpAndLogin(page, 'large-3d');
  await createProjectAndOpen(page, 'Large 3D');

  await importCsv(page, makeCsv(POINT_COUNT));
  await expect(page.getByText(`of ${POINT_COUNT}`)).toBeVisible();

  // Boot the lazy 3D engine; clustering should keep it from stalling.
  const sceneStart = Date.now();
  await page.getByRole('button', { name: 'Show 3D view' }).click();
  // CesiumViewer mounts a <canvas> once the engine + scene data are ready.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: SCENE_BUDGET_MS });
  expect(Date.now() - sceneStart).toBeLessThan(SCENE_BUDGET_MS);

  // The scene controls (category toggles / Snapshot) become available, proving
  // the viewer finished mounting rather than hanging on the loader.
  await expect(page.getByRole('button', { name: 'Snapshot' })).toBeVisible();
});
