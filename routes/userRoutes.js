const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { pool } = require('../services/pgClient');
const { authenticate, requireCompanyAdmin } = require('../middleware/auth');

router.use(authenticate, requireCompanyAdmin);

const VALID_COMPANY_ROLES = ['CompanyAdmin', 'CompanyReadOnly', null];
const VALID_PROJECT_ROLES = ['Admin', 'ReadWrite', 'ReadOnly'];

// Reusable SELECT that returns a user with project_memberships aggregated
const USER_SELECT = `
  SELECT
    u.email, u.name, u.company_role, u.active, u.created_at,
    COALESCE(
      (SELECT json_agg(json_build_object('project_id', pm.project_id, 'role', pm.role)
               ORDER BY pm.created_at)
       FROM project_members pm WHERE pm.user_email = u.email),
      '[]'::json
    ) AS project_memberships
  FROM users u`;

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `${USER_SELECT} WHERE u.company_id = $1 ORDER BY u.name`,
      [req.user.company_id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  const { email, name, password, company_role } = req.body;
  if (!email || !name || !password) {
    return res.status(400).json({ error: 'email, name and password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (company_role !== undefined && !VALID_COMPANY_ROLES.includes(company_role)) {
    return res.status(400).json({ error: 'company_role must be one of: CompanyAdmin, CompanyReadOnly, or null' });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, password_hash, company_id, company_role, active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING email, name, company_role, active`,
      [email.toLowerCase().trim(), name.trim(), password_hash, req.user.company_id, company_role || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'User with this email already exists' });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/users/:email
router.put('/:email', async (req, res) => {
  const email = req.params.email.toLowerCase();

  // Validate before opening a transaction
  if (req.body.company_role !== undefined && !VALID_COMPANY_ROLES.includes(req.body.company_role)) {
    return res.status(400).json({ error: 'company_role must be CompanyAdmin, CompanyReadOnly, or null' });
  }
  if (req.body.password && req.body.password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (Array.isArray(req.body.project_memberships)) {
    for (const m of req.body.project_memberships) {
      if (!VALID_PROJECT_ROLES.includes(m.role)) {
        return res.status(400).json({ error: `project role must be one of: ${VALID_PROJECT_ROLES.join(', ')}` });
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existing } = await client.query(
      'SELECT email, company_id FROM users WHERE email = $1',
      [email]
    );
    if (!existing.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User not found' });
    }
    if (existing[0].company_id !== req.user.company_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'User does not belong to your company' });
    }

    // Update users table (dynamic SET)
    const sets = [];
    const vals = [email];
    const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    if (req.body.name         !== undefined) push('name',         req.body.name.trim());
    if (req.body.company_role !== undefined) push('company_role', req.body.company_role || null);
    if (typeof req.body.active === 'boolean') push('active',      req.body.active);
    if (req.body.password) push('password_hash', await bcrypt.hash(req.body.password, 10));

    // Any of these change what an existing session is allowed to do — bump
    // token_version so already-issued JWTs are rejected on their next request
    // instead of staying valid until the 12h expiry (instant deprovisioning).
    const revokesSessions =
      req.body.company_role !== undefined ||
      typeof req.body.active === 'boolean' ||
      !!req.body.password;
    if (revokesSessions) sets.push('token_version = token_version + 1');

    if (sets.length) {
      await client.query(
        `UPDATE users SET ${sets.join(', ')} WHERE email = $1`,
        vals
      );
    }

    // Replace project memberships when supplied
    if (Array.isArray(req.body.project_memberships)) {
      await client.query('DELETE FROM project_members WHERE user_email = $1', [email]);
      for (const m of req.body.project_memberships) {
        await client.query(
          `INSERT INTO project_members (project_id, user_email, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (project_id, user_email) DO UPDATE SET role = $3`,
          [m.project_id, email, m.role]
        );
      }
    }

    await client.query('COMMIT');

    const { rows } = await pool.query(
      `${USER_SELECT} WHERE u.email = $1`,
      [email]
    );
    const u = rows[0];
    res.json({ email: u.email, name: u.name, company_role: u.company_role, active: u.active });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// DELETE /api/users/:email
router.delete('/:email', async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (email === req.user.email) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT company_id FROM users WHERE email = $1',
      [email]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (rows[0].company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'User does not belong to your company' });
    }
    // CASCADE removes project_members rows automatically
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    res.json({ message: `User ${email} deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
