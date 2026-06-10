import { expect, type Page, test } from '@playwright/test';

// The full surveyor workflow end-to-end against the real stack (web + api + db).
// When only the web dev server is up (no API), it self-skips. Run the stack with
// `docker compose up` (or the override) and `npm run test:e2e`.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

async function signUpAndLogin(page: Page): Promise<void> {
  const stamp = Date.now();
  const email = `e2e+core-${stamp}@sitelens.test`;

  await page.goto('/signup');
  await page.getByLabel('Organization name').fill(`E2E Core ${stamp}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Email delivery is deferred; the verification token is surfaced in-app.
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/projects$/);
}

async function addControlPoint(
  page: Page,
  label: string,
  northing: number,
  easting: number,
  gridX: number,
  gridY: number,
): Promise<void> {
  await page.locator('#cp-label').fill(label);
  await page.getByPlaceholder(/^Northing/).fill(String(northing));
  await page.getByPlaceholder(/^Easting/).fill(String(easting));
  await page.getByPlaceholder(/^Grid X/).fill(String(gridX));
  await page.getByPlaceholder(/^Grid Y/).fill(String(gridY));
  // Scope to the panel: the setup checklist also has an "Add control points" button.
  await page.locator('#panel-control').getByRole('button', { name: 'Add control point' }).click();
  await expect(page.getByRole('cell', { exact: true, name: label })).toBeVisible();
}

test('core surveyor workflow: project → control points → solve → import → convert → export', async ({
  page,
}) => {
  await signUpAndLogin(page);

  // Create a project (EPSG + unit have sane defaults).
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill('E2E Survey');
  await page.getByRole('button', { name: 'Create project' }).click();

  // Open its workspace.
  await page.getByRole('link', { name: 'E2E Survey' }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  // The control-point label input is unique to the loaded workspace.
  await expect(page.locator('#cp-label')).toBeVisible();

  // Tie the building grid to the projected system with three control points.
  await addControlPoint(page, 'CP1', 1000, 2000, 0, 0);
  await addControlPoint(page, 'CP2', 1000, 2100, 100, 0);
  await addControlPoint(page, 'CP3', 1100, 2000, 0, 100);

  // Solve the Helmert transform; residuals appear. Scope to the panel — the
  // setup checklist also exposes a "Solve transform" shortcut button.
  await page.locator('#panel-transform').getByRole('button', { name: 'Solve transform' }).click();
  await expect(page.getByText(/Residuals/)).toBeVisible();

  // Import surveyed points from a pasted PNEZD CSV. `exact` skips the checklist's
  // "Import points" shortcut; the submit is scoped to the dialog.
  await page.locator('#panel-points').getByRole('button', { exact: true, name: 'Import' }).click();
  const importDialog = page.getByRole('dialog');
  await importDialog
    .getByPlaceholder(/paste content/)
    .fill('P,N,E,Z,D\nPT1,100,200,5,MON\nPT2,101,201,,IP\n');
  await importDialog.getByRole('button', { name: 'Import points' }).click();

  // Points show up in the paginated table with a total.
  await expect(page.getByRole('cell', { exact: true, name: 'PT1' })).toBeVisible();
  await expect(page.getByText(/of 2/)).toBeVisible();

  // Standalone converter returns every representation of a coordinate.
  await page.getByLabel('Easting', { exact: true }).fill('545000');
  await page.getByLabel('Northing', { exact: true }).fill('4184000');
  await page.getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByText('Latitude')).toBeVisible();

  // Export the points to CSV — a download is triggered.
  await page.getByRole('button', { name: 'Export' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});
