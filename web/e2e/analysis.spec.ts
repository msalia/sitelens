import { expect, test } from '@playwright/test';

import { createProjectAndOpen, gotoTab, signUpAndLogin, upgradeOrg } from './helpers';

// Site Analysis (P1): the analysis module is reachable + gated, and a user can
// draw plan geometry (numeric entry) and save it. Needs the full stack.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('create an analysis by drawing geometry with numeric entry', async ({ page }) => {
  const email = await signUpAndLogin(page, 'analysis-create');
  upgradeOrg(email); // Site Analysis is a Crew feature
  await createProjectAndOpen(page, 'Analysis P1');

  await gotoTab(page, 'Analysis');
  await page.getByLabel('Name').fill('Driveway path');

  // Draw two vertices via numeric entry (no 3D clicking needed in e2e).
  await page.getByRole('button', { name: 'Draw geometry' }).click();
  await page.getByLabel('Easting').fill('0');
  await page.getByLabel('Northing').fill('0');
  await page.getByRole('button', { exact: true, name: 'Add' }).click();
  await page.getByLabel('Easting').fill('10');
  await page.getByLabel('Northing').fill('5');
  await page.getByRole('button', { exact: true, name: 'Add' }).click();
  await expect(page.getByText('Drawing — 2 point(s)')).toBeVisible();

  // Turning is the default type, so the create action is Run (compute + save).
  await page.getByRole('button', { exact: true, name: 'Run' }).click();

  // It appears in the Analyses list with its type badge.
  await expect(page.getByText('Driveway path')).toBeVisible();
  await expect(page.getByText('Turning', { exact: true })).toBeVisible();

  // Duplicate → a copy appears.
  await page.getByRole('button', { name: 'Duplicate analysis' }).first().click();
  await expect(page.getByText('Driveway path (copy)')).toBeVisible();
});

test('run a turning-radius analysis → swept path + pass verdict', async ({ page }) => {
  const email = await signUpAndLogin(page, 'analysis-turning');
  upgradeOrg(email);
  await createProjectAndOpen(page, 'Turning P2');

  await gotoTab(page, 'Analysis');
  await page.getByLabel('Name').fill('Driveway swept path');
  // Type defaults to Turning. Draw a two-point path via numeric entry.
  await page.getByRole('button', { name: 'Draw geometry' }).click();
  await page.getByLabel('Easting').fill('0');
  await page.getByLabel('Northing').fill('0');
  await page.getByRole('button', { exact: true, name: 'Add' }).click();
  await page.getByLabel('Easting').fill('30');
  await page.getByLabel('Northing').fill('0');
  await page.getByRole('button', { exact: true, name: 'Add' }).click();

  // A preset vehicle is preselected; Run computes the tractrix swept path.
  const runResp = page.waitForResponse(
    (r) =>
      r.url().includes('/api/graphql') &&
      (r.request().postData()?.includes('RunTurningAnalysis') ?? false) &&
      r.ok(),
  );
  await page.getByRole('button', { exact: true, name: 'Run' }).click();
  const body = (await (await runResp).json()) as {
    data: { runTurningAnalysis: { result: string } };
  };
  expect(body.data.runTurningAnalysis.result).toContain('"pass":true');

  // The completed analysis shows a Pass badge in the list.
  await expect(page.getByText('Driveway swept path')).toBeVisible();
  await expect(page.getByText('Pass', { exact: true })).toBeVisible();
});

test('Solo plan gates the Analysis tab behind the upgrade dialog', async ({ page }) => {
  await signUpAndLogin(page, 'analysis-gate'); // no upgrade → Solo
  await createProjectAndOpen(page, 'Analysis Gate');

  await page.getByRole('button', { exact: true, name: 'Analysis' }).click();
  await expect(page.getByRole('dialog')).toContainText('Crew');
});
