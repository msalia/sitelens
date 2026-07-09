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

  await page.getByRole('button', { name: 'Save' }).click();

  // It appears in the Analyses list with its type badge.
  await expect(page.getByText('Driveway path')).toBeVisible();
  await expect(page.getByText('Turning', { exact: true })).toBeVisible();

  // Duplicate → a copy appears.
  await page.getByRole('button', { name: 'Duplicate analysis' }).first().click();
  await expect(page.getByText('Driveway path (copy)')).toBeVisible();
});

test('Solo plan gates the Analysis tab behind the upgrade dialog', async ({ page }) => {
  await signUpAndLogin(page, 'analysis-gate'); // no upgrade → Solo
  await createProjectAndOpen(page, 'Analysis Gate');

  await page.getByRole('button', { exact: true, name: 'Analysis' }).click();
  await expect(page.getByRole('dialog')).toContainText('Crew');
});
