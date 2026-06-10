import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { createProjectAndOpen, importCsv, signUpAndLogin } from './helpers';

// Phase 8 deliverable: "Playwright: select points → export → verify file contents."
// Goes beyond the core-flow smoke (which only checks the download filename) by
// reading the downloaded file and asserting exact CSV header, row order, scope
// (only selected points), and value formatting.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('select points → CSV export → verify file contents', async ({ page }) => {
  await signUpAndLogin(page, 'export');
  await createProjectAndOpen(page, 'Export Verify');

  // Import three points in METERS so stored = input (no unit conversion to
  // reason about), giving fully deterministic export values.
  await importCsv(
    page,
    ['P,N,E,Z,D', 'PT1,100.25,200.5,5,MON', 'PT2,101,201,,IP', 'PT3,102.75,202.25,7.5,BM'].join(
      '\n',
    ),
  );

  // All three land in the table.
  for (const label of ['PT1', 'PT2', 'PT3']) {
    await expect(page.getByRole('cell', { exact: true, name: label })).toBeVisible();
  }

  // Select the first and third points only (skip PT2) via their row checkboxes.
  await page.getByRole('checkbox', { name: 'Select PT1' }).check();
  await page.getByRole('checkbox', { name: 'Select PT3' }).check();
  await expect(page.getByText('2 selected').first()).toBeVisible();

  // Export: scope defaults to "selection" when points are selected. Pin the
  // space (projected grid) and unit (meter) so values are predictable.
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('heading', { name: 'Export points' })).toBeVisible();
  await page.locator('#exp-format').selectOption('CSV');
  await page.locator('#exp-space').selectOption('PROJECTED_GRID');
  await page.locator('#exp-unit').selectOption('METER');
  await expect(page.locator('#exp-scope')).toHaveValue('selection');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/export-verify-points\.csv$/);

  const path = await download.path();
  const contents = await readFile(path, 'utf8');
  // Normalize CRLF (RFC-4180 CSV writer) and drop a trailing newline.
  const lines = contents.replace(/\r\n/g, '\n').trimEnd().split('\n');

  // Exact header from the default column set, in canonical order.
  expect(lines[0]).toBe('Point,Northing,Easting,Elevation,Description');
  // Only the two selected points, in created order (PT1 then PT3) — no PT2.
  expect(lines).toHaveLength(3);
  expect(lines[1]).toBe('PT1,100.2500,200.5000,5.0000,MON');
  expect(lines[2]).toBe('PT3,102.7500,202.2500,7.5000,BM');
  expect(contents).not.toContain('PT2');
});

test('LandXML export emits CgPoints for the selected scope', async ({ page }) => {
  await signUpAndLogin(page, 'export-xml');
  await createProjectAndOpen(page, 'Export XML');

  await importCsv(page, ['P,N,E,Z,D', 'A1,10,20,1,MON', 'A2,11,21,,IP'].join('\n'));
  await expect(page.getByRole('cell', { exact: true, name: 'A1' })).toBeVisible();

  // No selection → scope "all".
  await page.getByRole('button', { name: 'Export' }).click();
  await page.locator('#exp-format').selectOption('LANDXML');
  await page.locator('#exp-space').selectOption('PROJECTED_GRID');
  await page.locator('#exp-unit').selectOption('METER');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.xml$/);
  const xml = await readFile(await download.path(), 'utf8');

  expect(xml).toContain('<LandXML');
  expect(xml).toContain('<CgPoints>');
  // Point with elevation carries three coords; the one without carries two.
  expect(xml).toContain('<CgPoint name="A1" desc="MON">10 20 1</CgPoint>');
  expect(xml).toContain('<CgPoint name="A2" desc="IP">11 21</CgPoint>');
});
