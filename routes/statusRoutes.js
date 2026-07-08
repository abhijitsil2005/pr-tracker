const express = require('express');
const router  = express.Router();
const { pool, query } = require('../services/pgClient');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;
const ctx = (req) => ({ project_id: req.user.project_id });

// Full assignment SELECT with ActivityLog aggregated
const ASSIGNMENT_SELECT = `
  SELECT
    sa.id,
    sa.project_id,
    sa.developer          AS "Developer",
    m.name                AS "Module",
    sa.page_name          AS "Page",
    sa.week_start         AS "Week",
    sa.linked_pr_number   AS "PR",
    sa.status             AS "Status",
    sa.type               AS "Type",
    sa.task               AS "Task",
    sa.sprint             AS "Sprint",
    sa.created_at         AS "CreatedAt",
    sa.updated_at         AS "UpdatedAt",
    COALESCE(
      (SELECT json_agg(json_build_object(
         'id',        al.id,
         'timestamp', al.created_at,
         'note',      al.note,
         'type',      al.type
       ) ORDER BY al.created_at)
       FROM activity_logs al WHERE al.assignment_id = sa.id),
      '[]'::json
    ) AS "ActivityLog"
  FROM status_assignments sa
  LEFT JOIN modules m ON m.id = sa.module_id`;

// ── Routes ────────────────────────────────────────────────────────

// GET /api/status?week=YYYY-MM-DD&developer=Name
router.get('/', async (req, res) => {
  try {
    const { week, developer } = req.query;
    const conditions = ['sa.project_id = $1'];
    const vals = [pid(req)];

    if (week)      { vals.push(week);      conditions.push(`sa.week_start = $${vals.length}::date`); }
    if (developer) { vals.push(developer); conditions.push(`sa.developer = $${vals.length}`); }

    const { rows } = await query(
      `${ASSIGNMENT_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY sa.week_start, sa.developer`,
      vals,
      ctx(req)
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/status/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `${ASSIGNMENT_SELECT} WHERE sa.id = $1 AND sa.project_id = $2`,
      [req.params.id, pid(req)],
      ctx(req)
    );
    if (!rows.length) return res.status(404).json({ error: 'Assignment not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/status
router.post('/', requireWrite, async (req, res) => {
  const { Developer, Module, Page, Week, PR, Status, Type, Task, Sprint, note } = req.body;
  if (!Developer) return res.status(400).json({ error: 'Developer is required' });
  if (!Week)      return res.status(400).json({ error: 'Week is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Resolve module name → id
    let moduleId = null;
    if (Module) {
      const { rows } = await client.query(
        'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
        [pid(req), Module]
      );
      moduleId = rows[0]?.id || null;
    }

    const { rows } = await client.query(
      `INSERT INTO status_assignments
         (project_id, developer, module_id, page_name, week_start,
          linked_pr_number, status, type, task, sprint)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        pid(req), Developer, moduleId,
        Page   || null,
        Week,
        PR     ? Number(PR) : null,
        Status || 'Pending',
        Type   || 'Development',
        Task   || null,
        Sprint || null,
      ]
    );
    const assignmentId = rows[0].id;

    // Create the initial activity log entry
    await client.query(
      `INSERT INTO activity_logs (project_id, assignment_id, note, type)
       VALUES ($1, $2, $3, 'created')`,
      [pid(req), assignmentId, note || 'Assignment created']
    );

    const { rows: result } = await client.query(
      `${ASSIGNMENT_SELECT} WHERE sa.id = $1`,
      [assignmentId]
    );
    await client.query('COMMIT');
    res.status(201).json(result[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// PUT /api/status/:id
router.put('/:id', requireWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      'SELECT id FROM status_assignments WHERE id = $1 AND project_id = $2',
      [req.params.id, pid(req)]
    );
    if (!existing.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const body = req.body;
    const sets = [];
    const vals = [req.params.id];
    const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    if (body.Developer !== undefined) push('developer',        body.Developer);
    if (body.Page      !== undefined) push('page_name',        body.Page      || null);
    if (body.Week      !== undefined) push('week_start',       body.Week);
    if (body.Status    !== undefined) push('status',           body.Status    || null);
    if (body.Type      !== undefined) push('type',             body.Type      || 'Development');
    if (body.Task      !== undefined) push('task',             body.Task      || null);
    if (body.Sprint    !== undefined) push('sprint',           body.Sprint    || null);
    if (body.PR        !== undefined) push('linked_pr_number', body.PR ? Number(body.PR) : null);

    if (body.Module !== undefined) {
      let moduleId = null;
      if (body.Module) {
        const { rows } = await client.query(
          'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
          [pid(req), body.Module]
        );
        moduleId = rows[0]?.id || null;
      }
      push('module_id', moduleId);
    }

    if (sets.length) {
      await client.query(
        `UPDATE status_assignments SET ${sets.join(', ')} WHERE id = $1`,
        vals
      );
    }

    const { rows: result } = await client.query(
      `${ASSIGNMENT_SELECT} WHERE sa.id = $1`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json(result[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/status/:id
router.delete('/:id', requireWrite, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM status_assignments WHERE id = $1 AND project_id = $2',
      [req.params.id, pid(req)],
      ctx(req)
    );
    if (!rowCount) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ message: 'Assignment deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/status/:id/activity
router.post('/:id/activity', requireWrite, async (req, res) => {
  const { note, type } = req.body;
  if (!note) return res.status(400).json({ error: 'note is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      'SELECT id FROM status_assignments WHERE id = $1 AND project_id = $2',
      [req.params.id, pid(req)]
    );
    if (!existing.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assignment not found' });
    }

    await client.query(
      `INSERT INTO activity_logs (project_id, assignment_id, note, type)
       VALUES ($1, $2, $3, $4)`,
      [pid(req), req.params.id, note, type || 'update']
    );

    const { rows: result } = await client.query(
      `${ASSIGNMENT_SELECT} WHERE sa.id = $1`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.status(201).json(result[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;
