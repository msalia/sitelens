import { expect, test } from '@playwright/test';

import {
  createProjectAndOpen,
  emailLinkTo,
  gotoTab,
  lapseOrg,
  mailCaptureEnabled,
  signUpAndLogin,
  upgradeOrg,
} from './helpers';

// Subscription paywall: every pay-gated capability is checked on BOTH tiers —
// Solo (free) blocks/hides it, Crew (paid) allows it. The Crew tier is minted via
// the DB backdoor (upgradeOrg) so these stay fast + deterministic; the real Stripe
// Checkout payment path lives in billing-checkout.spec.ts.
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test.describe('Solo (free) tier', () => {
  test('billing page shows the Solo plan, usage, and upgrade CTAs', async ({ page }) => {
    await signUpAndLogin(page, 'free-bill');
    await page.goto('/settings/billing');

    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
    // The plan title renders "Solo" + "Free plan" together, so match by substring.
    await expect(page.getByText('Solo')).toBeVisible();
    await expect(page.getByText('Free plan')).toBeVisible();
    // Usage vs Solo limits (fresh org: 0 projects, the founding admin, 0 members).
    await expect(page.getByText('0 / 1')).toBeVisible();
    await expect(page.getByText('1 / 1')).toBeVisible();
    await expect(page.getByText('0 / 5')).toBeVisible();
    // Admin upgrade CTAs.
    await expect(page.getByRole('button', { name: /Upgrade —/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Yearly —/ })).toBeVisible();
  });

  test('settings shows the Solo badge + an upgrade affordance', async ({ page }) => {
    await signUpAndLogin(page, 'free-badge');
    await page.goto('/settings');
    await expect(page.getByText('Solo · Free')).toBeVisible();
    await expect(page.getByText('Upgrade', { exact: true })).toBeVisible();
  });

  test('a second project is blocked with an upgrade prompt', async ({ page }) => {
    await signUpAndLogin(page, 'free-2proj');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.getByLabel('Name').fill('Site One');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('link', { name: 'Site One' })).toBeVisible();

    // The second "New project" opens the upgrade prompt instead of the form.
    await page.getByRole('button', { name: 'New project' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText("You've reached the Solo limit")).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'See plans' })).toBeVisible();
  });

  // Export/overlays triggers stay disabled until billing resolves, so Playwright
  // auto-waits for "enabled" before clicking — the free tier always gets the
  // upsell, never the real form, with no manual billing wait needed.
  test('point export is gated behind Crew', async ({ page }) => {
    await signUpAndLogin(page, 'free-export');
    await createProjectAndOpen(page, 'Free Site');
    await gotoTab(page, 'Points');
    await page.getByRole('button', { name: /Export points/ }).click();
    await expect(page.getByRole('dialog').getByText('Exporting is a Crew feature')).toBeVisible();
  });

  test('project (.slx) export is gated behind Crew', async ({ page }) => {
    await signUpAndLogin(page, 'free-archive');
    await createProjectAndOpen(page, 'Free Archive');
    await page.getByRole('button', { name: 'Export project' }).click();
    await expect(page.getByRole('dialog').getByText('Exporting is a Crew feature')).toBeVisible();
  });

  test('the DXF Overlays tab upsells on the free tier', async ({ page }) => {
    await signUpAndLogin(page, 'free-dxf');
    await createProjectAndOpen(page, 'Free DXF');
    // The tab is shown on the free tier; clicking it opens the upgrade prompt.
    await page.getByRole('button', { exact: true, name: 'Overlays' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('DXF overlays is a Crew feature')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'See plans' })).toBeVisible();
  });
});

test.describe('Crew (paid) tier', () => {
  test('billing page shows the Crew plan + manage subscription', async ({ page }) => {
    const email = await signUpAndLogin(page, 'crew-bill');
    upgradeOrg(email);
    await page.goto('/settings/billing');

    // Scope to the plan card title (`Crew` + a `Paid plan` badge), not the
    // "…crew-bill…" email in the header.
    await expect(page.locator('[data-slot="card-title"]', { hasText: 'Crew' })).toBeVisible();
    await expect(page.getByText('Paid plan')).toBeVisible();
    await expect(page.getByText('Renews on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage billing' })).toBeVisible();
  });

  test('settings shows the Crew badge', async ({ page }) => {
    const email = await signUpAndLogin(page, 'crew-badge');
    upgradeOrg(email);
    await page.goto('/settings');
    await expect(page.getByText('Crew', { exact: true })).toBeVisible();
  });

  test('can create multiple projects', async ({ page }) => {
    const email = await signUpAndLogin(page, 'crew-proj');
    upgradeOrg(email);
    await page.goto('/projects'); // reload so billing reflects Crew before creating
    for (const name of ['Crew A', 'Crew B']) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByLabel('Name').fill(name);
      await page.getByRole('button', { name: 'Create project' }).click();
      await expect(page.getByRole('link', { name })).toBeVisible();
    }
  });

  test('point export opens the export form (not the upgrade prompt)', async ({ page }) => {
    const email = await signUpAndLogin(page, 'crew-export');
    upgradeOrg(email);
    await createProjectAndOpen(page, 'Crew Site');
    await gotoTab(page, 'Points');
    await page.getByRole('button', { name: /Export points/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/Download surveyed points/)).toBeVisible();
  });

  test('the DXF Overlays tab is available', async ({ page }) => {
    const email = await signUpAndLogin(page, 'crew-dxf');
    upgradeOrg(email);
    await createProjectAndOpen(page, 'Crew DXF');
    await expect(page.getByRole('button', { exact: true, name: 'Overlays' })).toBeVisible();
    await gotoTab(page, 'Overlays');
    await expect(page.getByText('DXF overlays')).toBeVisible();
  });
});

test.describe('Lapsed subscription', () => {
  test('an over-cap canceled org is locked to a read-only upgrade gate', async ({ page }) => {
    const email = await signUpAndLogin(page, 'lapsed');
    upgradeOrg(email);
    await page.goto('/projects'); // reload so billing reflects Crew before creating
    // Build two projects (over the Solo cap) while paid...
    for (const name of ['Lapsed A', 'Lapsed B']) {
      await page.getByRole('button', { name: 'New project' }).click();
      await page.getByLabel('Name').fill(name);
      await page.getByRole('button', { name: 'Create project' }).click();
      await expect(page.getByRole('link', { name })).toBeVisible();
    }
    // ...then the subscription lapses → read-only gate everywhere but billing.
    lapseOrg(email);
    await page.goto('/projects');
    await expect(page.getByText('Your workspace is read-only')).toBeVisible();
    await expect(page.getByRole('button', { name: /Resubscribe —/ })).toBeVisible();

    // The billing page itself stays reachable so the admin can resubscribe.
    await page.goto('/settings/billing');
    await expect(page.getByRole('heading', { name: 'Billing' })).toBeVisible();
  });
});

test.describe('Non-admin member', () => {
  test('sees a contact-your-admin empty state on billing', async ({ browser, page, request }) => {
    test.skip(
      !(await mailCaptureEnabled(request)),
      'API not in MAIL_CAPTURE mode — run the API with MAIL_CAPTURE=1',
    );
    const adminEmail = await signUpAndLogin(page, 'na-admin');

    // Invite a member and capture the accept link.
    const member = `e2e+na-member-${Date.now()}@sitelens.test`;
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'Invite user' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email').fill(member);
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog).toBeHidden();
    const link = await emailLinkTo(request, member, /invited/i);

    // Accept as the member in a fresh context → lands logged in.
    const ctx = await browser.newContext({ baseURL: 'http://localhost:3000' });
    const memberPage = await ctx.newPage();
    await memberPage.goto(link);
    await memberPage.getByLabel('Password', { exact: true }).fill('password123');
    await memberPage.getByLabel('Confirm password').fill('password123');
    await memberPage.getByRole('button', { name: 'Join organization' }).click();
    await expect(memberPage).toHaveURL(/\/projects$/);

    // The member's billing page is an empty state pointing them at an admin.
    await memberPage.goto('/settings/billing');
    await expect(memberPage.getByText(/managed by an admin/)).toBeVisible();
    const contact = memberPage.getByRole('link', { name: 'Contact your admin' });
    await expect(contact).toBeVisible();
    // The email may contain regex-special chars (e.g. '+'), so match literally.
    const href = await contact.getAttribute('href');
    expect(href).toContain(`mailto:${adminEmail}`);
    await ctx.close();
  });
});
