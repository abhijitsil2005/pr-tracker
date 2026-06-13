const express = require('express');
const router = express.Router();
const dataService = require('../services/dynamoService');

// GET /api/lookup/modules
router.get('/modules', async (req, res) => {
  try {
    res.json(await dataService.getModuleNames());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/modules/:moduleName/pages
router.get('/modules/:moduleName/pages', async (req, res) => {
  try {
    const pages = await dataService.getPagesForModule(req.params.moduleName);
    res.json(pages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/team
router.get('/team', async (req, res) => {
  try {
    res.json(await dataService.getTeam());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/developers
router.get('/developers', async (req, res) => {
  try {
    res.json(await dataService.getDevelopers());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/reviewers
router.get('/reviewers', async (req, res) => {
  try {
    res.json(await dataService.getReviewers());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/timeline
router.get('/timeline', async (req, res) => {
  try {
    res.json(await dataService.getReleaseTimeline());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/module-pages  — full ModulePages table
router.get('/module-pages', async (req, res) => {
  try {
    res.json(await dataService.getModulePages());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
