const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const router   = express.Router();
const { pool } = require('../services/pgClient');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await pool.query(
      'SELECT email, name, password_hash, company_id, company_role, active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Build accessible project list
    let projects = [];
    if (user.company_id) {
      const isCompanyLevel =
        user.company_role === 'CompanyAdmin' ||
        user.company_role === 'CompanyReadOnly';

      if (isCompanyLevel) {
        const companyRole = user.company_role === 'CompanyAdmin' ? 'Admin' : 'ReadOnly';
        const { rows: allProjects } = await pool.query(
          'SELECT id, name, description FROM projects WHERE company_id = $1 AND active = true ORDER BY name',
          [user.company_id]
        );
        projects = allProjects.map(p => ({ id: p.id, name: p.name, description: p.description || '', role: companyRole }));
      } else {
        const { rows: memberProjects } = await pool.query(
          `SELECT p.id, p.name, p.description, pm.role
           FROM projects p
           JOIN project_members pm ON pm.project_id = p.id AND pm.user_email = $1
           WHERE p.company_id = $2 AND p.active = true
           ORDER BY p.name`,
          [user.email, user.company_id]
        );
        projects = memberProjects.map(p => ({ id: p.id, name: p.name, description: p.description || '', role: p.role }));
      }
    }

    const token = jwt.sign(
      { email: user.email, name: user.name, company_id: user.company_id || null, company_role: user.company_role || null },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: { email: user.email, name: user.name, company_id: user.company_id, company_role: user.company_role },
      projects,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/select-project
router.post('/select-project', authenticate, async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    const { rows: userRows } = await pool.query(
      'SELECT email, name, company_id, company_role FROM users WHERE email = $1',
      [req.user.email]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });
    const user = userRows[0];

    const { rows: projectRows } = await pool.query(
      'SELECT id, name, company_id, active FROM projects WHERE id = $1',
      [project_id]
    );
    const project = projectRows[0];
    if (!project || !project.active) return res.status(404).json({ error: 'Project not found' });

    if (user.company_id !== project.company_id) {
      return res.status(403).json({ error: 'Project does not belong to your company' });
    }

    // Resolve effective role
    let effectiveRole = null;
    if (user.company_role === 'CompanyAdmin')    effectiveRole = 'Admin';
    else if (user.company_role === 'CompanyReadOnly') effectiveRole = 'ReadOnly';
    else {
      const { rows: memberRows } = await pool.query(
        'SELECT role FROM project_members WHERE project_id = $1 AND user_email = $2',
        [project_id, user.email]
      );
      effectiveRole = memberRows[0]?.role || null;
    }

    if (!effectiveRole) return res.status(403).json({ error: 'You do not have access to this project' });

    const token = jwt.sign(
      {
        email:        user.email,
        name:         user.name,
        company_id:   user.company_id,
        company_role: user.company_role || null,
        project_id:   project.id,
        project_name: project.name,
        role:         effectiveRole,
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, project: { id: project.id, name: project.name }, role: effectiveRole });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', authenticate, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) return res.status(400).json({ error: 'Both passwords required' });
    if (new_password.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    const { rows } = await pool.query(
      'SELECT password_hash FROM users WHERE email = $1',
      [req.user.email]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const password_hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [password_hash, req.user.email]);
    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
