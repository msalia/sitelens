import { expect, type Page } from '@playwright/test';

// Shared E2E helpers. Kept in the project's own e2e dir (never a shared skills
// dir). Each new spec composes these instead of re-implementing the auth flow.

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
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  return email;
}

/** Creates a project and opens its workspace, waiting for the shell to load. */
export async function createProjectAndOpen(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();

  await page.getByRole('link', { name }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+$/);
  // The control-point label input is unique to the loaded workspace.
  await expect(page.locator('#cp-label')).toBeVisible();
}

/**
 * Imports points from pasted CSV in the given unit. `csv` should already include
 * a header row (the importer defaults to PNEZD column mapping with a header).
 */
/** Switches the workspace detail panel to a tab ('Setup' | 'Points' | 'Convert'). */
export async function gotoTab(page: Page, name: 'Setup' | 'Points' | 'Converter'): Promise<void> {
  await page.getByRole('button', { exact: true, name }).click();
}

export async function importCsv(page: Page, csv: string, unit = 'METER'): Promise<void> {
  // Survey-point tools live in the "Points" tab of the workspace detail panel.
  await gotoTab(page, 'Points');
  // `exact` avoids matching the setup-checklist's "Import points" shortcut button.
  await page.getByRole('button', { exact: true, name: 'Import' }).click();
  // Scope to the dialog: "Import points" also exists on the setup checklist.
  const dialog = page.getByRole('dialog');
  await dialog.locator('#imp-unit').selectOption(unit);
  await dialog.getByPlaceholder(/paste content/).fill(csv);
  await dialog.getByRole('button', { name: 'Import points' }).click();
  // Dialog closes on success (toast confirms); wait for it to go away.
  await expect(dialog).toBeHidden();
}
