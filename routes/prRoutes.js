const express = require('express');
const router = express.Router();
const dataService = require('../services/dynamoService');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;

// GET /api/prs
router.get('/', async (req, res) => {
  try {
    let prs = await dataService.getPRs(pid(req));
    const { module, developer, status, reviewer } = req.query;
    if (module)    prs = prs.filter(p => p.Module?.toLowerCase() === module.toLowerCase());
    if (developer) prs = prs.filter(p => p.Developer?.toLowerCase() === developer.toLowerCase());
    if (status)    prs = prs.filter(p => p.Status?.toLowerCase().includes(status.toLowerCase()));
    if (reviewer)  prs = prs.filter(p => p.Reviewer?.toLowerCase() === reviewer.toLowerCase());
    res.json({ count: prs.length, data: prs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/prs/by-id/:id
router.get('/by-id/:id', async (req, res) => {
  try {
    const pr = await dataService.getPRById(req.params.id);
    if (!pr || pr.project_id !== pid(req)) return res.status(404).json({ error: `PR record ${req.params.id} not found` });
    res.json(pr);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/prs/:prNumber
router.get('/:prNumber', async (req, res) => {
  try {
    const prs = await dataService.getPRByNumber(pid(req), req.params.prNumber);
    if (!prs.length) return res.status(404).json({ error: `PR ${req.params.prNumber} not found` });
    res.json(prs.length === 1 ? prs[0] : prs);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/prs
router.post('/', requireWrite, async (req, res) => {
  try {
    const body = req.body;
    if (!body.PR) return res.status(400).json({ error: 'PR number is required' });
    const newPR = {
      PR:                    Number(body.PR),
      Type:                  body.Type || 'Development',
      Developer:             body.Developer || null,
      Module:                body.Module || null,
      Page:                  Array.isArray(body.Page) ? body.Page : (body.Page ? [body.Page] : []),
      Status:                body.Status || null,
      'PR Raised Date':      body['PR Raised Date'] || null,
      Reviewer:              body.Reviewer || null,
      'PR First Response Date': body['PR First Response Date'] || null,
      'PR Approved Date':    body['PR Approved Date'] || null,
      'PR Merged Date':      body['PR Merged Date'] || null,
      Dev_Sprint:            body.Dev_Sprint || null,
      Testing_Sprint:        body.Testing_Sprint || null,
      Dependent_PRs:         Array.isArray(body.Dependent_PRs) ? body.Dependent_PRs.map(Number) : [],
      Target_Release:        body.Target_Release || null,
      Task:                  body.Task || null,
      PR_Comments:           body.PR_Comments || [],
    };
    const created = await dataService.addPR(pid(req), newPR);
    let syncResult = { synced: false };
    try { syncResult = await dataService.syncPRToRelease(created); } catch (e) { syncResult = { synced: false, reason: e.message }; }
    res.status(201).json({ message: 'PR created', data: created, sync: syncResult });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/prs/by-pr/:prNumber
router.put('/by-pr/:prNumber', requireWrite, async (req, res) => {
  try {
    const prs = await dataService.getPRByNumber(pid(req), req.params.prNumber);
    if (!prs.length) return res.status(404).json({ error: `PR ${req.params.prNumber} not found` });
    const updates = { ...req.body };
    if (updates.Dependent_PRs) updates.Dependent_PRs = updates.Dependent_PRs.map(Number);
    const results = [];
    for (const pr of prs) {
      const updated = await dataService.updatePR(pr.id, updates);
      results.push(updated);
    }
    res.json({ message: 'PR updated', data: results });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

// PUT /api/prs/:id
router.put('/:id', requireWrite, async (req, res) => {
  try {
    const pr = await dataService.getPRById(req.params.id);
    if (!pr || pr.project_id !== pid(req)) return res.status(404).json({ error: `PR record ${req.params.id} not found` });

    const updates = { ...req.body };
    if (updates.PR) updates.PR = Number(updates.PR);
    if (updates.Dependent_PRs) updates.Dependent_PRs = updates.Dependent_PRs.map(Number);
    if (updates.Page && !Array.isArray(updates.Page)) updates.Page = [updates.Page];
    let oldTargetRelease = null;
    if ('Target_Release' in updates) oldTargetRelease = pr.Target_Release || null;
    const updated = await dataService.updatePR(req.params.id, updates);
    let syncResult = { synced: false };
    const SYNC_FIELDS = new Set(['Target_Release', 'Module', 'Page']);
    if (Object.keys(updates).some(k => SYNC_FIELDS.has(k))) {
      try { syncResult = await dataService.syncPRToRelease(updated, oldTargetRelease); } catch (e) { syncResult = { synced: false, reason: e.message }; }
    }
    res.json({ message: 'PR updated', data: updated, sync: syncResult });
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
});

// DELETE /api/prs/:id
router.delete('/:id', requireWrite, async (req, res) => {
  try {
    const pr = await dataService.getPRById(req.params.id);
    if (!pr || pr.project_id !== pid(req)) return res.status(404).json({ error: `PR record ${req.params.id} not found` });
    await dataService.removePRFromOtherReleases(pid(req), pr.PR, pr.Module, null);
    await dataService.deletePR(req.params.id);
    res.json({ message: `PR #${pr.PR} (${pr.Module || 'no module'}) deleted` });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

// POST /api/prs/:id/comments
router.post('/:id/comments', requireWrite, async (req, res) => {
  try {
    const pr = await dataService.getPRById(req.params.id);
    if (!pr || pr.project_id !== pid(req)) return res.status(404).json({ error: `PR record ${req.params.id} not found` });
    const comments = [...(pr.PR_Comments || []), req.body];
    const updated = await dataService.updatePR(req.params.id, { PR_Comments: comments });
    res.status(201).json({ message: 'Comment added', data: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
