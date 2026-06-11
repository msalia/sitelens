import { expect, test } from '@playwright/test';

import { emailLinkTo, mailCaptureEnabled, signUpAndLogin } from './helpers';

// Self-service password reset. Emails are never really sent: the API runs in
// MAIL_CAPTURE mode and we read the link back via the `sentEmails` query, so
// these assert the mail path was exercised without spending Resend quota.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
  test.skip(
    !(await mailCaptureEnabled(request)),
    'API not in MAIL_CAPTURE mode — run the API with MAIL_CAPTURE=1',
  );
});

test('signup triggers a verification email (captured, not sent)', async ({ page, request }) => {
  const email = await signUpAndLogin(page, 'mail-verify');
  // The signup mutation must have invoked the mailer with a verify link.
  const link = await emailLinkTo(request, email, /verify/i);
  expect(link).toContain('/verify?token=');
});

test('forgot password → emailed link → new password → login', async ({ page, request }) => {
  const email = await signUpAndLogin(page, 'reset');

  // Request a reset from the public page (no account-enumeration in the copy).
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();

  // Follow the captured reset link and set a new password.
  const link = await emailLinkTo(request, email, /reset/i);
  expect(link).toContain('/reset-password?token=');
  await page.goto(link);

  const newPassword = 'newpassword456';
  await page.getByLabel('New password').fill(newPassword);
  await page.getByLabel('Confirm password').fill(newPassword);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // The new password logs in.
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(newPassword);
  await page.getByRole('button', { exact: true, name: 'Login' }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test('requesting a reset for an unknown email still succeeds and sends nothing', async ({
  page,
  request,
}) => {
  const unknown = `e2e+nobody-${Date.now()}@sitelens.test`;
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(unknown);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/reset link is on its way/i)).toBeVisible();

  // No account → no email captured for that address.
  const res = await request.post('/api/graphql', {
    data: {
      query: 'query($to: String) { sentEmails(to: $to) { subject } }',
      variables: { to: unknown },
    },
  });
  expect((await res.json()).data.sentEmails).toHaveLength(0);
});
