const express = require('express');
const router  = express.Router();
const ds      = require('../services/dynamoService');
const { requireProject, requireWrite } = require('../middleware/auth');

router.use(requireProject);

const pid = (req) => req.user.project_id;

// GET /api/status?week=YYYY-MM-DD&developer=Name
router.get('/', async (req, res) => {
  try {
    let items = await ds.getStatusAssignments(pid(req));
    const { week, developer } = req.query;
    if (week)      items = items.filter(i => i.Week === week);
    if (developer) items = items.filter(i => i.Developer === developer);
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/status/:id
router.get('/:id', async (req, res) => {
  try {
    const item = await ds.getStatusAssignment(req.params.id);
    if (!item || item.project_id !== pid(req)) return res.status(404).json({ error: 'Assignment not found' });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/status
router.post('/', requireWrite, async (req, res) => {
  try {
    const item = await ds.addStatusAssignment(pid(req), req.body);
    res.status(201).json(item);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/status/:id
router.put('/:id', requireWrite, async (req, res) => {
  try {
    const item = await ds.updateStatusAssignment(req.params.id, req.body);
    res.json(item);
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

// DELETE /api/status/:id
router.delete('/:id', requireWrite, async (req, res) => {
  try {
    const item = await ds.getStatusAssignment(req.params.id);
    if (!item || item.project_id !== pid(req)) return res.status(404).json({ error: 'Assignment not found' });
    await ds.deleteStatusAssignment(req.params.id);
    res.json({ message: 'Assignment deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/status/:id/activity
router.post('/:id/activity', requireWrite, async (req, res) => {
  try {
    const item = await ds.addActivityToAssignment(req.params.id, req.body);
    res.status(201).json(item);
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

module.exports = router;
