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

  // The scene opens a graphql-ws subscription to `projectChanged`. A fixed sleep
  // to "let it connect" races the mutation below: if the ping is published before
  // the client has subscribed, the refetch never fires and the test flakes. So
  // retry the trigger until we observe a live `sceneData` refetch — this succeeds
  // the moment the subscription is live, however long the socket takes to come up.
  await expect(async () => {
    // Arm the wait for the live refetch (a Scene query for `sceneData`) *before*
    // publishing the change, so a fast refetch can't slip past us.
    const refetch = page.waitForRequest(
      (req) => req.url().includes('/api/graphql') && (req.postData() ?? '').includes('sceneData'),
      { timeout: 2_000 },
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
  }).toPass({ timeout: 20_000 });

  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
});
