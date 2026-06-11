const express = require('express');
const router = express.Router();
const ds = require('../services/dataService');

// GET  /api/modules                    → all modules
router.get('/', (req, res) => {
  try { res.json(ds.getModulePages()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET  /api/modules/:name              → single module
router.get('/:name', (req, res) => {
  try {
    const all = ds.getModulePages();
    const mod = all.find(m => m.Module === req.params.name);
    if (!mod) return res.status(404).json({ error: `Module "${req.params.name}" not found` });
    res.json(mod);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/modules                    → add module
router.post('/', (req, res) => {
  try {
    const { Module, Pages, OutOfScope } = req.body;
    if (!Module) return res.status(400).json({ error: 'Module name required' });
    const result = ds.addModule({ Module, Pages: Pages || [], OutOfScope: OutOfScope || [] });
    res.status(201).json({ message: 'Module created', data: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT  /api/modules/:name              → rename / update top-level fields
router.put('/:name', (req, res) => {
  try {
    const result = ds.updateModule(req.params.name, req.body);
    res.json({ message: 'Module updated', data: result });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

// DELETE /api/modules/:name
router.delete('/:name', (req, res) => {
  try {
    const removed = ds.deleteModule(req.params.name);
    res.json({ message: `Module "${req.params.name}" deleted`, data: removed });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

// ── Pages within a module ─────────────────────────────────────

// POST /api/modules/:name/pages
router.post('/:name/pages', (req, res) => {
  try {
    const { page_name, Feature_Flag, Feature_Flag_Status,
            Client_Demo_Status, Client_Demo_Date, Production_Deployment_Status } = req.body;
    if (!page_name) return res.status(400).json({ error: 'page_name required' });
    const result = ds.addPageToModule(req.params.name, {
      page_name,
      Feature_Flag:                 Feature_Flag || '',
      Feature_Flag_Status:          Feature_Flag_Status || 'Enabled',
      Client_Demo_Status:           Client_Demo_Status || 'Pending',
      Client_Demo_Date:             Client_Demo_Date || '',
      Production_Deployment_Status: Production_Deployment_Status || 'Pending',
    });
    res.status(201).json({ message: 'Page added', data: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT  /api/modules/:name/pages/:pageName
router.put('/:name/pages/:pageName', (req, res) => {
  try {
    const pageName = decodeURIComponent(req.params.pageName);
    const result = ds.updatePageInModule(req.params.name, pageName, req.body);
    res.json({ message: 'Page updated', data: result });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

// DELETE /api/modules/:name/pages/:pageName
router.delete('/:name/pages/:pageName', (req, res) => {
  try {
    const pageName = decodeURIComponent(req.params.pageName);
    const removed = ds.deletePageFromModule(req.params.name, pageName);
    res.json({ message: 'Page deleted', data: removed });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

// ── Out-of-scope pages ────────────────────────────────────────

// POST /api/modules/:name/out-of-scope
router.post('/:name/out-of-scope', (req, res) => {
  try {
    const { page_name } = req.body;
    if (!page_name) return res.status(400).json({ error: 'page_name required' });
    const result = ds.addOutOfScopePage(req.params.name, page_name);
    res.status(201).json({ message: 'Out-of-scope page added', data: result });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// DELETE /api/modules/:name/out-of-scope/:pageName
router.delete('/:name/out-of-scope/:pageName', (req, res) => {
  try {
    const pageName = decodeURIComponent(req.params.pageName);
    const result = ds.removeOutOfScopePage(req.params.name, pageName);
    res.json({ message: 'Out-of-scope page removed', data: result });
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 500).json({ error: e.message });
  }
});

module.exports = router;
