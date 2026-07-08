// Migration: DynamoDB → PostgreSQL
// Run: node scripts/migrate-dynamo-to-pg.js
require('dotenv').config();
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

// ── Clients ───────────────────────────────────────────────────────────────────
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
}));

const pg = new Pool({
  host:     process.env.PG_HOST,
  port:     Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE,
  user:     process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl:      { rejectUnauthorized: false, minVersion: 'TLSv1.2' },
  max: 5,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function scanAll(tableName) {
  const items = [];
  let lastKey;
  do {
    const res = await dynamo.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: lastKey }));
    items.push(...(res.Items || []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// Strip "{projectId}#" compound key prefix used in DynamoDB
const stripPrefix = (val) => {
  if (!val) return val;
  const i = String(val).indexOf('#');
  return i !== -1 ? String(val).slice(i + 1) : String(val);
};

// Return YYYY-MM-DD or null
const toDate = (val) => {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

let skipped = 0;
function warn(msg) { console.warn('  WARN:', msg); skipped++; }

// ── Main migration ────────────────────────────────────────────────────────────
async function migrate() {
  console.log('Starting DynamoDB → PostgreSQL migration\n');

  // ── 1. Companies ───────────────────────────────────────────────────────────
  process.stdout.write('Companies... ');
  const companies = await scanAll('Companies');
  for (const c of companies) {
    if (!c.id) { warn(`Company missing id: ${JSON.stringify(c)}`); continue; }
    await pg.query(
      `INSERT INTO companies (id, name, active, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name || 'Unknown', c.active !== false, c.created_at || new Date().toISOString()]
    );
  }
  console.log(`${companies.length} done`);

  // ── 2. Projects ────────────────────────────────────────────────────────────
  process.stdout.write('Projects... ');
  const projects = await scanAll('Projects');
  const validProjectIds = new Set();
  for (const p of projects) {
    if (!p.id || !p.company_id) { warn(`Project missing id/company_id: ${p.id}`); continue; }
    await pg.query(
      `INSERT INTO projects (id, company_id, name, description, active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.company_id, p.name || 'Unknown', p.description || '', p.active !== false, p.created_at || new Date().toISOString()]
    );
    validProjectIds.add(p.id);
  }
  console.log(`${projects.length} done`);

  // ── 3. Users + project_members ────────────────────────────────────────────
  process.stdout.write('Users... ');
  const users = await scanAll('Users');
  let pmCount = 0;
  for (const u of users) {
    if (!u.email) { warn('User missing email'); continue; }
    const pwHash = u.password_hash || u.password || '$2b$10$placeholder.hash.for.migrated.user';
    await pg.query(
      `INSERT INTO users (email, password_hash, name, company_id, company_role, active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (email) DO NOTHING`,
      [u.email, pwHash, u.name || null, u.company_id || null, u.company_role || null,
       u.active !== false, u.created_at || new Date().toISOString()]
    );
    for (const pm of (u.project_memberships || [])) {
      if (!pm.project_id || !validProjectIds.has(pm.project_id)) continue;
      await pg.query(
        `INSERT INTO project_members (id, project_id, user_email, role)
         VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, user_email) DO NOTHING`,
        [randomUUID(), pm.project_id, u.email, pm.role || 'ReadOnly']
      );
      pmCount++;
    }
  }
  console.log(`${users.length} users, ${pmCount} project memberships done`);

  // ── 4. Team members ────────────────────────────────────────────────────────
  process.stdout.write('Team members... ');
  const team = await scanAll('Team');
  let tmCount = 0;
  for (const t of team) {
    if (!t.project_id) { warn('Team record missing project_id'); continue; }
    const roleName = t.role_name || stripPrefix(t.Role);
    for (const name of (t.Members || [])) {
      if (!name) continue;
      await pg.query(
        `INSERT INTO team_members (id, project_id, role, name)
         VALUES ($1, $2, $3, $4) ON CONFLICT (project_id, role, name) DO NOTHING`,
        [randomUUID(), t.project_id, roleName, name]
      );
      tmCount++;
    }
  }
  console.log(`${tmCount} done`);

  // ── 5. Sprints ─────────────────────────────────────────────────────────────
  process.stdout.write('Sprints... ');
  const sprints = await scanAll('Sprints');
  let sprintCount = 0;
  for (const s of sprints) {
    if (!s.project_id) { warn('Sprint missing project_id'); continue; }
    const name      = s.sprint_name || stripPrefix(s.Sprint);
    const startDate = toDate(s.Start_Date || s.start_date);
    const endDate   = toDate(s.End_Date   || s.end_date);
    if (!startDate || !endDate) { warn(`Sprint "${name}" missing dates`); continue; }
    await pg.query(
      `INSERT INTO sprints (id, project_id, sprint_name, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (project_id, sprint_name) DO NOTHING`,
      [randomUUID(), s.project_id, name, startDate, endDate]
    );
    sprintCount++;
  }
  console.log(`${sprintCount} done`);

  // ── 6. Release timeline ────────────────────────────────────────────────────
  process.stdout.write('Release timeline... ');
  const timeline = await scanAll('ReleaseTimeline');
  let tlCount = 0;
  for (const t of timeline) {
    if (!t.project_id) { warn('Timeline missing project_id'); continue; }
    const releaseNum = String(t.release_tl_number || stripPrefix(String(t.Release_Number)));
    await pg.query(
      `INSERT INTO release_timeline (id, project_id, release_number, release_date, code_freeze_date, regression_start)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (project_id, release_number) DO NOTHING`,
      [
        randomUUID(), t.project_id, releaseNum,
        toDate(t.Release_Date),
        toDate(t['Code Freeze'] || t.Code_Freeze || t.code_freeze_date),
        toDate(t['Regression Start Date'] || t.Regression_Start || t.regression_start),
      ]
    );
    tlCount++;
  }
  console.log(`${tlCount} done`);

  // ── 7. Modules + pages + out-of-scope pages ────────────────────────────────
  process.stdout.write('Modules + pages... ');
  const moduleRows  = await scanAll('ModulePages');
  const moduleIdMap = {}; // "projectId:moduleName" → pg UUID
  let modCount = 0, pageCount = 0, oosCount = 0;

  for (const mp of moduleRows) {
    if (!mp.project_id) { warn('ModulePages missing project_id'); continue; }
    const moduleName = mp.module_name || stripPrefix(mp.Module);
    const moduleId   = randomUUID();
    moduleIdMap[`${mp.project_id}:${moduleName}`] = moduleId;

    const res = await pg.query(
      `INSERT INTO modules (id, project_id, name, target_release_date, actual_release_date, is_oos, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (project_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [
        moduleId, mp.project_id, moduleName,
        toDate(mp.Target_Release_Date || mp.target_release_date),
        toDate(mp.Actual_Release_Date || mp.actual_release_date),
        mp.is_oos === true,
        mp.created_at || new Date().toISOString(),
      ]
    );
    const actualModuleId = res.rows[0].id;
    moduleIdMap[`${mp.project_id}:${moduleName}`] = actualModuleId;
    modCount++;

    for (const page of (mp.Pages || [])) {
      const pageName = page.page_name || page.Page_Name;
      if (!pageName) continue;
      await pg.query(
        `INSERT INTO pages (id, project_id, module_id, page_name, feature_flag, feature_flag_status,
                            production_deployment_status, release_date, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (module_id, page_name) DO NOTHING`,
        [
          randomUUID(), mp.project_id, actualModuleId, pageName,
          page.Feature_Flag       || page.feature_flag       || null,
          page.Feature_Flag_Status || page.feature_flag_status || 'N/A',
          page.Production_Deployment_Status || page.production_deployment_status || null,
          toDate(page.Release_Date || page.release_date),
          page.sort_order || 0,
        ]
      );
      pageCount++;
    }

    for (const oosName of (mp.OutOfScope || [])) {
      if (!oosName) continue;
      await pg.query(
        `INSERT INTO out_of_scope_pages (id, project_id, module_id, page_name)
         VALUES ($1, $2, $3, $4) ON CONFLICT (module_id, page_name) DO NOTHING`,
        [randomUUID(), mp.project_id, actualModuleId, oosName]
      );
      oosCount++;
    }
  }
  console.log(`${modCount} modules, ${pageCount} pages, ${oosCount} OOS done`);

  // ── 8. PRs + pr_pages + pr_dependencies ───────────────────────────────────
  process.stdout.write('PRs... ');
  const prRows = await scanAll('PRDetails');
  let prCount = 0, prPageCount = 0, prDepCount = 0;

  for (const pr of prRows) {
    if (!pr.project_id || !pr.PR) { warn(`PR missing project_id or PR number: ${pr.id}`); continue; }
    const prId     = pr.id || randomUUID();
    const moduleId = pr.Module ? (moduleIdMap[`${pr.project_id}:${pr.Module}`] || null) : null;

    await pg.query(
      `INSERT INTO prs (id, project_id, pr_number, module_id, developer, reviewer, type, status,
                        user_story, raised_date, first_response_date, approved_date, merged_date,
                        dev_sprint, testing_sprint, target_release, task, release_date, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (id) DO NOTHING`,
      [
        prId, pr.project_id, Number(pr.PR), moduleId,
        pr.Developer || null,
        pr.Reviewer  || null,
        pr.Type      || 'Development',
        pr.Status    || null,
        pr.User_Story || pr.UserStory || null,
        toDate(pr['PR Raised Date'] || pr.Raised_Date || pr.raised_date),
        pr['First Response Date']   || pr.first_response_date || null,
        toDate(pr['Approved Date']  || pr.approved_date),
        toDate(pr['Merged Date']    || pr.merged_date),
        pr.Dev_Sprint      || pr.dev_sprint      || null,
        pr.Testing_Sprint  || pr.testing_sprint  || null,
        pr.Target_Release  || pr.target_release  || null,
        pr.Task            || null,
        toDate(pr.Release_Date || pr.release_date),
        pr.created_at  || new Date().toISOString(),
        pr.updated_at  || pr.UpdatedAt || pr.created_at || new Date().toISOString(),
      ]
    );
    prCount++;

    const pageList = Array.isArray(pr.Page) ? pr.Page : (pr.Page ? [pr.Page] : []);
    for (const pageName of pageList) {
      if (!pageName) continue;
      await pg.query(
        `INSERT INTO pr_pages (id, project_id, pr_id, page_name)
         VALUES ($1, $2, $3, $4) ON CONFLICT (pr_id, page_name) DO NOTHING`,
        [randomUUID(), pr.project_id, prId, String(pageName).trim()]
      );
      prPageCount++;
    }

    for (const depNum of (pr.Dependencies || pr.dependencies || [])) {
      if (!depNum) continue;
      await pg.query(
        `INSERT INTO pr_dependencies (pr_id, project_id, dependent_pr_number)
         VALUES ($1, $2, $3) ON CONFLICT (pr_id, dependent_pr_number) DO NOTHING`,
        [prId, pr.project_id, Number(depNum)]
      );
      prDepCount++;
    }
  }
  console.log(`${prCount} PRs, ${prPageCount} PR pages, ${prDepCount} dependencies done`);

  // ── 9. Prod releases → releases + release_modules + release_pages ──────────
  process.stdout.write('Prod releases... ');
  const prodReleases = await scanAll('ProdReleases');
  let relCount = 0, relModCount = 0, relPageCount = 0;

  for (const rel of prodReleases) {
    if (!rel.project_id) { warn('ProdRelease missing project_id'); continue; }
    const releaseNum = String(rel.release_number || stripPrefix(String(rel.Release_Number)));
    const releaseId  = randomUUID();

    const relRes = await pg.query(
      `INSERT INTO releases (id, project_id, release_number, release_date, code_freeze, regression_start, completed, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id, release_number) DO UPDATE SET release_date = EXCLUDED.release_date
       RETURNING id`,
      [
        releaseId, rel.project_id, releaseNum,
        toDate(rel.Release_Date),
        toDate(rel.Code_Freeze  || rel.code_freeze),
        toDate(rel.Regression_Start || rel.regression_start),
        rel.Completed === true,
        rel.Completed_At || null,
      ]
    );
    const actualReleaseId = relRes.rows[0].id;
    relCount++;

    for (const mod of (rel.Modules || [])) {
      if (!mod.Module) continue;
      const rmId    = randomUUID();
      const rmRes   = await pg.query(
        `INSERT INTO release_modules (id, project_id, release_id, module_name, user_story)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (release_id, module_name) DO UPDATE SET user_story = EXCLUDED.user_story
         RETURNING id`,
        [rmId, rel.project_id, actualReleaseId, mod.Module, mod.User_Story || '']
      );
      const actualRmId = rmRes.rows[0].id;
      relModCount++;

      for (const page of (mod.Pages || [])) {
        const pageName = page.Page_Name || page.page_name;
        if (!pageName) continue;
        await pg.query(
          `INSERT INTO release_pages (id, project_id, release_module_id, page_name, feature_flag, feature_flag_status, pr_number, task)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (release_module_id, page_name) DO NOTHING`,
          [
            randomUUID(), rel.project_id, actualRmId, pageName,
            page.Feature_Flag       || null,
            page.Feature_Flag_Status || 'N/A',
            page.PR   ? Number(page.PR)   : null,
            page.Task || null,
          ]
        );
        relPageCount++;
      }
    }
  }
  console.log(`${relCount} releases, ${relModCount} modules, ${relPageCount} pages done`);

  // ── 10. Status assignments + activity logs ─────────────────────────────────
  process.stdout.write('Status assignments... ');
  const statusRows = await scanAll('StatusTracker');
  let assignCount = 0, actCount = 0;

  for (const sa of statusRows) {
    if (!sa.project_id || !sa.Developer) { warn(`Assignment missing project_id/Developer: ${sa.id}`); continue; }
    const weekStart = toDate(sa.Week || sa.week_start);
    if (!weekStart) { warn(`Assignment ${sa.id} missing Week`); continue; }

    const assignId = sa.id || randomUUID();
    const moduleId = sa.Module ? (moduleIdMap[`${sa.project_id}:${sa.Module}`] || null) : null;

    await pg.query(
      `INSERT INTO status_assignments
         (id, project_id, developer, module_id, page_name, week_start, linked_pr_number,
          status, type, task, sprint, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        assignId, sa.project_id, sa.Developer, moduleId,
        sa.Page   || null,
        weekStart,
        sa.PR     ? Number(sa.PR) : null,
        sa.Status || 'Pending',
        sa.Type   || 'Development',
        sa.Task   || null,
        sa.Sprint || null,
        sa.CreatedAt || sa.created_at || new Date().toISOString(),
        sa.UpdatedAt || sa.updated_at || new Date().toISOString(),
      ]
    );
    assignCount++;

    for (const log of (sa.ActivityLog || [])) {
      await pg.query(
        `INSERT INTO activity_logs (id, project_id, assignment_id, note, type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(), sa.project_id, assignId,
          log.note || '',
          log.type || 'update',
          log.timestamp || new Date().toISOString(),
        ]
      );
      actCount++;
    }
  }
  console.log(`${assignCount} assignments, ${actCount} activity logs done`);

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n── Migration complete ──────────────────────────────────────');
  if (skipped > 0) console.log(`  ${skipped} warnings (see WARN lines above)`);

  // Row counts in PostgreSQL
  const tables = [
    'companies','projects','users','project_members','team_members',
    'sprints','release_timeline','modules','pages','out_of_scope_pages',
    'prs','pr_pages','pr_dependencies',
    'releases','release_modules','release_pages',
    'status_assignments','activity_logs',
  ];
  const counts = await Promise.all(tables.map(t => pg.query(`SELECT COUNT(*) FROM ${t}`)));
  console.log('\nPostgreSQL row counts:');
  tables.forEach((t, i) => console.log(`  ${t.padEnd(24)} ${counts[i].rows[0].count}`));

  await pg.end();
}

migrate().catch(e => {
  console.error('\nMigration failed:', e.message);
  console.error(e.stack);
  process.exit(1);
});
