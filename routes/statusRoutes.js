const express = require('express');
const router  = express.Router();
const ds      = require('../services/dynamoService');

// GET /api/status?week=YYYY-MM-DD&developer=Name
router.get('/', async (req, res) => {
  try {
    let items = await ds.getStatusAssignments();
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
    if (!item) return res.status(404).json({ error: 'Assignment not found' });
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/status
router.post('/', async (req, res) => {
  try {
    const item = await ds.addStatusAssignment(req.body);
    res.status(201).json(item);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// PUT /api/status/:id
router.put('/:id', async (req, res) => {
  try {
    const item = await ds.updateStatusAssignment(req.params.id, req.body);
    res.json(item);
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

// DELETE /api/status/:id
router.delete('/:id', async (req, res) => {
  try {
    await ds.deleteStatusAssignment(req.params.id);
    res.json({ message: 'Assignment deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/status/:id/activity  — append a log entry
router.post('/:id/activity', async (req, res) => {
  try {
    const item = await ds.addActivityToAssignment(req.params.id, req.body);
    res.status(201).json(item);
  } catch (e) {
    res.status(e.message.includes('not found') ? 404 : 400).json({ error: e.message });
  }
});

module.exports = router;
