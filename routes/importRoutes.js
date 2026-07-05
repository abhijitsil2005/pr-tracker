const express        = require('express');
const router         = express.Router();
const path           = require('path');
const fs             = require('fs');
const { randomUUID } = require('crypto');
const ds             = require('../services/dynamoService');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject, requireWrite);

const pid = (req) => req.user.project_id;

const STATUS_MAP = {
  'deployed to prod':      'Done',
  'ready for deployment':  'In Progress',
  'pr in review':          'In Review',
  'merged + testing':      'In Review',
  'development':           'In Progress',
  'not started':           'Pending',
  'out of scope':          null,
};

function mapStatus(raw) {
  const key = (raw || '').toLowerCase().trim();
  return key in STATUS_MAP ? STATUS_MAP[key] : 'Pending';
}

function parsePRNumbers(field) {
  if (!field) return [];
  return field.split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(n => n > 0 && !isNaN(n));
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

// POST /api/import/tracker
router.post('/tracker', async (req, res) => {
  try {
    const jsonPath = path.join(__dirname, '../uploads/tracker.json');
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: 'tracker.json not found in uploads/' });
    }

    const raw  = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw.replace(/\\\t/g, '\\\\t'));
    const week = currentWeekStart();
    const projectId = pid(req);

    const [existingAssignments, allPRDetails] = await Promise.all([
      ds.getStatusAssignments(projectId),
      ds.getPRs(projectId),
    ]);

    const assignmentIndex = new Map();
    existingAssignments.forEach(a => {
      const key = `${(a.Module || '').toLowerCase()}|||${(a.Page || '').toLowerCase()}`;
      assignmentIndex.set(key, a);
    });

    const prUpdateMap = new Map();
    let created = 0, updated = 0, prUpdated = 0, skipped = 0;

    for (const row of data) {
      const module    = (row['Module']              || '').trim();
      const page      = (row['Modules/ Pages']      || '').trim();
      const poc       = (row['POC']                 || '').trim();
      const rawPR     = (row['PR']                  || '').trim();
      const rawStatus = (row['Status']              || '').trim();
      const sprint    = (row['Sprint']              || '').trim() || null;
      const task      = (row['US#']                 || '').trim() || null;
      const comments  = row['Additional Comments']  || '';

      const mappedStatus = mapStatus(rawStatus);
      if (mappedStatus === null) { skipped++; continue; }
      if (!module && !page && !poc) { skipped++; continue; }

      const prNumbers    = parsePRNumbers(rawPR);
      const primaryPR    = prNumbers[0] || null;
      const activityLogs = parseComments(comments);
      const now          = new Date().toISOString();

      prNumbers.forEach(num => {
        const acc = prUpdateMap.get(num) || {};
        if (task)   acc.Task       = task;
        if (sprint) acc.Dev_Sprint = sprint;
        prUpdateMap.set(num, acc);
      });

      const key      = `${module.toLowerCase()}|||${page.toLowerCase()}`;
      const existing = assignmentIndex.get(key);

      if (existing) {
        const existingLogs  = existing.ActivityLog || [];
        const existingNotes = new Set(existingLogs.map(l => (l.note || '').toLowerCase().trim()));
        const newLogs = activityLogs.filter(l => !existingNotes.has((l.note || '').toLowerCase().trim()));
        const mergedLogs = [...existingLogs, ...newLogs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const updatedItem = {
          ...existing,
          project_id:  projectId,
          Developer:   poc      || existing.Developer,
          Status:      mappedStatus,
          PR:          primaryPR != null ? primaryPR : existing.PR,
          Task:        task     !== null ? task     : existing.Task,
          Sprint:      sprint   !== null ? sprint   : existing.Sprint,
          ActivityLog: mergedLogs,
          UpdatedAt:   now,
        };
        await ds.putStatusAssignment(updatedItem);
        assignmentIndex.set(key, updatedItem);
        updated++;
      } else {
        const actLog = activityLogs.length
          ? activityLogs
          : [{ timestamp: now, note: 'Imported from tracker.json', type: 'created' }];
        const item = {
          id:          randomUUID(),
          project_id:  projectId,
          Developer:   poc    || 'Unknown',
          Module:      module || null,
          Page:        page   || null,
          Week:        week,
          PR:          primaryPR,
          Status:      mappedStatus,
          Task:        task   || null,
          Sprint:      sprint || null,
          ActivityLog: actLog,
          CreatedAt:   now,
          UpdatedAt:   now,
        };
        await ds.putStatusAssignment(item);
        assignmentIndex.set(key, item);
        created++;
      }
    }

    for (const [prNum, updates] of prUpdateMap.entries()) {
      if (!Object.keys(updates).length) continue;
      const records = allPRDetails.filter(p => Number(p.PR) === prNum);
      for (const rec of records) {
        await ds.updatePR(rec.id, updates);
        prUpdated++;
      }
    }

    res.json({ message: 'Import complete', created, updated, skipped, prUpdated });
  } catch (e) {
    console.error('Import error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Sprint date helpers ────────────────────────────────────────────

function sprintDateToISO(str) {
  const [m, d, y] = str.trim().split('/').map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function normaliseDateStr(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const parts = str.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts.map(Number);
    const year = y < 100 ? 2000 + y : y;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

function findSprintForDate(isoDate, sprintList) {
  if (!isoDate) return null;
  for (const s of sprintList) {
    if (isoDate >= s.StartDate && isoDate <= s.EndDate) return s.Sprint;
  }
  return null;
}

// GET /api/import/sprints
router.get('/sprints', async (req, res) => {
  try {
    const sprints = await ds.getSprints(pid(req));
    sprints.sort((a, b) => a.StartDate.localeCompare(b.StartDate));
    res.json(sprints);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/import/sprints
router.post('/sprints', async (req, res) => {
  try {
    const jsonPath = path.join(__dirname, '../uploads/sprint.json');
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: 'sprint.json not found in uploads/' });
    }

    const raw       = fs.readFileSync(jsonPath, 'utf8');
    const rawSprints = JSON.parse(raw);
    const projectId = pid(req);

    const sprintList = rawSprints.map(s => ({
      Sprint:    String(s.Sprint),
      StartDate: sprintDateToISO(s['Start Date']),
      EndDate:   sprintDateToISO(s['End Date']),
    }));

    for (const s of sprintList) {
      await ds.upsertSprint(projectId, s);
    }

    const [allPRs, allAssignments] = await Promise.all([
      ds.getPRs(projectId),
      ds.getStatusAssignments(projectId),
    ]);

    const assignmentsByPR = new Map();
    for (const a of allAssignments) {
      const prNum = a.PR != null ? Number(a.PR) : null;
      if (prNum == null) continue;
      if (!assignmentsByPR.has(prNum)) assignmentsByPR.set(prNum, []);
      assignmentsByPR.get(prNum).push(a);
    }

    let prsUpdated = 0, assignmentsUpdated = 0, skipped = 0;

    for (const pr of allPRs) {
      const raisedDate = normaliseDateStr(pr['PR Raised Date']);
      if (!raisedDate) { skipped++; continue; }
      const sprint = findSprintForDate(raisedDate, sprintList);
      if (!sprint) { skipped++; continue; }
      if (pr.Dev_Sprint !== sprint) {
        await ds.updatePR(pr.id, { Dev_Sprint: sprint });
        prsUpdated++;
      }
      const linked = assignmentsByPR.get(Number(pr.PR)) || [];
      for (const a of linked) {
        if (a.Sprint !== sprint) {
          const updatedA = { ...a, Sprint: sprint, UpdatedAt: new Date().toISOString() };
          await ds.putStatusAssignment(updatedA);
          assignmentsUpdated++;
        }
      }
    }

    res.json({
      message: 'Sprint sync complete',
      sprintsSeeded: sprintList.length,
      prsUpdated,
      assignmentsUpdated,
      skipped,
    });
  } catch (e) {
    console.error('Sprint sync error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
