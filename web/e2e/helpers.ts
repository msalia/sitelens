import { expect, type Page } from '@playwright/test';

// Shared E2E helpers for the command-center UI. Kept in the project's own e2e dir.
// The app uses base-ui primitives: Select items are role="option", dropdown items
// role="menuitem", switches role="switch".

/** Signs up a brand-new org, verifies (token surfaced in-app), and logs in. */
export async function signUpAndLogin(page: Page, tag: string): Promise<string> {
  const stamp = Date.now();
  const email = `e2e+${tag}-${stamp}@sitelens.test`;

  await page.goto('/signup');
  await page.getByLabel('Organization name').fill(`E2E ${tag} ${stamp}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();

  // Email delivery is deferred; the verification token is surfaced in-app.
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { exact: true, name: 'Login' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  return email;
}

/** Creates a project (sane EPSG/unit defaults) and opens its workspace. */
export async function createProjectAndOpen(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('link', { name }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  // The command-center detail panel exposes the Setup tab once loaded.
  await expect(page.getByRole('button', { exact: true, name: 'Setup' })).toBeVisible();
}

/** Switches the workspace detail panel to a tab. */
export async function gotoTab(
  page: Page,
  name: 'Setup' | 'Grid' | 'Points' | 'Overlays',
): Promise<void> {
  await page.getByRole('button', { exact: true, name }).click();
}

/** Picks an option from a shadcn (base-ui) Select given its trigger id. */
export async function chooseSelect(
  page: Page,
  triggerId: string,
  optionName: string,
): Promise<void> {
  await page.locator(`#${triggerId}`).click();
  await page.getByRole('option', { name: optionName }).click();
}

/** Adds a control point (Control tab) via the Field inputs. */
export async function addControlPoint(
  page: Page,
  point: { label: string; n: number; e: number; gx?: number; gy?: number },
): Promise<void> {
  await gotoTab(page, 'Grid');
  await page.locator('#cp-label').fill(point.label);
  await page.locator('#cp-northing').fill(String(point.n));
  await page.locator('#cp-easting').fill(String(point.e));
  if (point.gx !== undefined) {
    await page.locator('#cp-gridx').fill(String(point.gx));
  }
  if (point.gy !== undefined) {
    await page.locator('#cp-gridy').fill(String(point.gy));
  }
  await page.locator('#panel-control').getByRole('button', { name: 'Add control point' }).click();
  await expect(page.getByRole('cell', { exact: true, name: point.label })).toBeVisible();
}

/**
 * Imports points from pasted CSV (Points tab → "Import points" action row).
 * `unitLabel` is the human label shown in the unit Select (e.g. "Meter").
 */
export async function importCsv(page: Page, csv: string, unitLabel = 'Meter'): Promise<void> {
  await gotoTab(page, 'Points');
  // The "Manage points" card exposes the import action row (a dialog trigger).
  await page.getByRole('button', { name: /Import points/ }).click();
  const dialog = page.getByRole('dialog');
  await chooseSelect(page, 'imp-unit', unitLabel);
  await dialog.getByPlaceholder(/paste content/).fill(csv);
  await dialog.getByRole('button', { exact: true, name: 'Import points' }).click();
  await expect(dialog).toBeHidden();
}
