#!/usr/bin/env node
// SiteLens dev seed — populates a demo org with varied, realistic data so the UI
// can be exercised across every state (rich project, dense/large project, a
// meter-unit project, and a deliberately empty one for empty-states).
//
// It drives the real GraphQL API (not raw SQL) so password hashing, email
// verification, the Helmert solve, and unit conversion all run for real.
//
// Usage (stack must be up — db, redis, api):
//   node scripts/seed.mjs
//
// Env overrides:
//   SEED_API_URL   GraphQL endpoint (default http://localhost:4000/graphql)
//   SEED_EMAIL     demo login email   (default demo@sitelens.test)
//   SEED_PASSWORD  demo password      (default password123)
//   SEED_ORG       org name           (default Helix Surveying)
//   SEED_RICH      points in the rich project   (default 120)
//   SEED_BIG       points in the large project  (default 800)
//   SEED_MED       points in the meter project  (default 60)
//
// Re-running against a non-fresh DB will duplicate projects (no uniqueness on
// names). For a clean slate, recreate the db volume first.

const API = process.env.SEED_API_URL ?? 'http://localhost:4000/graphql';
const EMAIL = process.env.SEED_EMAIL ?? 'demo@sitelens.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'password123';
const ORG = process.env.SEED_ORG ?? 'Helix Surveying';
const RICH = Number(process.env.SEED_RICH ?? 120);
const BIG = Number(process.env.SEED_BIG ?? 800);
const MED = Number(process.env.SEED_MED ?? 60);

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

// --- coordinate helpers ----------------------------------------------------

// Project a building-grid (x, y) into projected (E, N) via a similarity
// transform — used to generate control points that solve to a clean tie.
function project(gx, gy, { e0, n0, thetaDeg, scale }) {
  const t = (thetaDeg * Math.PI) / 180;
  return {
    easting: e0 + scale * (gx * Math.cos(t) - gy * Math.sin(t)),
    northing: n0 + scale * (gx * Math.sin(t) + gy * Math.cos(t)),
  };
}

// Deterministic PNEZD CSV (header + rows) scattered around a projected origin.
function genCsv(n, { e0, n0, z0 = 100, spreadE = 400, spreadN = 300, prefix = 'PT', desc = 'survey' }) {
  const lines = ['P,N,E,Z,D'];
  for (let i = 0; i < n; i++) {
    const north = (n0 + ((i * 7) % spreadN) + (i % 11) * 0.137).toFixed(3);
    const east = (e0 + ((i * 13) % spreadE) + (i % 13) * 0.091).toFixed(3);
    const z = (z0 + (i % 15) + (i % 3) * 0.25).toFixed(2);
    lines.push(`${prefix}${String(i + 1).padStart(4, '0')},${north},${east},${z},${desc} ${i + 1}`);
  }
  return lines.join('\n');
}

// --- GraphQL operations ----------------------------------------------------

async function ensureSession() {
  try {
    const d = await gql(
      `mutation($e:String!,$p:String!,$o:String!){signup(email:$e,password:$p,orgName:$o){verificationToken}}`,
      { e: EMAIL, p: PASSWORD, o: ORG },
    );
    await gql(`mutation($t:String!){verifyEmail(token:$t)}`, { t: d.signup.verificationToken });
    log(`created org "${ORG}" (${EMAIL})`);
  } catch (err) {
    if (/taken|exist|registered/i.test(String(err.message))) {
      log(`org already exists — logging in as ${EMAIL}`);
    } else {
      throw err;
    }
  }
  await gql(`mutation($e:String!,$p:String!){login(email:$e,password:$p){id}}`, {
    e: EMAIL,
    p: PASSWORD,
  });
}

async function createProject(input) {
  const d = await gql(
    `mutation($name:String!,$description:String,$epsg:Int!,$unit:LengthUnit!,$csf:Float,$lat:Float,$lon:Float){
       createProject(name:$name,description:$description,epsgCode:$epsg,displayUnit:$unit,combinedScaleFactor:$csf,siteOriginLat:$lat,siteOriginLon:$lon){id name}
     }`,
    input,
  );
  return d.createProject;
}

async function setGrid(projectId, unit) {
  const axes = [
    ...['A', 'B', 'C', 'D'].map((label, i) => ({ family: 'LETTERED', label, position: i * 100 })),
    ...['1', '2', '3', '4'].map((label, i) => ({ family: 'NUMBERED', label, position: i * 100 })),
  ];
  await gql(
    `mutation($id:UUID!,$unit:LengthUnit!,$axes:[GridAxisInput!]!){setGridAxes(projectId:$id,unit:$unit,axes:$axes){id}}`,
    { id: projectId, unit, axes },
  );
}

async function addControl(projectId, label, gx, gy, tf, unit) {
  const { easting, northing } = project(gx, gy, tf);
  await gql(
    `mutation($id:UUID!,$label:String!,$n:Float!,$e:Float!,$z:Float,$gx:Float,$gy:Float,$unit:LengthUnit!,$src:String){
       addControlPoint(projectId:$id,label:$label,northing:$n,easting:$e,elevation:$z,gridX:$gx,gridY:$gy,unit:$unit,source:$src){id}
     }`,
    { id: projectId, label, n: northing, e: easting, z: 100, gx, gy, unit, src: 'city control' },
  );
}

async function solve(projectId) {
  const d = await gql(`mutation($id:UUID!){solveTransform(projectId:$id){rmsError pointCount}}`, {
    id: projectId,
  });
  return d.solveTransform;
}

async function createCategory(name, color, icon) {
  const d = await gql(
    `mutation($n:String!,$c:String!,$i:String!){createCategory(name:$n,color:$c,icon:$i){id name}}`,
    { n: name, c: color, i: icon },
  );
  return d.createCategory;
}

async function importPoints(projectId, content, unit, opts = {}) {
  const mapping = {
    hasHeader: true,
    labelCol: 0,
    northingCol: 1,
    eastingCol: 2,
    elevationCol: 3,
    descriptionCol: 4,
  };
  const d = await gql(
    `mutation($id:UUID!,$content:String!,$unit:LengthUnit!,$mapping:CsvMappingInput,$file:String,$cat:UUID,$profile:String){
       importPoints(projectId:$id,format:CSV,content:$content,unit:$unit,mapping:$mapping,sourceFilename:$file,categoryId:$cat,saveProfileName:$profile){rowCount}
     }`,
    {
      id: projectId,
      content,
      unit,
      mapping,
      file: opts.file ?? 'seed.csv',
      cat: opts.categoryId ?? null,
      profile: opts.profile ?? null,
    },
  );
  return d.importPoints.rowCount;
}

async function makeGroup(projectId, name, memberIds) {
  await gql(
    `mutation($id:UUID!,$name:String!,$ids:[UUID!]!){createPointGroup(projectId:$id,name:$name,memberIds:$ids){id}}`,
    { id: projectId, name, ids: memberIds },
  );
}

async function pointIds(projectId, limit) {
  const d = await gql(`query($id:UUID!,$l:Int){surveyPoints(projectId:$id,limit:$l){id}}`, {
    id: projectId,
    l: limit,
  });
  return d.surveyPoints.map((p) => p.id);
}

// --- main ------------------------------------------------------------------

async function main() {
  console.log(`\nSeeding SiteLens via ${API}\n`);
  await ensureSession();

  // Custom categories (in addition to the per-org defaults).
  console.log('\nCategories:');
  const cats = {};
  for (const [name, color, icon] of [
    ['Monument', '#ef4444', 'map-pin'],
    ['Iron Pin', '#3b82f6', 'pin'],
    ['Benchmark', '#22c55e', 'triangle'],
  ]) {
    cats[name] = await createCategory(name, color, icon);
    log(`+ ${name}`);
  }

  // 1) Rich, fully-tied project in US survey feet.
  console.log('\nProject: Downtown Tower (rich, US survey ft):');
  const tower = await createProject({
    name: 'Downtown Tower',
    description: 'Mixed-use high-rise — full grid tie, control, and a categorized point cloud.',
    epsg: 2229,
    unit: 'US_SURVEY_FOOT',
    csf: 0.99996,
    lat: 34.0522,
    lon: -118.2437,
  });
  const towerTf = { e0: 6_480_000, n0: 1_820_000, thetaDeg: 22.5, scale: 1.0 };
  await setGrid(tower.id, 'US_SURVEY_FOOT');
  log('grid axes A–D / 1–4 set');
  for (const [label, gx, gy] of [
    ['NW', 0, 300],
    ['NE', 400, 300],
    ['SE', 400, 0],
    ['SW', 0, 0],
  ]) {
    await addControl(tower.id, label, gx, gy, towerTf, 'US_SURVEY_FOOT');
  }
  log('4 control points added');
  const tied = await solve(tower.id);
  log(`solved transform: RMS ${tied.rmsError.toFixed(4)} ft over ${tied.pointCount} points`);
  // Distribute the point cloud across categories; first import saves a profile.
  const towerSplit = [
    ['Monument', Math.round(RICH * 0.42), 'Total Station Export'],
    ['Iron Pin', Math.round(RICH * 0.33), null],
    ['Benchmark', RICH - Math.round(RICH * 0.42) - Math.round(RICH * 0.33), null],
  ];
  let cursor = 0;
  for (const [catName, count, profile] of towerSplit) {
    const csv = genCsv(count, {
      e0: 6_480_010 + cursor,
      n0: 1_820_010,
      prefix: catName.slice(0, 2).toUpperCase(),
      desc: catName,
    });
    const rows = await importPoints(tower.id, csv, 'US_SURVEY_FOOT', {
      categoryId: cats[catName].id,
      profile,
      file: `${catName.toLowerCase().replace(' ', '-')}.csv`,
    });
    log(`imported ${rows} ${catName} points${profile ? ` (saved profile "${profile}")` : ''}`);
    cursor += 50;
  }
  // Saved groups from the first points.
  const ids = await pointIds(tower.id, 40);
  await makeGroup(tower.id, 'North Wing', ids.slice(0, 12));
  await makeGroup(tower.id, 'Stair Cores', ids.slice(12, 24));
  log('2 point groups saved');

  // 2) Large/dense project to exercise clustering + pagination.
  console.log('\nProject: Riverside Bridge (large/dense):');
  const bridge = await createProject({
    name: 'Riverside Bridge',
    description: `Corridor survey with ${BIG} points — stress-tests clustering and paging.`,
    epsg: 2229,
    unit: 'US_SURVEY_FOOT',
    csf: 0.99994,
    lat: 34.07,
    lon: -118.22,
  });
  const bridgeTf = { e0: 6_500_000, n0: 1_840_000, thetaDeg: 0, scale: 1.0 };
  await setGrid(bridge.id, 'US_SURVEY_FOOT');
  for (const [label, gx, gy] of [
    ['BR-A', 0, 0],
    ['BR-B', 1200, 0],
    ['BR-C', 1200, 80],
  ]) {
    await addControl(bridge.id, label, gx, gy, bridgeTf, 'US_SURVEY_FOOT');
  }
  const bSolve = await solve(bridge.id);
  log(`solved transform: RMS ${bSolve.rmsError.toFixed(4)} ft`);
  const bigCsv = genCsv(BIG, {
    e0: 6_500_010,
    n0: 1_840_010,
    spreadE: 1200,
    spreadN: 80,
    prefix: 'BR',
    desc: 'deck shot',
  });
  log(`imported ${await importPoints(bridge.id, bigCsv, 'US_SURVEY_FOOT', { file: 'corridor.csv' })} points`);

  // 3) Meter-unit project — exercises the metric display path.
  console.log('\nProject: Harbor Levee (meters):');
  const harbor = await createProject({
    name: 'Harbor Levee',
    description: 'Coastal levee survey recorded in meters.',
    epsg: 2229,
    unit: 'METER',
    csf: 1.0,
    lat: 33.74,
    lon: -118.27,
  });
  const harborTf = { e0: 1_975_000, n0: 555_000, thetaDeg: 10, scale: 1.0 };
  await setGrid(harbor.id, 'METER');
  for (const [label, gx, gy] of [
    ['H1', 0, 0],
    ['H2', 150, 0],
    ['H3', 150, 90],
  ]) {
    await addControl(harbor.id, label, gx, gy, harborTf, 'METER');
  }
  await solve(harbor.id);
  const medCsv = genCsv(MED, {
    e0: 1_975_010,
    n0: 555_010,
    spreadE: 150,
    spreadN: 90,
    z0: 3,
    prefix: 'HL',
    desc: 'levee crest',
  });
  log(`imported ${await importPoints(harbor.id, medCsv, 'METER', { file: 'levee.csv' })} points`);

  // 4) Empty project for empty-state / setup-checklist UX.
  console.log('\nProject: Vacant Parcel (empty):');
  await createProject({
    name: 'Vacant Parcel',
    description: 'Brand-new project — nothing configured yet (tests empty states).',
    epsg: 2229,
    unit: 'US_SURVEY_FOOT',
    csf: 1.0,
    lat: 34.05,
    lon: -118.25,
  });
  log('created (no grid / control / points)');

  console.log(`\n✅ Seed complete. Log in at /login with ${EMAIL} / ${PASSWORD}\n`);
}

main().catch((err) => {
  console.error(`\n❌ Seed failed: ${err.message}\n`);
  process.exit(1);
});
