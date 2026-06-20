const express = require('express');
const router = express.Router();
const dataService = require('../services/dynamoService');

// GET /api/prs  — list all, supports ?module=&developer=&status=&reviewer= filters
router.get('/', async (req, res) => {
  try {
    let prs = await dataService.getPRs();
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

// GET /api/prs/:prNumber
router.get('/:prNumber', async (req, res) => {
  try {
    const pr = await dataService.getPRByNumber(req.params.prNumber);
    if (!pr) return res.status(404).json({ error: `PR ${req.params.prNumber} not found` });
    res.json(pr);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/prs  — add new PR
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body.PR) return res.status(400).json({ error: 'PR number is required' });

    const newPR = {
      PR: Number(body.PR),
      Type: body.Type || 'Development',
      Developer: body.Developer || null,
      Module: body.Module || null,
      Page: Array.isArray(body.Page) ? body.Page : (body.Page ? [body.Page] : []),
      Status: body.Status || null,
      'PR Raised Date': body['PR Raised Date'] || null,
      Reviewer: body.Reviewer || null,
      'PR First Response Date': body['PR First Response Date'] || null,
      'PR Approved Date': body['PR Approved Date'] || null,
      'PR Merged Date': body['PR Merged Date'] || null,
      Dev_Sprint: body.Dev_Sprint || null,
      Testing_Sprint: body.Testing_Sprint || null,
      Dependent_PRs: Array.isArray(body.Dependent_PRs) ? body.Dependent_PRs.map(Number) : [],
      Target_Release: body.Target_Release || null,
      PR_Comments: body.PR_Comments || [],
    };

    const created = await dataService.addPR(newPR);
    let syncResult = { synced: false };
    try { syncResult = await dataService.syncPRToRelease(created); } catch (e) { syncResult = { synced: false, reason: e.message }; }
    res.status(201).json({ message: 'PR created', data: created, sync: syncResult });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/prs/:prNumber  — full or partial update
router.put('/:prNumber', async (req, res) => {
  try {
    const updates = { ...req.body };
    if (updates.PR) updates.PR = Number(updates.PR);
    if (updates.Dependent_PRs) updates.Dependent_PRs = updates.Dependent_PRs.map(Number);
    if (updates.Page && !Array.isArray(updates.Page)) updates.Page = [updates.Page];
    const updated = await dataService.updatePR(req.params.prNumber, updates);
    let syncResult = { synced: false };
    try { syncResult = await dataService.syncPRToRelease(updated); } catch (e) { syncResult = { synced: false, reason: e.message }; }
    res.json({ message: 'PR updated', data: updated, sync: syncResult });
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : 400;
    res.status(code).json({ error: e.message });
  }
});

// DELETE /api/prs/:prNumber
router.delete('/:prNumber', async (req, res) => {
  try {
    const prNum = Number(req.params.prNumber);
    // Remove this PR's pages from all releases before deleting the PR record
    await dataService.removePRFromOtherReleases(prNum, null);
    await dataService.deletePR(prNum);
    res.json({ message: `PR ${req.params.prNumber} deleted` });
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

// POST /api/prs/:prNumber/comments  — add a comment to a PR
router.post('/:prNumber/comments', async (req, res) => {
  try {
    const pr = await dataService.getPRByNumber(req.params.prNumber);
    if (!pr) return res.status(404).json({ error: `PR ${req.params.prNumber} not found` });
    const comments = [...(pr.PR_Comments || []), req.body];
    const updated = await dataService.updatePR(req.params.prNumber, { PR_Comments: comments });
    res.status(201).json({ message: 'Comment added', data: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
