const express = require('express');
const router  = express.Router();
const { pool } = require('../services/pgClient');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Verify caller can manage this project: CompanyAdmin or project-level Admin
async function canManage(req, res, next) {
  try {
    const { projectId } = req.params;
    const isCompanyAdmin = req.user.company_role === 'CompanyAdmin';
    const isProjectAdmin = req.user.project_id === projectId && req.user.role === 'Admin';
    if (!isCompanyAdmin && !isProjectAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { rows } = await pool.query(
      'SELECT id FROM projects WHERE id = $1 AND company_id = $2',
      [projectId, req.user.company_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── Team Members ──────────────────────────────────────────────────

// GET /api/onboard/:projectId/team
router.get('/:projectId/team', canManage, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, role, name FROM team_members WHERE project_id = $1 ORDER BY role, name',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/onboard/:projectId/team
router.post('/:projectId/team', canManage, async (req, res) => {
  const { role, name } = req.body;
  if (!role || !name) return res.status(400).json({ error: 'role and name are required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO team_members (project_id, role, name)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, name) DO UPDATE SET role = EXCLUDED.role
       RETURNING id, role, name`,
      [req.params.projectId, role.trim(), name.trim()]
    );
    res.status(201).json({ message: 'Team member added', data: rows[0] });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/onboard/:projectId/team/:name
router.delete('/:projectId/team/:name', canManage, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM team_members WHERE project_id = $1 AND name = $2',
      [req.params.projectId, decodeURIComponent(req.params.name)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Team member not found' });
    res.json({ message: 'Team member removed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Sprint Dates ──────────────────────────────────────────────────

// GET /api/onboard/:projectId/sprints
router.get('/:projectId/sprints', canManage, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sprint_name AS "Sprint", start_date AS "StartDate", end_date AS "EndDate"
       FROM sprints WHERE project_id = $1 ORDER BY start_date`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/onboard/:projectId/sprints
router.post('/:projectId/sprints', canManage, async (req, res) => {
  const { sprint_name, start_date, end_date } = req.body;
  if (!sprint_name || !start_date || !end_date) {
    return res.status(400).json({ error: 'sprint_name, start_date, and end_date are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO sprints (project_id, sprint_name, start_date, end_date)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id, sprint_name) DO UPDATE SET
         start_date = EXCLUDED.start_date,
         end_date   = EXCLUDED.end_date
       RETURNING id, sprint_name AS "Sprint", start_date AS "StartDate", end_date AS "EndDate"`,
      [req.params.projectId, sprint_name.trim(), start_date, end_date]
    );
    res.status(201).json({ message: 'Sprint added', data: rows[0] });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/onboard/:projectId/sprints/:name
router.delete('/:projectId/sprints/:name', canManage, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM sprints WHERE project_id = $1 AND sprint_name = $2',
      [req.params.projectId, decodeURIComponent(req.params.name)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Sprint not found' });
    res.json({ message: 'Sprint removed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Release Calendar ──────────────────────────────────────────────

// GET /api/onboard/:projectId/releases
router.get('/:projectId/releases', canManage, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT release_number     AS "Release_Number",
              release_date       AS "Release_Date",
              code_freeze        AS "Code_Freeze",
              regression_start   AS "Regression_Start",
              completed          AS "Completed"
       FROM releases
       WHERE project_id = $1
       ORDER BY release_date`,
      [req.params.projectId]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/onboard/:projectId/releases
router.post('/:projectId/releases', canManage, async (req, res) => {
  const { Release_Number, Release_Date, Code_Freeze, Regression_Start } = req.body;
  if (!Release_Number || !Release_Date) {
    return res.status(400).json({ error: 'Release_Number and Release_Date are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO releases (project_id, release_number, release_date, code_freeze, regression_start)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, release_number) DO UPDATE SET
         release_date     = EXCLUDED.release_date,
         code_freeze      = EXCLUDED.code_freeze,
         regression_start = EXCLUDED.regression_start
       RETURNING
         release_number   AS "Release_Number",
         release_date     AS "Release_Date",
         code_freeze      AS "Code_Freeze",
         regression_start AS "Regression_Start"`,
      [
        req.params.projectId,
        String(Release_Number),
        Release_Date,
        Code_Freeze     || null,
        Regression_Start || null,
      ]
    );
    res.status(201).json({ message: 'Release added', data: rows[0] });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/onboard/:projectId/releases/:number
router.delete('/:projectId/releases/:number', canManage, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM releases WHERE project_id = $1 AND release_number = $2',
      [req.params.projectId, req.params.number]
    );
    if (!rowCount) return res.status(404).json({ error: 'Release not found' });
    res.json({ message: 'Release removed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
