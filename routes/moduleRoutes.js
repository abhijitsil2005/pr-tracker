const express = require('express');
const router = express.Router();
const { pool, query, setContext } = require('../services/pgClient');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;
const ctx = (req) => ({ project_id: req.user.project_id });

// Shared SQL fragment: full module object with Pages and OutOfScope aggregated
const MODULE_SELECT = `
  SELECT
    m.id,
    m.name                AS "Module",
    COALESCE(
      m.target_release_date,
      (SELECT MIN(r.release_date)
       FROM release_modules rm
       JOIN releases r ON r.id = rm.release_id
       WHERE rm.module_name = m.name AND r.project_id = m.project_id)
    )                     AS "Target_Release_Date",
    m.actual_release_date AS "Actual_Release_Date",
    m.is_oos              AS "IsOutOfScope",
    COALESCE(
      (SELECT json_agg(json_build_object(
         'page_name',                    p.page_name,
         'Feature_Flag',                 p.feature_flag,
         'Feature_Flag_Status',          p.feature_flag_status,
         'Production_Deployment_Status', p.production_deployment_status,
         'Release_Date',                 p.release_date,
         'sort_order',                   p.sort_order
       ) ORDER BY p.sort_order, p.page_name)
       FROM pages p WHERE p.module_id = m.id
    ), '[]'::json) AS "Pages",
    COALESCE(
      (SELECT array_agg(oos.page_name ORDER BY oos.page_name)
       FROM out_of_scope_pages oos WHERE oos.module_id = m.id
      ), ARRAY[]::text[]) AS "OutOfScope"
  FROM modules m`;

// Helper: fetch one module row using an already-open pg client (used in write transactions)
async function fetchModule(client, projectId, moduleName) {
  const { rows } = await client.query(
    `${MODULE_SELECT} WHERE m.project_id = $1 AND m.name = $2`,
    [projectId, moduleName]
  );
  return rows[0] || null;
}

// ── Modules ───────────────────────────────────────────────────────

// GET /api/modules
router.get('/', async (req, res) => {
  try {
    const { rows } = await query(
      `${MODULE_SELECT} WHERE m.project_id = $1 ORDER BY m.name`,
      [pid(req)],
      ctx(req)
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/modules/:name
router.get('/:name', async (req, res) => {
  try {
    const { rows } = await query(
      `${MODULE_SELECT} WHERE m.project_id = $1 AND m.name = $2`,
      [pid(req), req.params.name],
      ctx(req)
    );
    if (!rows.length) return res.status(404).json({ error: `Module "${req.params.name}" not found` });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/modules
router.post('/', requireWrite, async (req, res) => {
  const { Module, Pages, OutOfScope } = req.body;
  if (!Module) return res.status(400).json({ error: 'Module name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const { rows } = await client.query(
      `INSERT INTO modules (project_id, name) VALUES ($1, $2) RETURNING id`,
      [pid(req), Module]
    );
    const moduleId = rows[0].id;

    for (const p of (Pages || [])) {
      await client.query(
        `INSERT INTO pages
           (project_id, module_id, page_name, feature_flag, feature_flag_status,
            production_deployment_status, release_date, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (module_id, page_name) DO NOTHING`,
        [pid(req), moduleId, p.page_name,
         p.Feature_Flag || '', p.Feature_Flag_Status || 'N/A',
         p.Production_Deployment_Status || null, p.Release_Date || null, p.sort_order || 0]
      );
    }

    for (const name of (OutOfScope || [])) {
      await client.query(
        `INSERT INTO out_of_scope_pages (project_id, module_id, page_name)
         VALUES ($1, $2, $3) ON CONFLICT (module_id, page_name) DO NOTHING`,
        [pid(req), moduleId, name]
      );
    }

    const mod = await fetchModule(client, pid(req), Module);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Module created', data: mod });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// PUT /api/modules/:name
router.put('/:name', requireWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const check = await client.query(
      'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
      [pid(req), req.params.name]
    );
    if (!check.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Module "${req.params.name}" not found` });
    }
    const moduleId = check.rows[0].id;

    // Update module-level scalar fields
    const newName      = req.body.Module          ?? req.body.module_name;
    const targetDate   = req.body.Target_Release_Date ?? req.body.target_release_date;
    const actualDate   = req.body.Actual_Release_Date ?? req.body.actual_release_date;
    const isOOS        = req.body.IsOutOfScope;

    const sets = [];
    const vals = [pid(req), req.params.name];
    if (newName    !== undefined) { vals.push(newName);           sets.push(`name = $${vals.length}`); }
    if (targetDate !== undefined) { vals.push(targetDate || null); sets.push(`target_release_date = $${vals.length}`); }
    if (actualDate !== undefined) { vals.push(actualDate || null); sets.push(`actual_release_date = $${vals.length}`); }
    if (isOOS      !== undefined) { vals.push(!!isOOS);           sets.push(`is_oos = $${vals.length}`); }

    if (sets.length) {
      await client.query(
        `UPDATE modules SET ${sets.join(', ')} WHERE project_id = $1 AND name = $2`,
        vals
      );
    }

    // If Pages array is supplied, replace all pages
    if (req.body.Pages !== undefined) {
      await client.query('DELETE FROM pages WHERE module_id = $1', [moduleId]);
      for (const p of (req.body.Pages || [])) {
        await client.query(
          `INSERT INTO pages
             (project_id, module_id, page_name, feature_flag, feature_flag_status,
              production_deployment_status, release_date, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [pid(req), moduleId, p.page_name,
           p.Feature_Flag || '', p.Feature_Flag_Status || 'N/A',
           p.Production_Deployment_Status || null, p.Release_Date || null, p.sort_order || 0]
        );
      }
    }

    // If OutOfScope array is supplied, replace all oos pages
    if (req.body.OutOfScope !== undefined) {
      await client.query('DELETE FROM out_of_scope_pages WHERE module_id = $1', [moduleId]);
      for (const name of (req.body.OutOfScope || [])) {
        await client.query(
          `INSERT INTO out_of_scope_pages (project_id, module_id, page_name) VALUES ($1, $2, $3)`,
          [pid(req), moduleId, name]
        );
      }
    }

    const finalName = newName ?? req.params.name;
    const mod = await fetchModule(client, pid(req), finalName);
    await client.query('COMMIT');
    res.json({ message: 'Module updated', data: mod });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/modules/:name
router.delete('/:name', requireWrite, async (req, res) => {
  try {
    const { rowCount } = await query(
      'DELETE FROM modules WHERE project_id = $1 AND name = $2',
      [pid(req), req.params.name],
      ctx(req)
    );
    if (!rowCount) return res.status(404).json({ error: `Module "${req.params.name}" not found` });
    res.json({ message: `Module "${req.params.name}" deleted` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Pages within a module ─────────────────────────────────────────

// POST /api/modules/:name/pages
router.post('/:name/pages', requireWrite, async (req, res) => {
  const { page_name, Feature_Flag, Feature_Flag_Status,
          Production_Deployment_Status, Release_Date } = req.body;
  if (!page_name) return res.status(400).json({ error: 'page_name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const mod = await client.query(
      'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
      [pid(req), req.params.name]
    );
    if (!mod.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Module "${req.params.name}" not found` });
    }
    const moduleId = mod.rows[0].id;

    await client.query(
      `INSERT INTO pages
         (project_id, module_id, page_name, feature_flag, feature_flag_status,
          production_deployment_status, release_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [pid(req), moduleId, page_name,
       Feature_Flag || '', Feature_Flag_Status || 'N/A',
       Production_Deployment_Status || null, Release_Date || null]
    );

    const result = await fetchModule(client, pid(req), req.params.name);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Page added', data: result });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// PUT /api/modules/:name/pages/:pageName
router.put('/:name/pages/:pageName', requireWrite, async (req, res) => {
  const pageName = decodeURIComponent(req.params.pageName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const sets = [];
    const vals = [];

    const candidates = {
      feature_flag:                 req.body.Feature_Flag,
      feature_flag_status:          req.body.Feature_Flag_Status,
      production_deployment_status: req.body.Production_Deployment_Status,
      sort_order:                   req.body.sort_order,
    };
    if (req.body.Release_Date !== undefined) candidates.release_date = req.body.Release_Date || null;

    for (const [col, val] of Object.entries(candidates)) {
      if (val !== undefined) { vals.push(val); sets.push(`${col} = $${vals.length}`); }
    }

    if (sets.length) {
      vals.push(pid(req));       const pidIdx  = vals.length;
      vals.push(req.params.name); const nameIdx = vals.length;
      vals.push(pageName);        const pageIdx = vals.length;

      const { rowCount } = await client.query(
        `UPDATE pages SET ${sets.join(', ')}
         WHERE module_id = (SELECT id FROM modules WHERE project_id = $${pidIdx} AND name = $${nameIdx})
           AND page_name = $${pageIdx}`,
        vals
      );
      if (!rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `Page "${pageName}" not found in module "${req.params.name}"` });
      }
    }

    const result = await fetchModule(client, pid(req), req.params.name);
    await client.query('COMMIT');
    res.json({ message: 'Page updated', data: result });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/modules/:name/pages/:pageName
router.delete('/:name/pages/:pageName', requireWrite, async (req, res) => {
  const pageName = decodeURIComponent(req.params.pageName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const { rowCount } = await client.query(
      `DELETE FROM pages
       WHERE module_id = (SELECT id FROM modules WHERE project_id = $1 AND name = $2)
         AND page_name = $3`,
      [pid(req), req.params.name, pageName]
    );

    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Page "${pageName}" not found in module "${req.params.name}"` });
    }

    const result = await fetchModule(client, pid(req), req.params.name);
    await client.query('COMMIT');
    res.json({ message: 'Page deleted', data: result });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Out-of-scope pages ────────────────────────────────────────────

// POST /api/modules/:name/out-of-scope
router.post('/:name/out-of-scope', requireWrite, async (req, res) => {
  const { page_name } = req.body;
  if (!page_name) return res.status(400).json({ error: 'page_name required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const mod = await client.query(
      'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
      [pid(req), req.params.name]
    );
    if (!mod.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Module "${req.params.name}" not found` });
    }

    await client.query(
      `INSERT INTO out_of_scope_pages (project_id, module_id, page_name)
       VALUES ($1, $2, $3) ON CONFLICT (module_id, page_name) DO NOTHING`,
      [pid(req), mod.rows[0].id, page_name]
    );

    const result = await fetchModule(client, pid(req), req.params.name);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Out-of-scope page added', data: result });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/modules/:name/out-of-scope/:pageName
router.delete('/:name/out-of-scope/:pageName', requireWrite, async (req, res) => {
  const pageName = decodeURIComponent(req.params.pageName);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx(req));

    const { rowCount } = await client.query(
      `DELETE FROM out_of_scope_pages
       WHERE module_id = (SELECT id FROM modules WHERE project_id = $1 AND name = $2)
         AND page_name = $3`,
      [pid(req), req.params.name, pageName]
    );

    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `Out-of-scope page "${pageName}" not found in module "${req.params.name}"` });
    }

    const result = await fetchModule(client, pid(req), req.params.name);
    await client.query('COMMIT');
    res.json({ message: 'Out-of-scope page removed', data: result });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  } finally { client.release(); }
});

module.exports = router;
