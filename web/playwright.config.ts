import { defineConfig } from '@playwright/test';

// E2E tests live in this project under ./e2e — never in any external/shared dir.
export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: 'list',
  retries: 0,
  testDir: './e2e',
  timeout: 30_000,
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
