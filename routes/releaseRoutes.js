const express = require('express');
const router = express.Router();
const dataService = require('../services/dynamoService');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;

// GET /api/releases
router.get('/', async (req, res) => {
  try {
    const releases = await dataService.getProdReleases(pid(req));
    res.json({ count: releases.length, data: releases });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/releases/timeline/all
router.get('/timeline/all', async (req, res) => {
  try {
    res.json(await dataService.getReleaseTimeline(pid(req)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/releases/:releaseNumber
router.get('/:releaseNumber', async (req, res) => {
  try {
    const releases = await dataService.getProdReleases(pid(req));
    const rel = releases.find(r => String(r.Release_Number) === req.params.releaseNumber);
    if (!rel) return res.status(404).json({ error: `Release ${req.params.releaseNumber} not found` });
    res.json(rel);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/releases
router.post('/', requireWrite, async (req, res) => {
  try {
    const body = req.body;
    if (!body.Release_Number) return res.status(400).json({ error: 'Release_Number is required' });
    const result = await dataService.upsertProdRelease(pid(req), body);
    res.status(201).json({ message: 'Release created/updated', data: result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/releases/:releaseNumber
router.put('/:releaseNumber', requireWrite, async (req, res) => {
  try {
    const releases = await dataService.getProdReleases(pid(req));
    const existing = releases.find(r => String(r.Release_Number) === req.params.releaseNumber);
    if (!existing) return res.status(404).json({ error: `Release ${req.params.releaseNumber} not found` });
    const result = await dataService.upsertProdRelease(pid(req), {
      ...existing,
      ...req.body,
      Release_Number: existing.Release_Number,
    });
    res.json({ message: 'Release updated', data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/releases/:releaseNumber/complete
router.post('/:releaseNumber/complete', requireWrite, async (req, res) => {
  try {
    const result = await dataService.completeRelease(pid(req), req.params.releaseNumber);
    res.json({ message: `Release ${req.params.releaseNumber} completed`, ...result });
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

// DELETE /api/releases/:releaseNumber
router.delete('/:releaseNumber', requireWrite, async (req, res) => {
  try {
    await dataService.deleteProdRelease(pid(req), req.params.releaseNumber);
    res.json({ message: `Release ${req.params.releaseNumber} deleted` });
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

module.exports = router;
