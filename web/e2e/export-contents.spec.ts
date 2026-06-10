import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { chooseSelect, createProjectAndOpen, importCsv, signUpAndLogin } from './helpers';

// Select points → export → verify the downloaded file contents (CSV + LandXML).
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('select points → CSV export → verify file contents', async ({ page }) => {
  await signUpAndLogin(page, 'export');
  await createProjectAndOpen(page, 'Export Verify');
  await importCsv(
    page,
    ['P,N,E,Z,D', 'PT1,100.25,200.5,5,MON', 'PT2,101,201,,IP', 'PT3,102.75,202.25,7.5,BM'].join(
      '\n',
    ),
  );

  await page.getByRole('checkbox', { name: 'Select PT1' }).check();
  await page.getByRole('checkbox', { name: 'Select PT3' }).check();

  await page.getByRole('button', { name: /Export points/ }).click();
  const dialog = page.getByRole('dialog');
  await chooseSelect(page, 'exp-space', 'Projected (grid)');
  await chooseSelect(page, 'exp-unit', 'Meter');

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/export-verify-points\.csv$/);

  const contents = await readFile(await download.path(), 'utf8');
  const lines = contents.replace(/\r\n/g, '\n').trimEnd().split('\n');
  expect(lines[0]).toBe('Point,Northing,Easting,Elevation,Description');
  expect(lines).toHaveLength(3);
  expect(lines[1]).toBe('PT1,100.2500,200.5000,5.0000,MON');
  expect(lines[2]).toBe('PT3,102.7500,202.2500,7.5000,BM');
  expect(contents).not.toContain('PT2');
});

test('LandXML export emits CgPoints', async ({ page }) => {
  await signUpAndLogin(page, 'export-xml');
  await createProjectAndOpen(page, 'Export XML');
  await importCsv(page, ['P,N,E,Z,D', 'A1,10,20,1,MON', 'A2,11,21,,IP'].join('\n'));

  await page.getByRole('button', { name: /Export points/ }).click();
  const dialog = page.getByRole('dialog');
  await chooseSelect(page, 'exp-format', 'LandXML');
  await chooseSelect(page, 'exp-space', 'Projected (grid)');
  await chooseSelect(page, 'exp-unit', 'Meter');

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xml$/);

  const xml = await readFile(await download.path(), 'utf8');
  expect(xml).toContain('<CgPoints>');
  expect(xml).toContain('<CgPoint name="A1" desc="MON">10 20 1</CgPoint>');
  expect(xml).toContain('<CgPoint name="A2" desc="IP">11 21</CgPoint>');
});
