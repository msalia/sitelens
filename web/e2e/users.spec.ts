import { expect, test } from '@playwright/test';

import { emailLinkTo, mailCaptureEnabled, signUpAndLogin } from './helpers';

// Admin user management + invite acceptance. Invite emails are captured (never
// sent) so we can follow the accept link without spending Resend quota.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
  test.skip(
    !(await mailCaptureEnabled(request)),
    'API not in MAIL_CAPTURE mode — run the API with MAIL_CAPTURE=1',
  );
});

test('admin invites a user → invite email captured → invitee accepts and lands in projects', async ({
  browser,
  page,
  request,
}) => {
  await signUpAndLogin(page, 'inviter');

  await page.goto('/settings/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  const invitee = `e2e+invitee-${Date.now()}@sitelens.test`;
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(invitee);
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await expect(dialog).toBeHidden();

  // The invitee shows up in the roster as pending.
  await expect(page.getByRole('cell', { name: invitee })).toBeVisible();

  // The invite email was produced and carries an accept link.
  const link = await emailLinkTo(request, invitee, /invited/i);
  expect(link).toContain('/accept-invite?token=');

  // Accept the invite in a fresh, unauthenticated context (a manually created
  // context doesn't inherit the project's baseURL, so set it explicitly).
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
  const invitedPage = await ctx.newPage();
  await invitedPage.goto(link);
  await invitedPage.getByLabel('Password', { exact: true }).fill('password123');
  await invitedPage.getByLabel('Confirm password').fill('password123');
  await invitedPage.getByRole('button', { name: 'Join organization' }).click();
  await expect(invitedPage).toHaveURL(/\/projects$/);
  await ctx.close();
});

test('resetting a user from the roster prompts for confirmation and emails a link', async ({
  page,
  request,
}) => {
  const adminEmail = await signUpAndLogin(page, 'roster');
  await page.goto('/settings/users');

  // The admin's own row exposes a Reset action behind a confirmation dialog.
  // Scope to the row — a page-level "Reset" match also hits the user-menu button
  // whose accessible name contains the email address.
  await page.getByRole('row', { name: adminEmail }).getByRole('button', { name: 'Reset' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/send a password reset link/i)).toBeVisible();
  await dialog.getByRole('button', { name: 'Send reset link' }).click();

  // Wait for the success toast so the reset mutation has completed before we
  // read the captured mailbox.
  await expect(page.getByText(/sent a reset link to/i)).toBeVisible();

  // A reset email was produced for the admin.
  const link = await emailLinkTo(request, adminEmail, /reset/i);
  expect(link).toContain('/reset-password?token=');
});
