const express = require('express');
const router  = express.Router();
const ds      = require('../services/dynamoService');
const { authenticate, requireCompanyAdmin } = require('../middleware/auth');

// All company routes require authentication
router.use(authenticate);

// GET /api/companies/my — current user's company info
router.get('/my', async (req, res) => {
  try {
    if (!req.user.company_id) return res.status(404).json({ error: 'No company assigned to your account' });
    const company = await ds.getCompany(req.user.company_id);
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json(company);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/companies/my — update company (CompanyAdmin only)
router.put('/my', requireCompanyAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const updated = await ds.updateCompany(req.user.company_id, { name: name.trim() });
    res.json({ message: 'Company updated', data: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
