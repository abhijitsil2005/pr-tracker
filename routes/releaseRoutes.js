const express = require('express');
const router = express.Router();
const { pool, query, setContext } = require('../services/pgClient');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;
const ctx = (req) => ({ project_id: req.user.project_id });

// Full release SELECT: nested Modules → Pages JSON
const RELEASE_SELECT = `
  SELECT
    r.id,
    r.project_id,
    r.release_number     AS "Release_Number",
    r.release_date       AS "Release_Date",
    r.code_freeze        AS "Code_Freeze",
    r.regression_start   AS "Regression_Start",
    r.completed          AS "Completed",
    r.completed_at       AS "Completed_At",
    COALESCE(
      (SELECT json_agg(
         json_build_object(
           'Module',     rm.module_name,
           'User_Story', rm.user_story,
           'Pages', COALESCE(
             (SELECT json_agg(json_build_object(
                'Page_Name',           rp.page_name,
                'Feature_Flag',        rp.feature_flag,
                'Feature_Flag_Status', rp.feature_flag_status,
                'PR',                  rp.pr_number,
                'Task',                rp.task
              ) ORDER BY rp.page_name)
              FROM release_pages rp WHERE rp.release_module_id = rm.id
             ), '[]'::json)
         ) ORDER BY rm.module_name
       )
       FROM release_modules rm WHERE rm.release_id = r.id
      ), '[]'::json) AS "Modules"
  FROM releases r`;

// Upsert a release and fully replace its modules/pages within an open transaction.
// Returns the release UUID.
async function upsertRelease(client, projectId, body) {
  const releaseNumber   = String(body.Release_Number ?? body.release_number);
  const releaseDate     = body.Release_Date     ?? body.release_date     ?? null;
  const codeFreeze      = body.Code_Freeze      ?? body.code_freeze      ?? null;
  const regressionStart = body.Regression_Start ?? body.regression_start ?? null;
  const modules         = body.Modules          ?? body.modules          ?? [];

  const { rows } = await client.query(
    `INSERT INTO releases
       (project_id, release_number, release_date, code_freeze, regression_start)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (project_id, release_number) DO UPDATE SET
       release_date      = EXCLUDED.release_date,
       code_freeze       = EXCLUDED.code_freeze,
       regression_start  = EXCLUDED.regression_start
     RETURNING id`,
    [projectId, releaseNumber, releaseDate, codeFreeze, regressionStart]
  );
  const releaseId = rows[0].id;

  // Replace all modules (ON DELETE CASCADE removes their release_pages)
  await client.query('DELETE FROM release_modules WHERE release_id = $1', [releaseId]);

  for (const mod of modules) {
    const moduleName = mod.Module ?? mod.module_name;
    if (!moduleName) continue;

    const { rows: rmRows } = await client.query(
      `INSERT INTO release_modules (project_id, release_id, module_name, user_story)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [projectId, releaseId, moduleName, mod.User_Story ?? mod.user_story ?? null]
    );
    const rmId = rmRows[0].id;

    for (const page of (mod.Pages ?? mod.pages ?? [])) {
      const pageName = page.Page_Name ?? page.page_name;
      if (!pageName) continue;
      await client.query(
        `INSERT INTO release_pages
           (project_id, release_module_id, page_name,
            feature_flag, feature_flag_status, pr_number, task)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          projectId, rmId, pageName,
          page.Feature_Flag        ?? null,
          page.Feature_Flag_Status ?? 'N/A',
          page.PR != null ? Number(page.PR) : null,
          page.Task ?? null,
        ]
      );
    }
  }

  return releaseId;
}

// Mark a release completed: deploy pages, update modules, update PRs.
async function completeRelease(client, projectId, releaseNumber) {
  const { rows: relRows } = await client.query(
    'SELECT id, release_date FROM releases WHERE project_id = $1 AND release_number = $2',
    [projectId, releaseNumber]
  );
  if (!relRows.length) throw new Error(`Release ${releaseNumber} not found`);
  const { id: releaseId, release_date: releaseDate } = relRows[0];

  // Flat join of all modules + pages for this release
  const { rows: flat } = await client.query(
    `SELECT rm.module_name, rp.page_name, rp.feature_flag_status, rp.pr_number
     FROM release_modules rm
     LEFT JOIN release_pages rp ON rp.release_module_id = rm.id
     WHERE rm.release_id = $1`,
    [releaseId]
  );

  // Group into { moduleName → [pages] }
  const moduleMap = {};
  for (const row of flat) {
    if (!moduleMap[row.module_name]) moduleMap[row.module_name] = [];
    if (row.page_name) moduleMap[row.module_name].push(row);
  }

  const EXCLUDED = new Set(['Infrastructure Pages', 'API', 'Shared Controls']);
  const prNumbers = new Set();

  for (const [moduleName, pages] of Object.entries(moduleMap)) {
    const { rows: modRows } = await client.query(
      'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
      [projectId, moduleName]
    );
    if (!modRows.length) continue;
    const moduleId = modRows[0].id;

    for (const page of pages) {
      if (page.pr_number) prNumbers.add(page.pr_number);

      // Mark page as deployed; preserve existing FF status if release has none
      await client.query(
        `UPDATE pages
         SET production_deployment_status = 'Deployed',
             feature_flag_status = COALESCE($1, feature_flag_status),
             release_date = $2
         WHERE module_id = $3
           AND (page_name = $4
                OR page_name LIKE '%/' || $4
                OR $4        LIKE '%/' || page_name)`,
        [page.feature_flag_status || null, releaseDate, moduleId, page.page_name]
      );
    }

    // If every non-excluded page in this module is now deployed, stamp actual_release_date
    const { rows: allPages } = await client.query(
      'SELECT page_name, production_deployment_status FROM pages WHERE module_id = $1',
      [moduleId]
    );
    const countable = allPages.filter(p => !EXCLUDED.has(p.page_name));
    if (countable.length > 0 && countable.every(p => p.production_deployment_status === 'Deployed')) {
      await client.query(
        'UPDATE modules SET actual_release_date = $1 WHERE id = $2',
        [releaseDate, moduleId]
      );
    }
  }

  // Move all covered PRs to Prod Deployed
  for (const prNum of prNumbers) {
    await client.query(
      `UPDATE prs SET status = 'Prod Deployed', release_date = $1
       WHERE project_id = $2 AND pr_number = $3`,
      [releaseDate, projectId, prNum]
    );
  }

  await client.query(
    'UPDATE releases SET completed = true, completed_at = now() WHERE id = $1',
    [releaseId]
  );

  return { moduleCount: Object.keys(moduleMap).length, prCount: prNumbers.size };
}

// ── Routes ────────────────────────────────────────────────────────

// GET /api/releases
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `${RELEASE_SELECT} WHERE r.project_id = $1 ORDER BY r.release_date`,
      [pid(req)],
      ctx(req)
    );
    res.json({ count: rows.length, data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/releases/timeline/all
// Same source as GET /api/lookup/timeline — see comment there on why this
// reads `releases` rather than the legacy `release_timeline` table.
router.get('/timeline/all', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT release_number   AS "Release_Number",
              release_date     AS "Release_Date",
              code_freeze      AS "Code Freeze",
              regression_start AS "Regression Start Date"
       FROM releases
       WHERE project_id = $1
       ORDER BY release_number`,
      [pid(req)],
      ctx(req)
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/releases/:releaseNumber
router.get('/:releaseNumber', async (req, res) => {
  try {
    const { rows } = await query(
      `${RELEASE_SELECT} WHERE r.project_id = $1 AND r.release_number = $2`,
      [pid(req), req.params.releaseNumber],
      ctx(req)
    );
    if (!rows.length) return res.status(404).json({ error: `Release ${req.params.releaseNumber} not found` });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/releases
router.post('/', requireWrite, async (req, res) => {
  if (!req.body.Release_Number) return res.status(400).json({ error: 'Release_Number is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));
    const releaseId = await upsertRelease(client, pid(req), req.body);
    const { rows } = await client.query(`${RELEASE_SELECT} WHERE r.id = $1`, [releaseId]);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Release created/updated', data: rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// PUT /api/releases/:releaseNumber
router.put('/:releaseNumber', requireWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    // Verify existence, then merge existing fields with incoming body
    const { rows: existing } = await client.query(
      `${RELEASE_SELECT} WHERE r.project_id = $1 AND r.release_number = $2`,
      [pid(req), req.params.releaseNumber]
    );
    if (!existing.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Release ${req.params.releaseNumber} not found` });
    }

    const merged = {
      ...existing[0],
      ...req.body,
      Release_Number: existing[0].Release_Number,
    };
    const releaseId = await upsertRelease(client, pid(req), merged);
    const { rows } = await client.query(`${RELEASE_SELECT} WHERE r.id = $1`, [releaseId]);
    await client.query('COMMIT');
    res.json({ message: 'Release updated', data: rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// POST /api/releases/:releaseNumber/complete
router.post('/:releaseNumber/complete', requireWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));
    const result = await completeRelease(client, pid(req), req.params.releaseNumber);
    await client.query('COMMIT');
    res.json({ message: `Release ${req.params.releaseNumber} completed`, ...result });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    const code = e.message.includes('not found') ? 404 : 500;
    res.status(code).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/releases/:releaseNumber
router.delete('/:releaseNumber', requireWrite, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM releases WHERE project_id = $1 AND release_number = $2',
      [pid(req), req.params.releaseNumber],
      ctx(req)
    );
    if (!rowCount) return res.status(404).json({ error: `Release ${req.params.releaseNumber} not found` });
    res.json({ message: `Release ${req.params.releaseNumber} deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
