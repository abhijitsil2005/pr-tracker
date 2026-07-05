const express = require('express');
const router = express.Router();
const dataService = require('../services/dynamoService');
const { requireProject } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;

// GET /api/lookup/modules
router.get('/modules', async (req, res) => {
  try {
    res.json(await dataService.getModuleNames(pid(req)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/modules/:moduleName/pages
router.get('/modules/:moduleName/pages', async (req, res) => {
  try {
    const pages = await dataService.getPagesForModule(pid(req), req.params.moduleName);
    res.json(pages);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/team
router.get('/team', async (req, res) => {
  try {
    res.json(await dataService.getTeam(pid(req)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/developers
router.get('/developers', async (req, res) => {
  try {
    res.json(await dataService.getDevelopers(pid(req)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/reviewers
router.get('/reviewers', async (req, res) => {
  try {
    res.json(await dataService.getReviewers(pid(req)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/timeline
router.get('/timeline', async (req, res) => {
  try {
    res.json(await dataService.getReleaseTimeline(pid(req)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lookup/module-pages
router.get('/module-pages', async (req, res) => {
  try {
    res.json(await dataService.getModulePages(pid(req)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
