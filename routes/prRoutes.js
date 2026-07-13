const express = require('express');
const router = express.Router();
const { pool, query } = require('../services/pgClient');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;
const ctx = (req) => ({ project_id: req.user.project_id });

// Full PR SELECT
const PR_SELECT = `
  SELECT
    p.id,
    p.project_id,
    p.pr_number                AS "PR",
    p.title                    AS "Title",
    p.description              AS "Description",
    p.additional_details       AS "Additional_Details",
    m.name                     AS "Module",
    p.developer                AS "Developer",
    p.reviewer                 AS "Reviewer",
    p.type                     AS "Type",
    p.status                   AS "Status",
    p.user_story               AS "User_Story",
    p.raised_date              AS "PR Raised Date",
    p.first_response_date      AS "PR First Response Date",
    p.approved_date            AS "PR Approved Date",
    p.merged_date              AS "PR Merged Date",
    p.dev_sprint               AS "Dev_Sprint",
    p.testing_sprint           AS "Testing_Sprint",
    p.target_release           AS "Target_Release",
    p.task                     AS "Task",
    p.release_date             AS "Release_Date",
    p.created_at,
    p.updated_at,
    COALESCE(
      (SELECT array_agg(pp.page_name ORDER BY pp.page_name)
       FROM pr_pages pp WHERE pp.pr_id = p.id),
      ARRAY[]::text[]
    ) AS "Page",
    COALESCE(
      (SELECT array_agg(d.dependent_pr_number ORDER BY d.dependent_pr_number)
       FROM pr_dependencies d WHERE d.pr_id = p.id),
      ARRAY[]::int[]
    ) AS "Dependent_PRs"
  FROM prs p
  LEFT JOIN modules m ON m.id = p.module_id`;

// Insert pr_pages and pr_dependencies for a PR within an open transaction
async function insertPRRelations(client, projectId, prId, pages, deps) {
  for (const pageName of (pages || [])) {
    await client.query(
      `INSERT INTO pr_pages (project_id, pr_id, page_name)
       VALUES ($1, $2, $3) ON CONFLICT (pr_id, page_name) DO NOTHING`,
      [projectId, prId, pageName]
    );
  }
  for (const depNum of (deps || [])) {
    await client.query(
      `INSERT INTO pr_dependencies (pr_id, project_id, dependent_pr_number)
       VALUES ($1, $2, $3) ON CONFLICT (pr_id, dependent_pr_number) DO NOTHING`,
      [prId, projectId, depNum]
    );
  }
}

// Keep a PR's entry in the Releases page's Modules→Pages tree (release_modules/
// release_pages) in step with its Target_Release: drop it from whichever release
// it used to point to, and add it to the release matching the new date.
// release_pages.pr_number is a separate, manually-set value from prs.target_release —
// nothing else keeps them in sync, so without this the PR keeps showing under its
// old release forever and never appears under the new one.
async function syncPRReleasePages(client, projectId, {
  prNumber, oldModule, oldPages, newModule, newPages, oldTargetRelease, newTargetRelease, task,
}) {
  // Only clear out the PR's old release/module placement when it's actually
  // moving (release or module changed). Otherwise — e.g. a Task-only edit
  // that re-triggers this sync with the same release+module — deleting here
  // would remove the very row the INSERT below is about to re-create, so
  // its ON CONFLICT never fires and the fresh INSERT (which doesn't carry
  // feature_flag/feature_flag_status) silently resets those to defaults.
  const locationChanged = oldTargetRelease !== newTargetRelease || oldModule !== newModule;
  if (locationChanged && oldTargetRelease && oldModule) {
    await client.query(
      `DELETE FROM release_pages
       WHERE pr_number = $1
         AND release_module_id IN (
           SELECT rm.id FROM release_modules rm
           JOIN releases r ON r.id = rm.release_id
           WHERE r.project_id = $2 AND r.release_date = $3 AND rm.module_name = $4
         )`,
      [prNumber, projectId, oldTargetRelease, oldModule]
    );
  }

  if (!newTargetRelease) return { synced: false };
  if (!newModule || !newPages.length) {
    return { synced: false, reason: 'PR has no module/pages to sync to a release' };
  }

  const { rows: relRows } = await client.query(
    'SELECT id, release_number FROM releases WHERE project_id = $1 AND release_date = $2',
    [projectId, newTargetRelease]
  );
  if (!relRows.length) {
    return { synced: false, reason: `No release found with date ${newTargetRelease}` };
  }
  const { id: releaseId, release_number: releaseNumber } = relRows[0];

  const { rows: rmRows } = await client.query(
    `INSERT INTO release_modules (project_id, release_id, module_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (release_id, module_name) DO UPDATE SET module_name = EXCLUDED.module_name
     RETURNING id`,
    [projectId, releaseId, newModule]
  );
  const releaseModuleId = rmRows[0].id;

  for (const pageName of newPages) {
    await client.query(
      `INSERT INTO release_pages (project_id, release_module_id, page_name, pr_number, task)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (release_module_id, page_name) DO UPDATE
         SET pr_number = EXCLUDED.pr_number, task = EXCLUDED.task`,
      [projectId, releaseModuleId, pageName, prNumber, task || null]
    );
  }

  return { synced: true, releaseNumber };
}

// Only Target_Release/Module/Page/Task affect what shows on the Releases page,
// and only when the PR is (or was) actually attached to a release — skip the
// sync entirely for unrelated edits (Reviewer, Status, dates, ...) so those
// don't pay for extra release_modules/release_pages round-trips.
async function maybeSyncPRReleasePages(client, projectId, before, body) {
  const releaseRelevantChange =
    body.Target_Release !== undefined ||
    body.Module         !== undefined ||
    body.Page            !== undefined ||
    body.Task            !== undefined;
  const effectiveTargetRelease = body.Target_Release !== undefined ? body.Target_Release : before.Target_Release;

  if (!releaseRelevantChange || !(before.Target_Release || effectiveTargetRelease)) {
    return { synced: false };
  }

  return syncPRReleasePages(client, projectId, {
    prNumber:         before.PR,
    oldModule:        before.Module,
    oldPages:         before.Page || [],
    newModule:        body.Module !== undefined ? body.Module : before.Module,
    newPages:         body.Page   !== undefined ? body.Page   : (before.Page || []),
    oldTargetRelease: before.Target_Release,
    newTargetRelease: effectiveTargetRelease,
    task:             body.Task !== undefined ? body.Task : before.Task,
  });
}

// Build a dynamic SET clause from a body object; returns { sets, vals }
// Caller appends WHERE params after vals.
async function buildPRSets(client, projectId, body) {
  const sets = [];
  const vals = [];
  const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

  if (body.PR              !== undefined) push('pr_number',           Number(body.PR));
  if (body.Title           !== undefined) push('title',               body.Title           || null);
  if (body.Description     !== undefined) push('description',         body.Description     || null);
  if (body.Additional_Details !== undefined) push('additional_details', body.Additional_Details || null);
  if (body.Developer       !== undefined) push('developer',           body.Developer       || null);
  if (body.Reviewer        !== undefined) push('reviewer',            body.Reviewer        || null);
  if (body.Type            !== undefined) push('type',                body.Type            || 'Development');
  if (body.Status          !== undefined) push('status',              body.Status          || null);
  if (body.User_Story      !== undefined) push('user_story',          body.User_Story      || null);
  if (body['PR Raised Date']         !== undefined) push('raised_date',          body['PR Raised Date']         || null);
  if (body['PR First Response Date'] !== undefined) push('first_response_date',  body['PR First Response Date'] || null);
  if (body['PR Approved Date']       !== undefined) push('approved_date',        body['PR Approved Date']       || null);
  if (body['PR Merged Date']         !== undefined) push('merged_date',          body['PR Merged Date']         || null);
  if (body.Dev_Sprint      !== undefined) push('dev_sprint',          body.Dev_Sprint      || null);
  if (body.Testing_Sprint  !== undefined) push('testing_sprint',      body.Testing_Sprint  || null);
  if (body.Target_Release  !== undefined) push('target_release',      body.Target_Release  || null);
  if (body.Task            !== undefined) push('task',                body.Task            || null);
  if (body.Release_Date    !== undefined) push('release_date',        body.Release_Date    || null);

  if (body.Module !== undefined) {
    let moduleId = null;
    if (body.Module) {
      const { rows } = await client.query(
        'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
        [projectId, body.Module]
      );
      moduleId = rows[0]?.id || null;
    }
    push('module_id', moduleId);
  }

  return { sets, vals };
}

// ── Routes ────────────────────────────────────────────────────────

// GET /api/prs
router.get('/', async (req, res) => {
  try {
    const { module, developer, status, reviewer } = req.query;
    const conditions = ['p.project_id = $1'];
    const vals = [pid(req)];

    if (module)    { vals.push(module.toLowerCase());           conditions.push(`LOWER(m.name) = $${vals.length}`); }
    if (developer) { vals.push(developer.toLowerCase());        conditions.push(`LOWER(p.developer) = $${vals.length}`); }
    if (status)    { vals.push(`%${status.toLowerCase()}%`);   conditions.push(`LOWER(p.status) LIKE $${vals.length}`); }
    if (reviewer)  { vals.push(reviewer.toLowerCase());         conditions.push(`LOWER(p.reviewer) = $${vals.length}`); }

    const { rows } = await query(
      `${PR_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY p.pr_number, p.created_at`,
      vals,
      ctx(req)
    );
    res.json({ count: rows.length, data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/prs/by-id/:id
router.get('/by-id/:id', async (req, res) => {
  try {
    const { rows } = await query(
      `${PR_SELECT} WHERE p.id = $1 AND p.project_id = $2`,
      [req.params.id, pid(req)],
      ctx(req)
    );
    if (!rows.length) return res.status(404).json({ error: `PR record ${req.params.id} not found` });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/prs/:prNumber
router.get('/:prNumber', async (req, res) => {
  try {
    const { rows } = await query(
      `${PR_SELECT} WHERE p.project_id = $1 AND p.pr_number = $2 ORDER BY p.created_at`,
      [pid(req), Number(req.params.prNumber)],
      ctx(req)
    );
    if (!rows.length) return res.status(404).json({ error: `PR ${req.params.prNumber} not found` });
    res.json(rows.length === 1 ? rows[0] : rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/prs
router.post('/', requireWrite, async (req, res) => {
  const body = req.body;
  if (!body.PR) return res.status(400).json({ error: 'PR number is required' });

  const pages = Array.isArray(body.Page) ? body.Page : (body.Page ? [body.Page] : []);
  const deps  = Array.isArray(body.Dependent_PRs) ? body.Dependent_PRs.map(Number) : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let moduleId = null;
    if (body.Module) {
      const { rows } = await client.query(
        'SELECT id FROM modules WHERE project_id = $1 AND name = $2',
        [pid(req), body.Module]
      );
      moduleId = rows[0]?.id || null;
    }

    const { rows } = await client.query(
      `INSERT INTO prs
         (project_id, pr_number, module_id, developer, reviewer, type, status, user_story,
          raised_date, first_response_date, approved_date, merged_date,
          dev_sprint, testing_sprint, target_release, task,
          title, description, additional_details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        pid(req), Number(body.PR), moduleId,
        body.Developer || null,     body.Reviewer || null,
        body.Type || 'Development', body.Status   || null,
        body.User_Story || null,
        body['PR Raised Date']         || null,
        body['PR First Response Date'] || null,
        body['PR Approved Date']       || null,
        body['PR Merged Date']         || null,
        body.Dev_Sprint     || null, body.Testing_Sprint || null,
        body.Target_Release || null, body.Task           || null,
        body.Title || null, body.Description || null, body.Additional_Details || null,
      ]
    );
    const prId = rows[0].id;

    await insertPRRelations(client, pid(req), prId, pages, deps);

    const { rows: created } = await client.query(`${PR_SELECT} WHERE p.id = $1`, [prId]);
    const sync = await maybeSyncPRReleasePages(
      client, pid(req),
      { PR: created[0].PR, Target_Release: null, Module: null, Page: [], Task: null },
      body
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'PR created', data: created[0], sync });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: e.message });
  } finally { client.release(); }
});

// PUT /api/prs/by-pr/:prNumber  — update all rows sharing this PR number
router.put('/by-pr/:prNumber', requireWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: prRows } = await client.query(
      'SELECT id FROM prs WHERE project_id = $1 AND pr_number = $2',
      [pid(req), Number(req.params.prNumber)]
    );
    if (!prRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `PR ${req.params.prNumber} not found` });
    }

    const body = { ...req.body };
    if (body.Dependent_PRs) body.Dependent_PRs = body.Dependent_PRs.map(Number);

    const { sets, vals } = await buildPRSets(client, pid(req), body);
    const results = [];
    const syncs = [];

    for (const { id } of prRows) {
      const { rows: beforeRows } = await client.query(`${PR_SELECT} WHERE p.id = $1`, [id]);
      const before = beforeRows[0];

      if (sets.length) {
        await client.query(
          `UPDATE prs SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`,
          [...vals, id]
        );
      }

      if (body.Page !== undefined) {
        const pages = Array.isArray(body.Page) ? body.Page : (body.Page ? [body.Page] : []);
        await client.query('DELETE FROM pr_pages WHERE pr_id = $1', [id]);
        await insertPRRelations(client, pid(req), id, pages, null);
      }

      if (body.Dependent_PRs !== undefined) {
        await client.query('DELETE FROM pr_dependencies WHERE pr_id = $1', [id]);
        await insertPRRelations(client, pid(req), id, null, body.Dependent_PRs);
      }

      syncs.push(await maybeSyncPRReleasePages(client, pid(req), before, body));

      const { rows: updated } = await client.query(`${PR_SELECT} WHERE p.id = $1`, [id]);
      if (updated.length) results.push(updated[0]);
    }

    await client.query('COMMIT');
    res.json({ message: 'PR updated', data: results, sync: syncs.length === 1 ? syncs[0] : syncs });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  } finally { client.release(); }
});

// PUT /api/prs/:id  — update single row by UUID
router.put('/:id', requireWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const check = await client.query(`${PR_SELECT} WHERE p.id = $1 AND p.project_id = $2`, [req.params.id, pid(req)]);
    if (!check.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `PR record ${req.params.id} not found` });
    }
    const before = check.rows[0];

    const body = { ...req.body };
    if (body.PR)            body.PR = Number(body.PR);
    if (body.Dependent_PRs) body.Dependent_PRs = body.Dependent_PRs.map(Number);
    if (body.Page && !Array.isArray(body.Page)) body.Page = [body.Page];

    const { sets, vals } = await buildPRSets(client, pid(req), body);

    if (sets.length) {
      await client.query(
        `UPDATE prs SET ${sets.join(', ')} WHERE id = $${vals.length + 1}`,
        [...vals, req.params.id]
      );
    }

    if (body.Page !== undefined) {
      await client.query('DELETE FROM pr_pages WHERE pr_id = $1', [req.params.id]);
      await insertPRRelations(client, pid(req), req.params.id, body.Page, null);
    }

    if (body.Dependent_PRs !== undefined) {
      await client.query('DELETE FROM pr_dependencies WHERE pr_id = $1', [req.params.id]);
      await insertPRRelations(client, pid(req), req.params.id, null, body.Dependent_PRs);
    }

    const sync = await maybeSyncPRReleasePages(client, pid(req), before, body);

    const { rows: updated } = await client.query(`${PR_SELECT} WHERE p.id = $1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ message: 'PR updated', data: updated[0], sync });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/prs/:id
router.delete('/:id', requireWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      'SELECT id, pr_number, module_id FROM prs WHERE id = $1 AND project_id = $2',
      [req.params.id, pid(req)]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `PR record ${req.params.id} not found` });
    }
    const { pr_number, module_id } = rows[0];

    // Soft-clear this PR number from any release pages
    await client.query(
      `UPDATE release_pages SET pr_number = NULL
       WHERE project_id = $1 AND pr_number = $2`,
      [pid(req), pr_number]
    );

    // Delete cascades to pr_pages and pr_dependencies
    await client.query('DELETE FROM prs WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.json({ message: `PR #${pr_number} deleted` });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  } finally { client.release(); }
});

// POST /api/prs/:id/comments  — PR_Comments not in PG schema
router.post('/:id/comments', requireWrite, async (req, res) => {
  res.status(501).json({ error: 'PR comments are not supported in the PostgreSQL schema. Add a pr_comments table to enable this feature.' });
});

module.exports = router;
