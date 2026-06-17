const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const ds      = require('../services/dynamoService');
const { authenticate, requireAdmin } = require('../middleware/auth');

// All user routes require authentication + admin role
router.use(authenticate, requireAdmin);

const VALID_ROLES = ['Admin', 'ReadWrite', 'ReadOnly'];

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const users = await ds.getUsers();
    res.json(users.map(u => ({ email: u.email, name: u.name, role: u.role, active: u.active, created_at: u.created_at })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  try {
    const { email, name, role, password } = req.body;
    if (!email || !name || !role || !password) return res.status(400).json({ error: 'email, name, role and password required' });
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await ds.getUserByEmail(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'User with this email already exists' });

    const password_hash = await bcrypt.hash(password, 10);
    const user = {
      email:         email.toLowerCase().trim(),
      name:          name.trim(),
      role,
      password_hash,
      active:        true,
      created_at:    new Date().toISOString(),
    };
    await ds.upsertUser(user);
    res.status(201).json({ email: user.email, name: user.name, role: user.role, active: user.active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:email
router.put('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    const user = await ds.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updates = {};
    if (req.body.name)   updates.name   = req.body.name.trim();
    if (req.body.role) {
      if (!VALID_ROLES.includes(req.body.role)) return res.status(400).json({ error: `Role must be one of: ${VALID_ROLES.join(', ')}` });
      updates.role = req.body.role;
    }
    if (typeof req.body.active === 'boolean') updates.active = req.body.active;
    if (req.body.password) {
      if (req.body.password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      updates.password_hash = await bcrypt.hash(req.body.password, 10);
    }

    const updated = { ...user, ...updates };
    await ds.upsertUser(updated);
    res.json({ email: updated.email, name: updated.name, role: updated.role, active: updated.active });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/users/:email
router.delete('/:email', async (req, res) => {
  try {
    const email = req.params.email.toLowerCase();
    if (email === req.user.email) return res.status(400).json({ error: 'Cannot delete your own account' });
    await ds.deleteUser(email);
    res.json({ message: `User ${email} deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
