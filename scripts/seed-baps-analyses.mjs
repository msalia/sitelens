#!/usr/bin/env node
// Seeds sample site-analysis records on the BAPS demo project so the Analysis
// tab has data to look at: two computed turning-radius analyses (a clear
// delivery turn and a fire-truck turn that clips a curb → Fail) plus a drawn
// parking draft. Clears existing BAPS analyses first, so it's re-runnable.
//
// Usage (stack must be up — db, redis, api):
//   node scripts/seed-baps-analyses.mjs

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
const log = (m) => console.log(`  ${m}`);

async function main() {
  await gql(`mutation($e:String!,$p:String!){login(email:$e,password:$p){id}}`, {
    e: EMAIL,
    p: PASSWORD,
  });
  const { projects } = await gql(`query{projects{id name}}`);
  const project = projects.find((p) => p.name.startsWith(PROJECT_PREFIX));
  if (!project) {
    throw new Error(`no project starting with "${PROJECT_PREFIX}" — run seed-baps-jc.mjs first`);
  }
  log(`project "${project.name}"`);

  // Clear existing analyses so this is idempotent.
  const { analyses } = await gql(`query($id:UUID!){analyses(projectId:$id){id}}`, { id: project.id });
  for (const a of analyses) {
    await gql(`mutation($id:UUID!){deleteAnalysis(id:$id)}`, { id: a.id });
  }
  if (analyses.length) {
    log(`cleared ${analyses.length} existing analyses`);
  }

  const { vehicleTemplates } = await gql(`{vehicleTemplates{id name}}`);
  const veh = (frag) => vehicleTemplates.find((v) => v.name.includes(frag))?.id;

  // Site is EPSG:32111 meters; the design points cluster near (188548, 214976).
  const run = (name, vehicleTemplateId, path, obstacles = '[]') =>
    gql(
      `mutation($pid:UUID!,$in:TurningInput!){runTurningAnalysis(projectId:$pid,input:$in){id name result}}`,
      { pid: project.id, in: { name, vehicleTemplateId, path, obstacles, stepResolution: 0.5 } },
    );

  // 1) A clear delivery turn (single-unit truck) → Pass.
  const a1 = await run(
    'Delivery turn (SU-30)',
    veh('SU-30'),
    '[[188515,214955],[188560,214955],[188560,214995]]',
  );
  log(`"${a1.runTurningAnalysis.name}" → pass=${JSON.parse(a1.runTurningAnalysis.result).pass}`);

  // 2) A fire-truck turn that clips a curb point on the inside → Fail.
  const a2 = await run(
    'Fire access (WB-62)',
    veh('WB-62'),
    '[[188515,215005],[188560,215005],[188560,215045]]',
    '[[[188558,215012]]]',
  );
  log(`"${a2.runTurningAnalysis.name}" → pass=${JSON.parse(a2.runTurningAnalysis.result).pass}`);

  // 3) A drawn parking-bay draft (no compute yet).
  await gql(
    `mutation($pid:UUID!,$in:AnalysisInput!){createAnalysis(projectId:$pid,input:$in){id}}`,
    {
      pid: project.id,
      in: {
        type: 'PARKING',
        name: 'North lot bays (draft)',
        params: '{}',
        inputGeometry: '[[188500,214940],[188540,214940],[188540,214960],[188500,214960]]',
      },
    },
  );
  log('created parking draft');

  console.log('\nDone. Open the BAPS project → Analysis tab to view.');
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});
