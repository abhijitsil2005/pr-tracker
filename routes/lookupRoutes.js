const express = require('express');
const router = express.Router();
const { query } = require('../services/pgClient');
const { requireProject } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;
const ctx = (req) => ({ project_id: req.user.project_id });

// GET /api/lookup/modules
router.get('/modules', async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT name FROM modules WHERE project_id = $1 ORDER BY name',
      [pid(req)],
      ctx(req)
    );
    res.json(rows.map(r => r.name));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/modules/:moduleName/pages
router.get('/modules/:moduleName/pages', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT page_name,
              feature_flag                 AS "Feature_Flag",
              feature_flag_status          AS "Feature_Flag_Status",
              production_deployment_status AS "Production_Deployment_Status",
              release_date                 AS "Release_Date",
              sort_order
       FROM pages
       WHERE module_id = (
         SELECT id FROM modules WHERE project_id = $1 AND name = $2 LIMIT 1
       )
       ORDER BY sort_order, page_name`,
      [pid(req), req.params.moduleName],
      ctx(req)
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/team
router.get('/team', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT role AS "Role", array_agg(name ORDER BY name) AS "Members"
       FROM team_members
       WHERE project_id = $1
       GROUP BY role
       ORDER BY role`,
      [pid(req)],
      ctx(req)
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/developers
router.get('/developers', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT name FROM team_members
       WHERE project_id = $1 AND role = 'Developer'
       ORDER BY name`,
      [pid(req)],
      ctx(req)
    );
    res.json(rows.map(r => r.name));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/reviewers
router.get('/reviewers', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT name FROM team_members
       WHERE project_id = $1 AND role = 'PR Reviewer'
       ORDER BY name`,
      [pid(req)],
      ctx(req)
    );
    res.json(rows.map(r => r.name));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/timeline
// Reads from `releases` (not the legacy `release_timeline` table, which is only
// ever populated by the one-off DynamoDB migration and has no create/edit route
// in the app) so every date this offers actually corresponds to a real release —
// otherwise picking one of the stale dates silently fails to sync release pages.
router.get('/timeline', async (req, res) => {
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

// GET /api/lookup/pr-statuses
router.get('/pr-statuses', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT name AS "Name", is_deployed AS "IsDeployed"
       FROM pr_statuses
       WHERE project_id = $1
       ORDER BY sort_order, name`,
      [pid(req)],
      ctx(req)
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/module-pages
router.get('/module-pages', async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         m.id,
         m.name                 AS "Module",
         m.target_release_date  AS "Target_Release_Date",
         m.actual_release_date  AS "Actual_Release_Date",
         COALESCE(
           (SELECT json_agg(
             json_build_object(
               'page_name',                    p.page_name,
               'Feature_Flag',                 p.feature_flag,
               'Feature_Flag_Status',          p.feature_flag_status,
               'Production_Deployment_Status', p.production_deployment_status,
               'Release_Date',                 p.release_date,
               'sort_order',                   p.sort_order
             ) ORDER BY p.sort_order, p.page_name
           )
           FROM pages p WHERE p.module_id = m.id
         ), '[]'::json) AS "Pages",
         COALESCE(
           (SELECT array_agg(oos.page_name ORDER BY oos.page_name)
            FROM out_of_scope_pages oos WHERE oos.module_id = m.id
           ), ARRAY[]::text[]) AS "OutOfScope"
       FROM modules m
       WHERE m.project_id = $1
       ORDER BY m.name`,
      [pid(req)],
      ctx(req)
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
