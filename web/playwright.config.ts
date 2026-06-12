import { defineConfig } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Load the stack's root .env so opt-in flags (e.g. STRIPE_E2E for the live
// Checkout spec) can be toggled from one place. `override: false` keeps any value
// already set in the shell.
loadEnv({ override: false, path: path.resolve(process.cwd(), '..', '.env') });

// E2E tests live in this project under ./e2e — never in any external/shared dir.
export default defineConfig({
  // Dev-server e2e: the first navigation to a route can pay a lazy compile cost,
  // and workspace pages open live WebSocket subscriptions + a 3D scene, so keep
  // generous waits to avoid timing flakes. One retry absorbs the occasional
  // first-compile / contention blip.
  expect: { timeout: 10_000 },
  fullyParallel: false,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: 'list',
  retries: 1,
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    url: 'http://localhost:3000',
  },
});
