#!/usr/bin/env node
// Seeds surface-modeling sample data (Phases 1–4) onto the existing BAPS Mandir
// demo project so the Surfaces tab UI has something to visualize: an auto-boundary
// clipped TIN surface, plus a cut-to-pad volume (which renders the cut/fill
// heatmap). Contours are computed on demand in the UI, so they need no seeding.
//
// Idempotent: skips a surface / volume whose name already exists.
//
// Usage (stack must be up — db, redis, api):
//   node scripts/seed-baps-surfaces.mjs
//
// Env overrides mirror the other seed scripts (SEED_API_URL / SEED_EMAIL / …).

const API = process.env.SEED_API_URL ?? 'http://localhost:4000/graphql';
const EMAIL = process.env.SEED_EMAIL ?? 'demo@sitelens.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'password123';
const PROJECT_PREFIX = process.env.SEED_PROJECT ?? 'BAPS Mandir';

let cookie = '';

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    cookie = setCookie.split(';')[0];
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join('; '));
  }
  return json.data;
}

const log = (msg) => console.log(`  ${msg}`);

async function main() {
  await gql(`mutation($e:String!,$p:String!){login(email:$e,password:$p){id}}`, {
    e: EMAIL,
    p: PASSWORD,
  });

  const { projects } = await gql(`query{projects{id name}}`);
  const project = projects.find((p) => p.name.startsWith(PROJECT_PREFIX));
  if (!project) {
    throw new Error(
      `no project starting with "${PROJECT_PREFIX}" — run scripts/seed-baps-jc.mjs first`,
    );
  }
  log(`project "${project.name}" (${project.id})`);

  // --- Boundary + surface -------------------------------------------------
  const { breaklines } = await gql(`query($id:UUID!){breaklines(projectId:$id){id kind}}`, {
    id: project.id,
  });
  let boundaryId = breaklines.find((b) => b.kind === 'BOUNDARY')?.id ?? null;
  if (!boundaryId) {
    const d = await gql(
      `mutation($id:UUID!){autoBoundary(projectId:$id,scope:ALL){id kind}}`,
      { id: project.id },
    );
    boundaryId = d.autoBoundary.id;
    log('generated an auto concave-hull boundary');
  } else {
    log('boundary already present');
  }

  const { surfaces } = await gql(`query($id:UUID!){surfaces(projectId:$id){id name}}`, {
    id: project.id,
  });
  const SURFACE_NAME = 'Existing Grade';
  let surfaceId = surfaces.find((s) => s.name === SURFACE_NAME)?.id ?? null;
  if (!surfaceId) {
    const d = await gql(
      `mutation($id:UUID!,$in:SurfaceInput!){buildSurface(projectId:$id,input:$in){id triangleCount vertexCount}}`,
      {
        id: project.id,
        in: {
          name: SURFACE_NAME,
          scope: 'ALL',
          boundaryId,
          // Drop long slivers from the concave hull's edges for a cleaner TIN.
          maxEdgeLength: 40,
        },
      },
    );
    surfaceId = d.buildSurface.id;
    log(`built surface "${SURFACE_NAME}" — ${d.buildSurface.triangleCount} triangles`);
  } else {
    log(`surface "${SURFACE_NAME}" already present`);
  }

  // --- Volume (cut/fill to a pad elevation) -------------------------------
  // A pad set mid-surface produces a mix of cut (mound) and fill (low corners),
  // so the heatmap shows both colors. Reference is in meters (canonical).
  const { volumes } = await gql(`query($id:UUID!){volumes(projectId:$id){id name}}`, {
    id: project.id,
  });
  const VOLUME_NAME = 'Balance to pad';
  if (!volumes.some((v) => v.name === VOLUME_NAME)) {
    const d = await gql(
      `mutation($id:UUID!,$in:VolumeInput!){computeVolume(projectId:$id,input:$in){id cutVolume fillVolume netVolume area}}`,
      {
        id: project.id,
        in: {
          name: VOLUME_NAME,
          comparison: 'SURFACE_TO_ELEVATION',
          baseSurfaceId: surfaceId,
          referenceElev: 11.5, // meters — a pad mid-surface (grades run ~9.4–13.8)
          cellSize: 2.0,
        },
      },
    );
    const v = d.computeVolume;
    log(
      `computed "${VOLUME_NAME}" — cut ${v.cutVolume.toFixed(0)} m³ / fill ${v.fillVolume.toFixed(0)} m³ over ${v.area.toFixed(0)} m²`,
    );
  } else {
    log(`volume "${VOLUME_NAME}" already present`);
  }

  console.log('\nDone. Open the BAPS project → Surfaces tab to view + iterate.');
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
