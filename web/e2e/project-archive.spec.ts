import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { addControlPoint, createProjectAndOpen, signUpAndLogin } from './helpers';

// Project export (.slx) → re-import round-trip.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('export a project and re-import it from the archive', async ({ page }) => {
  await signUpAndLogin(page, 'archive');
  await createProjectAndOpen(page, 'Archive Source');
  await addControlPoint(page, { e: 2000, gx: 0, gy: 0, label: 'MON1', n: 1000 });

  // Export: icon button → confirm alert → download.
  await page.getByRole('button', { name: 'Export project' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Download archive' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.slx$/);
  const buffer = readFileSync(await download.path());

  // Import: drop the archive into the projects-page import card (hidden input).
  await page.goto('/projects');
  await page
    .locator('input[type="file"][accept=".slx"]')
    .setInputFiles({ buffer, mimeType: 'application/json', name: 'archive-source.slx' });

  // The import creates a second project with the same name; both now list.
  await expect(page.getByRole('link', { name: 'Archive Source' })).toHaveCount(2);
});
