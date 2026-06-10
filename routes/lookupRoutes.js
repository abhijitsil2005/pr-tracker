const express = require('express');
const router = express.Router();
const dataService = require('../services/dataService');

// GET /api/lookup/modules
router.get('/modules', (req, res) => {
  try {
    res.json(dataService.getModuleNames());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/modules/:moduleName/pages
router.get('/modules/:moduleName/pages', (req, res) => {
  try {
    const pages = dataService.getPagesForModule(req.params.moduleName);
    res.json(pages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/team
router.get('/team', (req, res) => {
  try {
    res.json(dataService.getTeam());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/developers
router.get('/developers', (req, res) => {
  try {
    res.json(dataService.getDevelopers());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/reviewers
router.get('/reviewers', (req, res) => {
  try {
    res.json(dataService.getReviewers());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/timeline
router.get('/timeline', (req, res) => {
  try {
    res.json(dataService.getReleaseTimeline());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/module-pages  — full Module_Pages.json
router.get('/module-pages', (req, res) => {
  try {
    res.json(dataService.getModulePages());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
