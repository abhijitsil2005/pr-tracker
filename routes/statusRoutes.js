const express = require('express');
const router  = express.Router();
const { pool, query, setContext } = require('../services/pgClient');
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
    COALESCE(
      (SELECT json_agg(sap.pr_number ORDER BY sap.position)
       FROM status_assignment_prs sap WHERE sap.assignment_id = sa.id),
      '[]'::json
    ) AS "PRs",
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
  const { Developer, Module, Page, Week, PRs, Status, Type, Task, Sprint, note } = req.body;
  if (!Developer) return res.status(400).json({ error: 'Developer is required' });
  if (!Week)      return res.status(400).json({ error: 'Week is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    // Resolve module name → id
    let moduleId = null;
    if (Module) {
      const { rows } = await client.query(
        'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
        [pid(req), Module]
      );
      moduleId = rows[0]?.id || null;
    }

    // Same developer already assigned to this exact module/page — don't create a duplicate row
    const { rows: dupRows } = await client.query(
      `SELECT id FROM status_assignments
       WHERE project_id = $1 AND developer = $2
         AND module_id IS NOT DISTINCT FROM $3
         AND page_name IS NOT DISTINCT FROM $4`,
      [pid(req), Developer, moduleId, Page || null]
    );
    if (dupRows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `${Developer} is already assigned to ${Module || 'this module'} / ${Page || 'this page'}`,
      });
    }

    const { rows } = await client.query(
      `INSERT INTO status_assignments
         (project_id, developer, module_id, page_name, week_start,
          status, type, task, sprint)
       VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)
       RETURNING id`,
      [
        pid(req), Developer, moduleId,
        Page   || null,
        Week,
        Status || 'Pending',
        Type   || 'Development',
        Task   || null,
        Sprint || null,
      ]
    );
    const assignmentId = rows[0].id;

    // Initial set of linked PRs (chips already selected before the assignment existed)
    const prNumbers = Array.isArray(PRs) ? [...new Set(PRs.map(Number).filter(n => n > 0))] : [];
    for (let i = 0; i < prNumbers.length; i++) {
      await client.query(
        `INSERT INTO status_assignment_prs (project_id, assignment_id, pr_number, position)
         VALUES ($1, $2, $3, $4)`,
        [pid(req), assignmentId, prNumbers[i], i]
      );
    }

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
    await setContext(client, ctx(req));

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

// POST /api/status/:id/prs — link one more PR (chips add). Shared by the
// Assign/Edit modal and the Activity modal so both call the exact same code.
router.post('/:id/prs', requireWrite, async (req, res) => {
  const prNumber = Number(req.body.pr_number);
  if (!prNumber) return res.status(400).json({ error: 'pr_number is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const { rows: existing } = await client.query(
      'SELECT id FROM status_assignments WHERE id = $1 AND project_id = $2',
      [req.params.id, pid(req)]
    );
    if (!existing.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const { rows: posRows } = await client.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM status_assignment_prs WHERE assignment_id = $1',
      [req.params.id]
    );
    await client.query(
      `INSERT INTO status_assignment_prs (project_id, assignment_id, pr_number, position)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (assignment_id, pr_number) DO NOTHING`,
      [pid(req), req.params.id, prNumber, posRows[0].next_pos]
    );

    await client.query(
      `INSERT INTO activity_logs (project_id, assignment_id, note, type)
       VALUES ($1, $2, $3, 'pr_linked')`,
      [pid(req), req.params.id, `PR #${prNumber} linked`]
    );

    const { rows: result } = await client.query(`${ASSIGNMENT_SELECT} WHERE sa.id = $1`, [req.params.id]);
    await client.query('COMMIT');
    res.status(201).json(result[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/status/:id/prs/:prNumber — unlink one PR (chips remove)
router.delete('/:id/prs/:prNumber', requireWrite, async (req, res) => {
  const prNumber = Number(req.params.prNumber);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const { rows: existing } = await client.query(
      'SELECT id FROM status_assignments WHERE id = $1 AND project_id = $2',
      [req.params.id, pid(req)]
    );
    if (!existing.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const { rowCount } = await client.query(
      'DELETE FROM status_assignment_prs WHERE assignment_id = $1 AND pr_number = $2',
      [req.params.id, prNumber]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `PR #${prNumber} is not linked to this assignment` });
    }

    await client.query(
      `INSERT INTO activity_logs (project_id, assignment_id, note, type)
       VALUES ($1, $2, $3, 'pr_unlinked')`,
      [pid(req), req.params.id, `PR #${prNumber} unlinked`]
    );

    const { rows: result } = await client.query(`${ASSIGNMENT_SELECT} WHERE sa.id = $1`, [req.params.id]);
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
    await setContext(client, ctx(req));

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
