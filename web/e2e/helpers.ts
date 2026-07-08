import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';

// --- Billing test backdoors -------------------------------------------------
// Entitlement-gated UI needs an org on a given plan. Rather than drive Stripe
// Checkout for every feature test (slow + flaky), we write the org's billing
// columns directly in the dev database. The real payment path is covered
// separately by billing-checkout.spec.ts (opt-in, Stripe CLI) and the API's
// webhook integration tests. Requires the docker stack to be up.

const COMPOSE_FILE = path.resolve(process.cwd(), '..', 'docker-compose.yml');

function psql(sql: string): void {
  execSync(
    `docker compose -f "${COMPOSE_FILE}" exec -T db psql -U postgres -d sitelens -v ON_ERROR_STOP=1 -c "${sql}"`,
    { stdio: 'pipe' },
  );
}

/** Marks the org owning `email` as a paying Crew subscriber (active, renews in
 *  30 days). */
export function upgradeOrg(email: string): void {
  psql(
    `UPDATE orgs SET subscription_status='active', current_period_end=now() + interval '30 days', cancel_at_period_end=false WHERE id=(SELECT org_id FROM users WHERE email='${email}')`,
  );
}

/** Forces the org owning `email` into the read-only lapsed state (canceled
 *  subscription). Combine with being over the Solo caps to trigger the gate. */
export function lapseOrg(email: string): void {
  psql(
    `UPDATE orgs SET subscription_status='canceled', cancel_at_period_end=false WHERE id=(SELECT org_id FROM users WHERE email='${email}')`,
  );
}

/** Whether the API is running in MAIL_CAPTURE mode (e2e records emails instead
 *  of sending them). Tests that depend on reading emails should skip when off. */
export async function mailCaptureEnabled(request: APIRequestContext): Promise<boolean> {
  const res = await request.post('/api/graphql', {
    data: { query: '{ mailCaptureEnabled }' },
  });
  if (!res.ok()) {
    return false;
  }
  return Boolean((await res.json()).data?.mailCaptureEnabled);
}

/** Returns the in-app path (pathname + query) of the first link in the most
 *  recent captured email to `email` whose subject matches `subjectMatch`.
 *  Asserts the mail path actually ran — no real email is ever sent in e2e. */
export async function emailLinkTo(
  request: APIRequestContext,
  email: string,
  subjectMatch: RegExp,
): Promise<string> {
  const res = await request.post('/api/graphql', {
    data: {
      query: 'query SentEmails($to: String) { sentEmails(to: $to) { subject text } }',
      variables: { to: email },
    },
  });
  const emails: { subject: string; text: string }[] = (await res.json()).data?.sentEmails ?? [];
  const hit = emails.find((e) => subjectMatch.test(e.subject));
  expect(hit, `expected a captured email to ${email} matching ${subjectMatch}`).toBeTruthy();
  const url = hit!.text.match(/https?:\/\/\S+/)?.[0];
  expect(url, 'expected a link in the email body').toBeTruthy();
  const parsed = new URL(url!);
  return parsed.pathname + parsed.search;
}

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
  // Verification is emailed; capture the token from the signup response (the
  // mutation still returns it) and visit the verify link directly.
  const signupResp = page.waitForResponse(
    (r) => r.url().includes('/api/graphql') && (r.request().postData() ?? '').includes('Signup'),
  );
  await page.getByRole('button', { name: 'Create account' }).click();
  const token = (await (await signupResp).json()).data.signup.verificationToken as string;
  await page.goto(`/verify?token=${token}`);
  await expect(page.getByRole('button', { name: 'Continue to login' })).toBeVisible();

  await page.goto('/login');
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
  name: 'Setup' | 'Grid' | 'Points' | 'Overlays' | 'Utilities' | 'Surfaces' | 'Field',
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
  // The card footer button opens the add/edit dialog.
  await page.locator('#panel-control').getByRole('button', { name: 'Add control point' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('#cpd-label').fill(point.label);
  await dialog.locator('#cpd-northing').fill(String(point.n));
  await dialog.locator('#cpd-easting').fill(String(point.e));
  if (point.gx !== undefined) {
    await dialog.locator('#cpd-gridx').fill(String(point.gx));
  }
  if (point.gy !== undefined) {
    await dialog.locator('#cpd-gridy').fill(String(point.gy));
  }
  await dialog.getByRole('button', { name: 'Add control point' }).click();
  await expect(page.getByRole('cell', { exact: true, name: point.label })).toBeVisible();
}

/** Adds a grid axis (Grid tab → Building grid card) via the add/edit dialog. */
export async function addGridAxis(
  page: Page,
  axis: { family: 'Lettered' | 'Numbered'; label: string; position: number },
): Promise<void> {
  await gotoTab(page, 'Grid');
  await page.locator('#panel-grid').getByRole('button', { name: 'Add axis' }).click();
  const dialog = page.getByRole('dialog');
  await chooseSelect(page, 'gad-family', axis.family);
  await dialog.locator('#gad-label').fill(axis.label);
  await dialog.locator('#gad-position').fill(String(axis.position));
  await dialog.getByRole('button', { name: 'Add axis' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator('#panel-grid').getByRole('cell', { exact: true, name: axis.label }),
  ).toBeVisible();
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
