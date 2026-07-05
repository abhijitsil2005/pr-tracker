const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const ds      = require('../services/dynamoService');
const { authenticate, requireCompanyAdmin } = require('../middleware/auth');

router.use(authenticate, requireCompanyAdmin);

const VALID_COMPANY_ROLES = ['CompanyAdmin', 'CompanyReadOnly', null];
const VALID_PROJECT_ROLES = ['Admin', 'ReadWrite', 'ReadOnly'];

// GET /api/users — list all users in the company
router.get('/', async (req, res) => {
  try {
    const users = await ds.getUsersByCompany(req.user.company_id);
    res.json(users.map(u => ({
      email:               u.email,
      name:                u.name,
      company_role:        u.company_role || null,
      project_memberships: u.project_memberships || [],
      active:              u.active,
      created_at:          u.created_at,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/users — create user in the company
router.post('/', async (req, res) => {
  try {
    const { email, name, password, company_role } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (company_role !== undefined && !VALID_COMPANY_ROLES.includes(company_role)) {
      return res.status(400).json({ error: `company_role must be one of: CompanyAdmin, CompanyReadOnly, or null` });
    }

    const normalEmail = email.toLowerCase().trim();
    const existing = await ds.getUserByEmail(normalEmail);
    if (existing) return res.status(409).json({ error: 'User with this email already exists' });

    const password_hash = await bcrypt.hash(password, 10);
    const user = {
      email:               normalEmail,
      name:                name.trim(),
      company_id:          req.user.company_id,
      company_role:        company_role || null,
      project_memberships: [],
      password_hash,
      active:              true,
      created_at:          new Date().toISOString(),
    };
    await ds.upsertUser(user);
    res.status(201).json({ email: user.email, name: user.name, company_role: user.company_role, active: user.active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:email — update user (name, company_role, active, password)
router.put('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const user  = await ds.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'User does not belong to your company' });
    }

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name.trim();
    if (req.body.company_role !== undefined) {
      if (!VALID_COMPANY_ROLES.includes(req.body.company_role)) {
        return res.status(400).json({ error: `company_role must be CompanyAdmin, CompanyReadOnly, or null` });
      }
      updates.company_role = req.body.company_role;
    }
    if (typeof req.body.active === 'boolean') updates.active = req.body.active;
    if (Array.isArray(req.body.project_memberships)) {
      // Validate each membership
      for (const m of req.body.project_memberships) {
        if (!VALID_PROJECT_ROLES.includes(m.role)) {
          return res.status(400).json({ error: `project role must be one of: ${VALID_PROJECT_ROLES.join(', ')}` });
        }
      }
      updates.project_memberships = req.body.project_memberships;
    }
    if (req.body.password) {
      if (req.body.password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      updates.password_hash = await bcrypt.hash(req.body.password, 10);
    }

    const updated = { ...user, ...updates };
    await ds.upsertUser(updated);
    res.json({ email: updated.email, name: updated.name, company_role: updated.company_role, active: updated.active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:email — remove user
router.delete('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    if (email === req.user.email) return res.status(400).json({ error: 'Cannot delete your own account' });
    const user = await ds.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'User does not belong to your company' });
    }
    await ds.deleteUser(email);
    res.json({ message: `User ${email} deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
