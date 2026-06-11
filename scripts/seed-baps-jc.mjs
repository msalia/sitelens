#!/usr/bin/env node
// Seeds a realistic project from a real survey: the BAPS Mandir site. Per the
// survey title block the property is Lot 38, Block 27, Township of North Bergen,
// Hudson County, NJ — 2000 Tonnelle Avenue, North Bergen, NJ 07047 (the drawing
// is titled "BAPS Jersey City Temple" but the land is physically in North
// Bergen). Vertical datum is NAVD 88; the horizontal coords on the plan are a
// local assumed grid (no NAD83/State Plane tie on the sheet), so we georeference
// it with a 2-point Helmert similarity (see the site tie below) mapping two
// control monuments to their real-world positions read off aerial imagery, so
// points land at their true geographic location and terrain renders over the
// actual site.
//
// COURT STEPH and TACO BELL CURB are treated as control points; everything else
// is imported as surveyed points.
//
// Usage (stack must be up — db, redis, api):
//   node scripts/seed-baps-jc.mjs ["/path/to/coordinates.csv"]
//
// Env overrides mirror scripts/seed.mjs (SEED_API_URL / SEED_EMAIL / …).

import { readFileSync } from 'node:fs';

const API = process.env.SEED_API_URL ?? 'http://localhost:4000/graphql';
const EMAIL = process.env.SEED_EMAIL ?? 'demo@sitelens.test';
const PASSWORD = process.env.SEED_PASSWORD ?? 'password123';
const ORG = process.env.SEED_ORG ?? 'Helix Surveying';
const CSV_PATH =
  process.argv[2] ?? '/Users/msalia/Documents/Projects/BAPS JC Surveying Data - Coordinates 2 New.csv';

// --- site tie --------------------------------------------------------------
// The CSV is the surveyor's LOCAL site grid in METERS (an assumed datum — no
// geodetic tie on the sheet). We georeference it to NJ State Plane (EPSG:32111)
// with a 2-point Helmert similarity solved from two control monuments whose
// real-world positions were read off aerial imagery:
//
//   COURT STEPH    local (957.768, 6962.893) ↔ 40.768698, -74.044009
//   TACO BELL CURB local (960.086, 7043.204) ↔ 40.769314, -74.043522
//
// Those lat/lon project (EPSG:32111, GRS80 Transverse Mercator) to the true
// eastings/northings in TIES below — precomputed with the same projection the
// API uses (reproduces it to sub-mm). The similarity comes out to scale ≈ 0.9933
// and rotation ≈ -29.06°, and is applied to every point so the whole site lands
// correctly oriented on the terrain. Two control points fit exactly (no
// residual); a third would add redundancy to validate scale/rotation.
const EPSG = 32111;
const UNIT = 'METER';
// Site origin = true centroid of the two control monuments (the scene's
// reference frame). Rotation is 0 because the projected coords below are already
// true earth.
const SITE_ORIGIN_LAT = 40.769006;
const SITE_ORIGIN_LON = -74.043766;
const CONTROL_CODES = new Set(['COURT STEPH', 'TACO BELL CURB']);
const PROJECT_NAME = 'BAPS Mandir — North Bergen';

// Control ties: local assumed grid (CSV meters) ↔ true projected (EPSG:32111 m).
const TIES = [
  { grid: { e: 957.768, n: 6962.893 }, proj: { e: 188494.902, n: 214963.689 } },
  { grid: { e: 960.086, n: 7043.204 }, proj: { e: 188535.659, n: 215032.303 } },
];

// Solve the 2-point similarity  proj = s·R·local + t  (a = s·cosθ, b = s·sinθ);
// exact for two points. projE/projN then map any local (e, n) to true projected.
const [tieP, tieQ] = TIES;
const _vg = { e: tieQ.grid.e - tieP.grid.e, n: tieQ.grid.n - tieP.grid.n };
const _vp = { e: tieQ.proj.e - tieP.proj.e, n: tieQ.proj.n - tieP.proj.n };
const _den = _vg.e * _vg.e + _vg.n * _vg.n;
const TIE_A = (_vg.e * _vp.e + _vg.n * _vp.n) / _den;
const TIE_B = (_vg.e * _vp.n - _vg.n * _vp.e) / _den;
const TIE_TX = tieP.proj.e - (TIE_A * tieP.grid.e - TIE_B * tieP.grid.n);
const TIE_TY = tieP.proj.n - (TIE_B * tieP.grid.e + TIE_A * tieP.grid.n);

const projE = (localE, localN) => TIE_A * localE - TIE_B * localN + TIE_TX;
const projN = (localE, localN) => TIE_B * localE + TIE_A * localN + TIE_TY;

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

// Extract building-grid axes from the CSV. Each grid line has two endpoint rows
// whose CODE is "LINE <X> / REF <Y>". A numeric <X> is a numbered grid line: its
// endpoints share a NORTHING (a horizontal line). A letter <X> is a lettered grid
// line: its endpoints share an EASTING (a vertical line).
//
// SiteLens draws a LETTERED axis horizontally (position = grid Y / northing) and a
// NUMBERED axis vertically (position = grid X / easting). Since the survey's
// numbered lines are horizontal and lettered lines vertical, we map them by
// GEOMETRY (not by name) so the rendered grid matches the building:
//   numeric label  → LETTERED family, position = northing  (horizontal)
//   letter label   → NUMBERED family, position = easting    (vertical)
function extractGridAxes(rows) {
  const axes = new Map();
  for (const r of rows) {
    const m = r.code.match(/^LINE\s+(\S+)\s*\/\s*REF/i);
    if (!m) {
      continue;
    }
    const label = m[1];
    const numeric = /^\d+$/.test(label);
    const family = numeric ? 'LETTERED' : 'NUMBERED';
    const position = numeric ? r.n : r.e; // local grid feet
    const key = `${family}|${label}`;
    if (!axes.has(key)) {
      axes.set(key, { family, label, position });
    }
  }
  return [...axes.values()];
}

// Parse the source CSV (NAME,EASTING,NORTHING,ELEVATION,CODE).
function parseCsv(text) {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1) // drop header
    .map((line) => {
      const [name, easting, northing, elevation, ...rest] = line.split(',');
      return {
        name: name.trim(),
        e: Number(easting),
        n: Number(northing),
        z: Number(elevation),
        code: rest.join(',').trim(),
      };
    });
  return rows;
}

async function main() {
  console.log(`\nSeeding BAPS JC project via ${API}\n`);
  await ensureSession();

  const rows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  const controls = rows.filter((r) => CONTROL_CODES.has(r.code.toUpperCase()));
  const surveys = rows.filter((r) => !CONTROL_CODES.has(r.code.toUpperCase()));
  const gridAxes = extractGridAxes(rows);
  log(`parsed ${rows.length} points (${controls.length} control, ${surveys.length} survey)`);

  // Clean slate: drop any prior copy of this project so re-runs don't duplicate.
  // Match the "BAPS Mandir" prefix so older names (e.g. the former
  // "— Jersey City") are cleaned up after the North Bergen rename too.
  const existing = await gql(`query{projects{id name}}`);
  for (const p of existing.projects.filter((p) => p.name.startsWith('BAPS Mandir'))) {
    await gql(`mutation($id:UUID!){deleteProject(id:$id)}`, { id: p.id });
    log(`removed existing "${p.name}"`);
  }

  const d = await gql(
    `mutation($name:String!,$description:String,$epsg:Int!,$unit:LengthUnit!,$csf:Float,$lat:Float,$lon:Float,$rot:Float){
       createProject(name:$name,description:$description,epsgCode:$epsg,displayUnit:$unit,combinedScaleFactor:$csf,siteOriginLat:$lat,siteOriginLon:$lon,siteOriginRotationDeg:$rot){id name}
     }`,
    {
      name: PROJECT_NAME,
      description:
        'Plaza and structure control survey for the BAPS Mandir — Lot 38, Block 27, Township of North Bergen, Hudson County, NJ (2000 Tonnelle Avenue). Local site grid (meters) georeferenced to NJ State Plane (EPSG:32111) via a 2-point aerial tie; elevations NAVD 88.',
      epsg: EPSG,
      unit: UNIT,
      csf: 1.0,
      lat: SITE_ORIGIN_LAT,
      lon: SITE_ORIGIN_LON,
      rot: 0,
    },
  );
  const project = d.createProject;
  log(`created project "${project.name}"`);

  // Control points keep their local coords as grid coordinates so the Helmert
  // tie can be solved; projected coords are the real-world NJ State Plane meters.
  for (const c of controls) {
    await gql(
      `mutation($id:UUID!,$label:String!,$n:Float!,$e:Float!,$z:Float,$gx:Float,$gy:Float,$unit:LengthUnit!,$src:String){
         addControlPoint(projectId:$id,label:$label,northing:$n,easting:$e,elevation:$z,gridX:$gx,gridY:$gy,unit:$unit,source:$src){id}
       }`,
      {
        id: project.id,
        label: c.code,
        n: projN(c.e, c.n),
        e: projE(c.e, c.n),
        z: c.z,
        gx: c.e,
        gy: c.n,
        unit: UNIT,
        src: 'site control',
      },
    );
    log(`+ control: ${c.code}`);
  }

  // Best-effort transform tie (2 control points → exact 4-param similarity).
  try {
    const t = await gql(
      `mutation($id:UUID!){solveTransform(projectId:$id){rmsError pointCount}}`,
      { id: project.id },
    );
    log(`solved transform: RMS ${t.solveTransform.rmsError.toFixed(4)} m over ${t.solveTransform.pointCount} points`);
  } catch (err) {
    log(`transform not solved (${err.message})`);
  }

  // Surveyed points → PNEZD CSV in projected feet, imported through the API.
  const csv = ['P,N,E,Z,D']
    .concat(surveys.map((s) => `${s.code},${projN(s.e, s.n).toFixed(3)},${projE(s.e, s.n).toFixed(3)},${s.z.toFixed(3)},Pt ${s.name}`))
    .join('\n');
  const imp = await gql(
    `mutation($id:UUID!,$content:String!,$unit:LengthUnit!,$mapping:CsvMappingInput,$file:String){
       importPoints(projectId:$id,format:CSV,content:$content,unit:$unit,mapping:$mapping,sourceFilename:$file){rowCount}
     }`,
    {
      id: project.id,
      content: csv,
      unit: UNIT,
      mapping: {
        hasHeader: true,
        labelCol: 0,
        northingCol: 1,
        eastingCol: 2,
        elevationCol: 3,
        descriptionCol: 4,
      },
      file: 'baps-jc-coordinates.csv',
    },
  );
  log(`imported ${imp.importPoints.rowCount} survey points`);

  // Building grid — lettered + numbered axes lifted straight from the CSV.
  if (gridAxes.length) {
    await gql(
      `mutation($id:UUID!,$unit:LengthUnit!,$axes:[GridAxisInput!]!){setGridAxes(projectId:$id,unit:$unit,axes:$axes){id}}`,
      { id: project.id, unit: UNIT, axes: gridAxes },
    );
    const lettered = gridAxes.filter((a) => a.family === 'LETTERED').length;
    const numbered = gridAxes.filter((a) => a.family === 'NUMBERED').length;
    log(`set ${gridAxes.length} grid axes (${numbered} vertical / ${lettered} horizontal)`);
  }

  console.log(`\n✅ BAPS JC seed complete. Project: ${project.name}\n`);
}

main().catch((err) => {
  console.error(`\n❌ Seed failed: ${err.message}\n`);
  process.exit(1);
});
