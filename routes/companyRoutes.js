const express = require('express');
const router  = express.Router();
const { pool } = require('../services/pgClient');
const { authenticate, requireCompanyAdmin } = require('../middleware/auth');

router.use(authenticate);

// GET /api/companies/my
router.get('/my', async (req, res) => {
  try {
    if (!req.user.company_id) return res.status(404).json({ error: 'No company assigned to your account' });
    const { rows } = await pool.query(
      'SELECT * FROM companies WHERE id = $1',
      [req.user.company_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Company not found' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/companies/my
router.put('/my', requireCompanyAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await pool.query(
      'UPDATE companies SET name = $1 WHERE id = $2 RETURNING *',
      [name.trim(), req.user.company_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Company not found' });
    res.json({ message: 'Company updated', data: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
