const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { pool } = require('../services/pgClient');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject, requireWrite);

const pid = (req) => req.user.project_id;

// ── Shared helpers ────────────────────────────────────────────────

const STATUS_MAP = {
  'deployed to prod':     'Done',
  'ready for deployment': 'In Progress',
  'pr in review':         'In Review',
  'merged + testing':     'In Review',
  'development':          'In Progress',
  'not started':          'Pending',
  'out of scope':         null,
};

function mapStatus(raw) {
  const key = (raw || '').toLowerCase().trim();
  return key in STATUS_MAP ? STATUS_MAP[key] : 'Pending';
}

function parsePRNumbers(field) {
  if (!field) return [];
  return field.split(/[\n,]+/).map(s => s.trim()).filter(Boolean)
    .map(Number).filter(n => n > 0 && !isNaN(n));
}

function parseComments(text) {
  if (!text) return [];
  const year = new Date().getFullYear();
  return text.split('\n').map(line => {
    const m = line.trim().match(/^(\d{1,2})\/(\d{1,2})\s*[-–]\s*(.+)$/);
    if (!m) return null;
    const [, mon, day, note] = m;
    const ts = new Date(year, parseInt(mon, 10) - 1, parseInt(day, 10));
    if (isNaN(ts.getTime())) return null;
    return { timestamp: ts.toISOString(), note: note.trim(), type: 'update' };
  }).filter(Boolean);
}

function currentWeekStart() {
  const d   = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// ── POST /api/import/tracker ──────────────────────────────────────

router.post('/tracker', async (req, res) => {
  try {
    const jsonPath = path.join(__dirname, '../uploads/tracker.json');
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: 'tracker.json not found in uploads/' });
    }

    const raw  = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw.replace(/\\\t/g, '\\\\t'));
    const week      = currentWeekStart();
    const projectId = pid(req);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Pre-load module name → id map
      const { rows: modRows } = await client.query(
        'SELECT id, name FROM modules WHERE project_id = $1',
        [projectId]
      );
      const moduleIdMap = new Map(modRows.map(m => [m.name.toLowerCase(), m.id]));

      // Pre-load existing assignments with their activity logs
      const { rows: existingRows } = await client.query(
        `SELECT
           sa.id,
           sa.developer,
           m.name           AS module,
           sa.page_name     AS page,
           sa.linked_pr_number AS pr,
           sa.status,
           sa.task,
           sa.sprint,
           COALESCE(
             (SELECT json_agg(json_build_object(
                'note',      al.note,
                'timestamp', al.created_at,
                'type',      al.type
              ) ORDER BY al.created_at)
              FROM activity_logs al WHERE al.assignment_id = sa.id),
             '[]'::json
           ) AS activity_log
         FROM status_assignments sa
         LEFT JOIN modules m ON m.id = sa.module_id
         WHERE sa.project_id = $1`,
        [projectId]
      );

      // Index by "module|||page" (case-insensitive)
      const assignmentIndex = new Map();
      existingRows.forEach(a => {
        const key = `${(a.module || '').toLowerCase()}|||${(a.page || '').toLowerCase()}`;
        assignmentIndex.set(key, a);
      });

      // Pre-load PRs indexed by pr_number
      const { rows: prRows } = await client.query(
        'SELECT id, pr_number FROM prs WHERE project_id = $1',
        [projectId]
      );
      const prsByNumber = new Map();
      prRows.forEach(p => {
        if (!prsByNumber.has(p.pr_number)) prsByNumber.set(p.pr_number, []);
        prsByNumber.get(p.pr_number).push(p);
      });

      const prUpdateMap = new Map();
      let created = 0, updated = 0, prUpdated = 0, skipped = 0;

      for (const row of data) {
        const module    = (row['Module']             || '').trim();
        const page      = (row['Modules/ Pages']     || '').trim();
        const poc       = (row['POC']                || '').trim();
        const rawPR     = (row['PR']                 || '').trim();
        const rawStatus = (row['Status']             || '').trim();
        const sprint    = (row['Sprint']             || '').trim() || null;
        const task      = (row['US#']                || '').trim() || null;
        const comments  = row['Additional Comments'] || '';

        const mappedStatus = mapStatus(rawStatus);
        if (mappedStatus === null)          { skipped++; continue; }
        if (!module && !page && !poc)       { skipped++; continue; }

        const prNumbers    = parsePRNumbers(rawPR);
        const primaryPR    = prNumbers[0] || null;
        const activityLogs = parseComments(comments);

        prNumbers.forEach(num => {
          const acc = prUpdateMap.get(num) || {};
          if (task)   acc.Task       = task;
          if (sprint) acc.Dev_Sprint = sprint;
          prUpdateMap.set(num, acc);
        });

        const key      = `${module.toLowerCase()}|||${page.toLowerCase()}`;
        const existing = assignmentIndex.get(key);

        if (existing) {
          // Merge activity logs, deduplicating by note
          const existingNotes = new Set(
            (existing.activity_log || []).map(l => (l.note || '').toLowerCase().trim())
          );
          const newLogs = activityLogs.filter(
            l => !existingNotes.has((l.note || '').toLowerCase().trim())
          );

          await client.query(
            `UPDATE status_assignments SET
               developer        = $1,
               status           = $2,
               linked_pr_number = $3,
               task             = $4,
               sprint           = $5
             WHERE id = $6`,
            [
              poc       || existing.developer,
              mappedStatus,
              primaryPR != null ? primaryPR : existing.pr,
              task      !== null ? task      : existing.task,
              sprint    !== null ? sprint    : existing.sprint,
              existing.id,
            ]
          );

          for (const log of newLogs) {
            await client.query(
              `INSERT INTO activity_logs (project_id, assignment_id, note, type, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [projectId, existing.id, log.note, log.type, log.timestamp]
            );
          }

          // Refresh index entry so later rows see updated state
          assignmentIndex.set(key, {
            ...existing,
            developer: poc || existing.developer,
            status: mappedStatus,
            pr: primaryPR != null ? primaryPR : existing.pr,
            task: task !== null ? task : existing.task,
            sprint: sprint !== null ? sprint : existing.sprint,
          });
          updated++;
        } else {
          const moduleId = moduleIdMap.get(module.toLowerCase()) || null;

          const { rows: newRows } = await client.query(
            `INSERT INTO status_assignments
               (project_id, developer, module_id, page_name, week_start,
                linked_pr_number, status, task, sprint)
             VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9)
             RETURNING id`,
            [
              projectId,
              poc    || 'Unknown',
              moduleId,
              page   || null,
              week,
              primaryPR,
              mappedStatus,
              task   || null,
              sprint || null,
            ]
          );
          const assignmentId = newRows[0].id;

          const actLog = activityLogs.length
            ? activityLogs
            : [{ timestamp: new Date().toISOString(), note: 'Imported from tracker.json', type: 'created' }];

          for (const log of actLog) {
            await client.query(
              `INSERT INTO activity_logs (project_id, assignment_id, note, type, created_at)
               VALUES ($1, $2, $3, $4, $5)`,
              [projectId, assignmentId, log.note, log.type, log.timestamp]
            );
          }

          assignmentIndex.set(key, { id: assignmentId, module, page, developer: poc || 'Unknown' });
          created++;
        }
      }

      // Apply accumulated PR updates
      for (const [prNum, updates] of prUpdateMap.entries()) {
        if (!Object.keys(updates).length) continue;
        const prs = prsByNumber.get(prNum) || [];
        for (const pr of prs) {
          const sets = [];
          const vals = [];
          if (updates.Task)       { vals.push(updates.Task);       sets.push(`task = $${vals.length}`); }
          if (updates.Dev_Sprint) { vals.push(updates.Dev_Sprint); sets.push(`dev_sprint = $${vals.length}`); }
          if (sets.length) {
            vals.push(pr.id);
            await client.query(
              `UPDATE prs SET ${sets.join(', ')} WHERE id = $${vals.length}`,
              vals
            );
            prUpdated++;
          }
        }
      }

      await client.query('COMMIT');
      res.json({ message: 'Import complete', created, updated, skipped, prUpdated });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Sprint date helpers ───────────────────────────────────────────

function sprintDateToISO(str) {
  const [m, d, y] = str.trim().split('/').map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function findSprintForDate(isoDate, sprintList) {
  if (!isoDate) return null;
  for (const s of sprintList) {
    if (isoDate >= s.StartDate && isoDate <= s.EndDate) return s.Sprint;
  }
  return null;
}

// ── GET /api/import/sprints ───────────────────────────────────────

router.get('/sprints', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT sprint_name AS "Sprint", start_date AS "StartDate", end_date AS "EndDate"
       FROM sprints WHERE project_id = $1 ORDER BY start_date`,
      [pid(req)]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/import/sprints ──────────────────────────────────────

router.post('/sprints', async (req, res) => {
  try {
    const jsonPath = path.join(__dirname, '../uploads/sprint.json');
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: 'sprint.json not found in uploads/' });
    }

    const rawSprints = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const projectId  = pid(req);

    // Build sprint list with ISO dates (used for both upsert and lookup)
    const sprintList = rawSprints.map(s => ({
      Sprint:    String(s.Sprint),
      StartDate: sprintDateToISO(s['Start Date']),
      EndDate:   sprintDateToISO(s['End Date']),
    }));

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Upsert all sprints
      for (const s of sprintList) {
        await client.query(
          `INSERT INTO sprints (project_id, sprint_name, start_date, end_date)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, sprint_name) DO UPDATE SET
             start_date = EXCLUDED.start_date,
             end_date   = EXCLUDED.end_date`,
          [projectId, s.Sprint, s.StartDate, s.EndDate]
        );
      }

      // Load all PRs (raised_date comes back as YYYY-MM-DD string from PG DATE column)
      const { rows: allPRs } = await client.query(
        'SELECT id, pr_number, dev_sprint, raised_date FROM prs WHERE project_id = $1',
        [projectId]
      );

      // Load all status assignments indexed by linked_pr_number
      const { rows: allAssignments } = await client.query(
        'SELECT id, sprint, linked_pr_number FROM status_assignments WHERE project_id = $1',
        [projectId]
      );
      const assignmentsByPR = new Map();
      for (const a of allAssignments) {
        if (a.linked_pr_number == null) continue;
        const num = Number(a.linked_pr_number);
        if (!assignmentsByPR.has(num)) assignmentsByPR.set(num, []);
        assignmentsByPR.get(num).push(a);
      }

      let prsUpdated = 0, assignmentsUpdated = 0, skipped = 0;

      for (const pr of allPRs) {
        const raisedDate = pr.raised_date; // already YYYY-MM-DD or null
        if (!raisedDate) { skipped++; continue; }

        const sprint = findSprintForDate(raisedDate, sprintList);
        if (!sprint) { skipped++; continue; }

        if (pr.dev_sprint !== sprint) {
          await client.query(
            'UPDATE prs SET dev_sprint = $1 WHERE id = $2',
            [sprint, pr.id]
          );
          prsUpdated++;
        }

        const linked = assignmentsByPR.get(Number(pr.pr_number)) || [];
        for (const a of linked) {
          if (a.sprint !== sprint) {
            await client.query(
              'UPDATE status_assignments SET sprint = $1 WHERE id = $2',
              [sprint, a.id]
            );
            assignmentsUpdated++;
          }
        }
      }

      await client.query('COMMIT');
      res.json({
        message: 'Sprint sync complete',
        sprintsSeeded: sprintList.length,
        prsUpdated,
        assignmentsUpdated,
        skipped,
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  } catch (e) {
    console.error('Sprint sync error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
