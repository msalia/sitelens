import { expect, test } from '@playwright/test';

import { createProjectAndOpen, signUpAndLogin } from './helpers';

// DOM-level coverage of the 3D viewer controls. We deliberately do NOT assert
// WebGL pixels — only the surrounding chrome (overlays, menus, selectors), which
// is what users actually click.

test('empty project shows the setup prompt and the Display toggles', async ({ page }) => {
  await signUpAndLogin(page, 'scene-empty');
  await createProjectAndOpen(page, 'Scene Empty');

  // No points yet → the viewer overlays a setup prompt.
  await expect(page.getByText('Nothing to show yet')).toBeVisible();

  await page.getByRole('button', { name: 'Display' }).click();
  for (const item of ['Point pins', 'Grid lines', 'Terrain', 'Project onto terrain']) {
    // exact — "Terrain" would otherwise also match "Project onto terrain".
    await expect(page.getByRole('menuitemcheckbox', { exact: true, name: item })).toBeVisible();
  }
});

test('the 3D Categories filter offers a select all / none action', async ({ page }) => {
  await signUpAndLogin(page, 'scene-cats');
  await createProjectAndOpen(page, 'Scene Cats');

  await page.locator('#panel-scene').getByRole('button', { name: 'Categories' }).click();
  await expect(page.getByRole('menuitem', { name: /Select (all|none)/ })).toBeVisible();
});

test('the camera view selector defaults to isometric and terrain can be loaded', async ({
  page,
}) => {
  await signUpAndLogin(page, 'scene-cam');
  await createProjectAndOpen(page, 'Scene Cam');

  const scene = page.locator('#panel-scene');
  await expect(scene.getByText('Isometric')).toBeVisible();
  await expect(scene.getByRole('button', { name: /Load terrain/ })).toBeVisible();
});
