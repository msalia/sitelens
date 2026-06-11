import { expect, test } from '@playwright/test';

import { createProjectAndOpen, signUpAndLogin } from './helpers';

// Phase 6: the open 3D scene subscribes to projectChanged and refetches live when
// the project changes — no manual reload. Best-effort: we assert the scene query
// re-runs (the canvas itself isn't DOM-introspectable).
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('the 3D scene refetches live when the project changes (no reload)', async ({ page }) => {
  await signUpAndLogin(page, 'live');
  await createProjectAndOpen(page, 'Live Site');
  const projectId = page.url().match(/\/projects\/([0-9a-f-]+)/)?.[1];
  expect(projectId).toBeTruthy();

  // Give the scene's WebSocket subscription time to connect + subscribe.
  await page.waitForTimeout(1500);

  // Arm a wait for the live scene refetch (a Scene query for `sceneData`).
  const refetch = page.waitForRequest(
    (req) => req.url().includes('/api/graphql') && (req.postData() ?? '').includes('sceneData'),
    { timeout: 10_000 },
  );

  // Change the project via the API (same session) → publishes projectChanged.
  const resp = await page.request.post('/api/graphql', {
    data: {
      query: `mutation { addControlPoint(projectId: "${projectId}", label: "LIVE", northing: 1, easting: 2, unit: METER) { id } }`,
    },
  });
  expect(resp.ok()).toBeTruthy();

  // The open scene received the ping and refetched — with no navigation.
  await refetch;
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
});
