const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');

// GET /api/releases
router.get('/', (req, res) => {
  try {
    const releases = dataService.getProdReleases();
    res.json({ count: releases.length, data: releases });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/releases/:releaseNumber
router.get('/:releaseNumber', (req, res) => {
  try {
    const releases = dataService.getProdReleases();
    const rel = releases.find(r => String(r.Release_Number) === req.params.releaseNumber);
    if (!rel) return res.status(404).json({ error: `Release ${req.params.releaseNumber} not found` });
    res.json(rel);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/releases  — add a release entry
router.post('/', (req, res) => {
  try {
    const body = req.body;
    if (!body.Release_Number) return res.status(400).json({ error: 'Release_Number is required' });
    const result = dataService.upsertProdRelease(body);
    res.status(201).json({ message: 'Release created/updated', data: result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /api/releases/:releaseNumber
router.put('/:releaseNumber', (req, res) => {
  try {
    const releases = dataService.getProdReleases();
    const existing = releases.find(r => String(r.Release_Number) === req.params.releaseNumber);
    if (!existing) return res.status(404).json({ error: `Release ${req.params.releaseNumber} not found` });
    const result = dataService.upsertProdRelease({
      ...existing,
      ...req.body,
      Release_Number: existing.Release_Number,
    });
    res.json({ message: 'Release updated', data: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/releases/:releaseNumber
router.delete('/:releaseNumber', (req, res) => {
  try {
    const removed = dataService.deleteProdRelease(req.params.releaseNumber);
    res.json({ message: `Release ${req.params.releaseNumber} deleted`, data: removed });
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : 500;
    res.status(code).json({ error: e.message });
  }
});

// GET /api/releases/timeline/all — return Release_Timeline.json reference
router.get('/timeline/all', (req, res) => {
  try {
    res.json(dataService.getReleaseTimeline());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
