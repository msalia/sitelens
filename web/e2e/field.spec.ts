import { expect, test } from '@playwright/test';

import {
  chooseSelect,
  createProjectAndOpen,
  gotoTab,
  importCsv,
  signUpAndLogin,
  upgradeOrg,
} from './helpers';

// Field Exchange (P5): export presets, as-built import + comparison, manual
// pairing, and the Solo-plan gate. Needs the full stack (skips if API is down).
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('export design points in a field-app preset', async ({ page }) => {
  const email = await signUpAndLogin(page, 'field-export');
  upgradeOrg(email); // Field Exchange is a Crew feature
  await createProjectAndOpen(page, 'Field Export');
  await importCsv(page, ['P,N,E,Z,D', '1,100,200,5,MON', '2,101,201,,IP'].join('\n'));

  await gotoTab(page, 'Field');
  await chooseSelect(page, 'fx-preset', 'Carlson / MicroSurvey');
  await chooseSelect(page, 'fx-space', 'Projected (grid)');
  await chooseSelect(page, 'fx-unit', 'Meter');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/field-export\.csv$/i);
});

test('import as-built → results table → manual pair an unmatched point', async ({ page }) => {
  const email = await signUpAndLogin(page, 'field-import');
  upgradeOrg(email);
  await createProjectAndOpen(page, 'Field Import');
  // Design baseline (meters, projected-grid).
  await importCsv(page, ['P,N,E,Z,D', '1,100,200,5,', '2,0,0,0,'].join('\n'));

  await gotoTab(page, 'Field');

  // Upload an as-built CSV: "1" exact-matches design; "99" is unmatched.
  await page.locator('#asbuilt-file').setInputFiles({
    buffer: Buffer.from('Point,Northing,Easting,Elevation,Code\n1,100,200,5,\n99,50,50,,\n'),
    mimeType: 'text/csv',
    name: 'asbuilt.csv',
  });
  // Compare in the same frame the design points were imported in.
  await chooseSelect(page, 'fx-im-preset', 'Generic CSV');
  await chooseSelect(page, 'fx-im-space', 'Projected (grid)');
  await chooseSelect(page, 'fx-im-unit', 'Meter');
  await page.getByRole('button', { name: 'Import & compare' }).click();

  // Results render: "1" passes, "99" is unmatched with a pairing control.
  await expect(page.getByText('Pass', { exact: true })).toBeVisible();
  const pair = page.getByRole('combobox', { name: 'Pair 99' });
  await expect(pair).toBeVisible();

  // Manually pair "99" to design point "2" → it leaves the unmatched state.
  await pair.click();
  await page.getByRole('option', { name: '2' }).click();
  await expect(page.getByRole('combobox', { name: 'Pair 99' })).toHaveCount(0);
});

test('Solo plan sees the Field upgrade gate', async ({ page }) => {
  await signUpAndLogin(page, 'field-gate'); // not upgraded → Solo
  await createProjectAndOpen(page, 'Field Gate');
  await page.getByRole('button', { exact: true, name: 'Field' }).click();
  // Instead of the panel, the Crew upsell dialog appears.
  await expect(page.getByRole('dialog')).toContainText('Crew');
});
