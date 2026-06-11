#!/usr/bin/env node
/**
 * One-time bake of the login-page 3D showcase: downloads terrain (OpenTopography
 * DEM, GeoTIFF) + buildings (OSM Overpass) for a handful of iconic places and
 * writes them to web/public/showcase/<id>/ so they ship with the build (served
 * statically, no auth, no runtime API calls).
 *
 *   OPENTOPO_API_KEY=... node scripts/fetch-showcase.mjs
 *
 * Re-run to refresh. Buildings JSON matches the app's BuildingFootprint shape
 * ([{ poly: [[lat,lon],...], height }]); terrain.tif is a raw GeoTIFF the client
 * meshes with buildTerrainGeometry.
 */
import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Node's global fetch (undici) fails in some sandboxes where curl works, so we
// shell out to curl for the two downloads.
const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'showcase');

// bbox = [south, north, west, east]; center is the bbox midpoint.
const PLACES = [
  { bbox: [22.274, 22.288, 114.15, 114.166], id: 'hong-kong', label: 'Hong Kong' },
  { bbox: [37.788, 37.802, -122.41, -122.394], id: 'sf', label: 'San Francisco' },
  { bbox: [47.6, 47.614, -122.345, -122.325], id: 'seattle', label: 'Seattle' },
  { bbox: [43.638, 43.652, -79.395, -79.377], id: 'toronto', label: 'Toronto' },
  // Lower Manhattan — includes One World Trade Center.
  { bbox: [40.706, 40.72, -74.018, -74.004], id: 'nyc', label: 'New York' },
];

const DEMTYPE = 'SRTMGL1'; // 30 m global DEM (covers all five)
// Overpass rejects a missing User-Agent with 406; try the primary then mirrors.
const UA = 'SiteLens/1.0 (+https://sitelens.msalia.org)';
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** Best-effort building height (m) from OSM tags — mirrors api `building_height`. */
function buildingHeight(tags = {}) {
  const h = tags.height;
  if (typeof h === 'string') {
    const n = parseFloat(h.split(/\s+/)[0]);
    if (n > 0) {
      return n;
    }
  }
  const lv = tags['building:levels'];
  if (typeof lv === 'string') {
    const n = parseFloat(lv.trim());
    if (!Number.isNaN(n)) {
      return Math.max(n * 3, 2);
    }
  }
  return 6;
}

async function fetchTerrain([south, north, west, east], key, outPath) {
  const url =
    `https://portal.opentopography.org/API/globaldem?demtype=${DEMTYPE}` +
    `&south=${south}&north=${north}&west=${west}&east=${east}` +
    `&outputFormat=GTiff&API_Key=${key}`;
  await run('curl', ['-sS', '--fail', '-m', '180', '-o', outPath, url]);
}

async function fetchBuildings([south, north, west, east]) {
  const q = `[out:json][timeout:90];(way["building"](${south},${west},${north},${east}););out geom tags;`;
  let stdout;
  let lastErr;
  for (const url of OVERPASS_MIRRORS) {
    try {
      ({ stdout } = await run(
        'curl',
        [
          '-sS',
          '--fail',
          '-m',
          '180',
          '-A',
          UA,
          '-X',
          'POST',
          '--data-urlencode',
          `data=${q}`,
          url,
        ],
        { maxBuffer: 128 * 1024 * 1024 },
      ));
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (stdout === undefined) {
    throw lastErr ?? new Error('all Overpass mirrors failed');
  }
  const data = JSON.parse(stdout);
  const out = [];
  for (const el of data.elements ?? []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) {
      continue;
    }
    const poly = el.geometry.map((g) => [g.lat, g.lon]);
    if (poly.length < 3) {
      continue;
    }
    out.push({ height: buildingHeight(el.tags), poly });
  }
  return out;
}

async function main() {
  const key = process.env.OPENTOPO_API_KEY;
  if (!key) throw new Error('OPENTOPO_API_KEY is required');
  const manifest = [];
  for (const place of PLACES) {
    const [south, north, west, east] = place.bbox;
    const lat = (south + north) / 2;
    const lon = (west + east) / 2;
    process.stdout.write(`• ${place.label} … `);
    const dir = join(OUT, place.id);
    await mkdir(dir, { recursive: true });
    const tifPath = join(dir, 'terrain.tif');
    await fetchTerrain(place.bbox, key, tifPath);
    const buildings = await fetchBuildings(place.bbox);
    await writeFile(join(dir, 'buildings.json'), JSON.stringify(buildings));
    const { size } = await stat(tifPath);
    console.log(`terrain ${(size / 1024).toFixed(0)} KB · ${buildings.length} buildings`);
    manifest.push({ id: place.id, label: place.label, lat, lon });
  }
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`\nWrote ${manifest.length} places to public/showcase/`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
