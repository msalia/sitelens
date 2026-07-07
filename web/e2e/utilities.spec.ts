import { expect, test } from '@playwright/test';

import { chooseSelect, createProjectAndOpen, gotoTab, signUpAndLogin, upgradeOrg } from './helpers';

// Utility Records (P2): digitize a run + place a structure via the Utilities
// panel, and the Solo-plan gate. Needs the full stack (skips if API is down).
test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/graphql', { data: { query: '{ __typename }' } });
  test.skip(!res.ok(), 'API not reachable — start the full stack to run this test');
});

test('digitize a run and place a structure → they appear in the inventory', async ({ page }) => {
  const email = await signUpAndLogin(page, 'util-digitize');
  upgradeOrg(email); // Utilities is a Crew feature
  await createProjectAndOpen(page, 'Utility Digitize');

  await gotoTab(page, 'Utilities');

  // --- Run: pick a type, add two vertices by coordinate, then save. ---
  await chooseSelect(page, 'ut-type', 'Storm Sewer');
  await page.getByRole('button', { name: 'New run' }).click();

  // Vertex 1
  await page.getByLabel('Easting').fill('200');
  await page.getByLabel('Northing').fill('100');
  await page.getByLabel('Elevation').fill('5');
  await page.getByRole('button', { exact: true, name: 'Add' }).click();
  // Vertex 2
  await page.getByLabel('Easting').fill('230');
  await page.getByLabel('Northing').fill('140');
  await page.getByLabel('Elevation').fill('4.5');
  await page.getByRole('button', { exact: true, name: 'Add' }).click();

  await page.getByLabel('Label').fill('Storm line A');
  await page.getByLabel('Diameter (in)').fill('12');
  await page.getByRole('button', { name: 'Save run' }).click();

  // The run shows up in the inventory.
  await expect(page.getByText('Storm line A')).toBeVisible();

  // --- Structure: pick a structure type, set a position, then save. ---
  await chooseSelect(page, 'ut-type', 'Catch Basin');
  await page.getByRole('button', { name: 'New structure' }).click();
  await page.getByLabel('Easting').fill('215');
  await page.getByLabel('Northing').fill('120');
  await page.getByRole('button', { exact: true, name: 'Set' }).click();
  await page.getByLabel('Label').fill('CB-1');
  await page.getByRole('button', { name: 'Save structure' }).click();

  await expect(page.getByText('CB-1')).toBeVisible();

  // Delete the structure → it leaves the inventory.
  await page.getByRole('button', { name: 'Delete CB-1' }).click();
  await page.getByRole('button', { exact: true, name: 'Delete' }).click();
  await expect(page.getByText('CB-1')).toHaveCount(0);
});

test('import GeoJSON → map layer → commit → appears in inventory', async ({ page }) => {
  const email = await signUpAndLogin(page, 'util-import');
  upgradeOrg(email);
  await createProjectAndOpen(page, 'Utility Import');

  await gotoTab(page, 'Utilities');
  await page.getByRole('button', { exact: true, name: 'Import' }).click();

  // Upload a projected-meter GeoJSON with a WATER line.
  const geojson = JSON.stringify({
    features: [
      {
        geometry: { coordinates: [[0, 0], [3, 4]], type: 'LineString' },
        properties: { layer: 'WATER', name: 'WL-1' },
        type: 'Feature',
      },
    ],
    type: 'FeatureCollection',
  });
  await page.locator('#ut-import-file').setInputFiles({
    buffer: Buffer.from(geojson),
    mimeType: 'application/geo+json',
    name: 'utils.geojson',
  });

  // Interpret coords as projected meters (deterministic, no reprojection).
  await chooseSelect(page, 'ut-import-space', 'Projected easting / northing');
  await chooseSelect(page, 'ut-import-unit', 'Meter');
  // WATER auto-maps to Water; commit inside the dialog.
  await expect(page.getByRole('combobox', { name: 'Map WATER' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { exact: true, name: 'Import' }).click();

  // The imported run shows in the inventory.
  await expect(page.getByText('WL-1')).toBeVisible();
});

test('Solo plan sees the Utilities upgrade gate', async ({ page }) => {
  await signUpAndLogin(page, 'util-gate'); // not upgraded → Solo
  await createProjectAndOpen(page, 'Utility Gate');
  await page.getByRole('button', { exact: true, name: 'Utilities' }).click();
  // Instead of the panel, the Crew upsell dialog appears.
  await expect(page.getByRole('dialog')).toContainText('Crew');
});
