// Copies CesiumJS static assets (Workers, Assets, Widgets, ThirdParty) into
// public/cesium so they're served at /cesium (CESIUM_BASE_URL). Run before
// dev/build. public/cesium is gitignored — it's a build artifact.
import { cpSync, existsSync, rmSync } from 'node:fs';

const src = 'node_modules/cesium/Build/Cesium';
const dst = 'public/cesium';

if (!existsSync(src)) {
  console.error(`Cesium build assets not found at ${src} — is the cesium package installed?`);
  process.exit(1);
}
if (existsSync(dst)) {
  rmSync(dst, { force: true, recursive: true });
}
cpSync(src, dst, { recursive: true });
console.log(`Copied Cesium assets → ${dst}`);
