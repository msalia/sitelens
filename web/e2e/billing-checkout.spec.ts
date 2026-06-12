import { expect, type Frame, type Locator, type Page, test } from '@playwright/test';

import { signUpAndLogin } from './helpers';

// Real Stripe Checkout payment path — drives the hosted checkout.stripe.com page
// with a test card and asserts the webhook flips the org to Crew.
//
// OPT-IN: this hits Stripe's network, so it only runs when STRIPE_E2E=1. Before
// running, ensure:
//   1. the stack is up with TEST Stripe keys in .env,
//   2. `stripe listen --forward-to localhost:3000/stripe/webhook` is running
//      with the same STRIPE_WEBHOOK_SECRET the API has.
// Run with:  STRIPE_E2E=1 npx playwright test billing-checkout
test.beforeEach(async ({ request }) => {
  test.skip(!process.env.STRIPE_E2E, 'opt-in: set STRIPE_E2E=1 with the Stripe CLI listening');
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

// Stripe Checkout's payment fields may live on the page or in one of several
// (possibly nested) iframes depending on account/wallet config, so we search
// across all scopes by accessible name / placeholder.
type Scope = Page | Frame;
const scopes = (page: Page): Scope[] => [page, ...page.frames()];

/** Clicks the first matching element across page + frames. */
async function clickAnywhere(page: Page, make: (s: Scope) => Locator): Promise<boolean> {
  for (const s of scopes(page)) {
    const loc = make(s);
    if (await loc.count().catch(() => 0)) {
      await loc.first().click();
      return true;
    }
  }
  return false;
}

/** Fills the first matching field across page + frames. */
async function fillAnywhere(
  page: Page,
  make: (s: Scope) => Locator,
  value: string,
): Promise<boolean> {
  for (const s of scopes(page)) {
    const loc = make(s);
    if (await loc.count().catch(() => 0)) {
      await loc.first().fill(value);
      return true;
    }
  }
  return false;
}

const cardNumber = (s: Scope) =>
  s.getByRole('textbox', { name: /card number/i }).or(s.getByPlaceholder(/1234/));

async function cardFieldsVisible(page: Page): Promise<boolean> {
  for (const s of scopes(page)) {
    if (
      await cardNumber(s)
        .count()
        .catch(() => 0)
    ) {
      return true;
    }
  }
  return false;
}

/** Reveals the "Card" payment form. The Payment Element lists methods (Card /
 *  Cash App Pay / Klarna / Bank); depending on config the card fields are revealed
 *  by the radio, the "Pay with card" button, or the row label. Try each and verify
 *  the card-number field actually appeared. */
async function selectCard(page: Page): Promise<void> {
  const controls = [
    (s: Scope) => s.getByRole('button', { name: /^pay with card$/i }),
    (s: Scope) => s.getByRole('radio', { name: 'Card' }),
    (s: Scope) => s.getByText('Card', { exact: true }),
  ];
  for (const make of controls) {
    if (await cardFieldsVisible(page)) {
      return;
    }
    await clickAnywhere(page, make);
    await page.waitForTimeout(1500);
  }
}

/** Clicks the hosted-checkout submit button (Subscribe / Pay). */
async function submitCheckout(page: Page): Promise<void> {
  const byTestId = page.getByTestId('hosted-payment-submit-button');
  if (await byTestId.count().catch(() => 0)) {
    await byTestId.click();
    return;
  }
  await page
    .getByRole('button', { name: /subscribe|pay/i })
    .first()
    .click();
}

/** Reloads the billing page until the plan title shows `plan`, absorbing webhook
 *  delivery lag. Each load waits for the billing query to resolve before deciding
 *  (a bare reload loop would cancel the in-flight query and never settle). */
async function waitForPlan(page: Page, plan: 'Crew' | 'Solo', timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.goto('/settings/billing');
    try {
      await expect(page.getByText(plan).first()).toBeVisible({ timeout: 10_000 });
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`billing plan did not become ${plan} within ${timeoutMs}ms`);
      }
    }
  }
}

test('admin upgrades via hosted Checkout and the org becomes Crew', async ({ page }) => {
  await signUpAndLogin(page, 'checkout');

  await page.goto('/settings/billing');
  await expect(page.getByText('Solo').first()).toBeVisible();

  // Kick off hosted Checkout (monthly).
  await page.getByRole('button', { name: /Upgrade —/ }).click();
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });

  // Select Card, then fill the Stripe test card once the fields appear.
  await selectCard(page);
  await expect
    .poll(() => fillAnywhere(page, cardNumber, '4242 4242 4242 4242'), { timeout: 30_000 })
    .toBe(true);
  await fillAnywhere(
    page,
    (s) => s.getByRole('textbox', { name: /expir/i }).or(s.getByPlaceholder(/MM \/ YY/)),
    '12 / 34',
  );
  await fillAnywhere(
    page,
    (s) => s.getByRole('textbox', { name: /cvc|security/i }).or(s.getByPlaceholder(/CVC/)),
    '123',
  );
  await fillAnywhere(page, (s) => s.getByPlaceholder(/ZIP|postal/i), '94107');
  await fillAnywhere(
    page,
    (s) => s.getByPlaceholder(/full name on card|name on card/i),
    'E2E Tester',
  );

  await submitCheckout(page);

  // Back to the app on success, then the webhook flips the org to Crew.
  await page.waitForURL(/\/settings\/billing\?checkout=success/, { timeout: 60_000 });
  await waitForPlan(page, 'Crew');

  await expect(page.getByText('Paid plan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage billing' })).toBeVisible();
});
