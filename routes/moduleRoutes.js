const express = require('express');
const router = express.Router();
const ds = require('../services/dynamoService');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;

// GET /api/modules
router.get('/', async (req, res) => {
  try { res.json(await ds.getModulePages(pid(req))); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/modules/:name
router.get('/:name', async (req, res) => {
  try {
    const mod = await ds.getModulePage(pid(req), req.params.name);
    if (!mod) return res.status(404).json({ error: `Module "${req.params.name}" not found` });
    res.json(mod);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/modules
router.post('/', requireWrite, async (req, res) => {
  try {
    const { Module, Pages, OutOfScope } = req.body;
    if (!Module) return res.status(400).json({ error: 'Module name required' });
    const result = await ds.addModule(pid(req), { Module, Pages: Pages || [], OutOfScope: OutOfScope || [] });
    res.status(201).json({ message: 'Module created', data: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/modules/:name
router.put('/:name', requireWrite, async (req, res) => {
  try {
    const result = await ds.updateModule(pid(req), req.params.name, req.body);
    res.json({ message: 'Module updated', data: result });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

// DELETE /api/modules/:name
router.delete('/:name', requireWrite, async (req, res) => {
  try {
    await ds.deleteModule(pid(req), req.params.name);
    res.json({ message: `Module "${req.params.name}" deleted` });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

// ── Pages within a module ─────────────────────────────────────────

// POST /api/modules/:name/pages
router.post('/:name/pages', requireWrite, async (req, res) => {
  try {
    const { page_name, Feature_Flag, Feature_Flag_Status,
            Client_Demo_Status, Client_Demo_Date, Production_Deployment_Status,
            Release_Date } = req.body;
    if (!page_name) return res.status(400).json({ error: 'page_name required' });
    const result = await ds.addPageToModule(pid(req), req.params.name, {
      page_name,
      Feature_Flag:                 Feature_Flag || '',
      Feature_Flag_Status:          Feature_Flag_Status || 'Enabled',
      Client_Demo_Status:           Client_Demo_Status || 'Pending',
      Client_Demo_Date:             Client_Demo_Date || '',
      Production_Deployment_Status: Production_Deployment_Status || 'Pending',
      Release_Date:                 Release_Date || null,
    });
    res.status(201).json({ message: 'Page added', data: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/modules/:name/pages/:pageName
router.put('/:name/pages/:pageName', requireWrite, async (req, res) => {
  try {
    const pageName = decodeURIComponent(req.params.pageName);
    const result = await ds.updatePageInModule(pid(req), req.params.name, pageName, req.body);
    res.json({ message: 'Page updated', data: result });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

// DELETE /api/modules/:name/pages/:pageName
router.delete('/:name/pages/:pageName', requireWrite, async (req, res) => {
  try {
    const pageName = decodeURIComponent(req.params.pageName);
    const result = await ds.deletePageFromModule(pid(req), req.params.name, pageName);
    res.json({ message: 'Page deleted', data: result });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

// ── Out-of-scope pages ────────────────────────────────────────────

// POST /api/modules/:name/out-of-scope
router.post('/:name/out-of-scope', requireWrite, async (req, res) => {
  try {
    const { page_name } = req.body;
    if (!page_name) return res.status(400).json({ error: 'page_name required' });
    const result = await ds.addOutOfScopePage(pid(req), req.params.name, page_name);
    res.status(201).json({ message: 'Out-of-scope page added', data: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/modules/:name/out-of-scope/:pageName
router.delete('/:name/out-of-scope/:pageName', requireWrite, async (req, res) => {
  try {
    const pageName = decodeURIComponent(req.params.pageName);
    const result = await ds.removeOutOfScopePage(pid(req), req.params.name, pageName);
    res.json({ message: 'Out-of-scope page removed', data: result });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

module.exports = router;
