const express = require('express');
const router  = express.Router();
const { pool, query } = require('../services/pgClient');
const { authenticate, requireCompanyAdmin } = require('../middleware/auth');

router.use(authenticate);

// Helper: verify a project belongs to the caller's company; returns the row or null
async function getProjectForCompany(projectId, companyId) {
  const { rows } = await pool.query(
    'SELECT * FROM projects WHERE id = $1 AND company_id = $2',
    [projectId, companyId]
  );
  return rows[0] || null;
}

// Helper: true if the caller is a CompanyAdmin or an Admin of the specific project
function isAdmin(req, projectId) {
  return (
    req.user.company_role === 'CompanyAdmin' ||
    (req.user.project_id === projectId && req.user.role === 'Admin')
  );
}

// ── Projects ──────────────────────────────────────────────────────

// GET /api/projects
router.get('/', async (req, res) => {
  try {
    if (!req.user.company_id) return res.json([]);

    const isCompanyLevel =
      req.user.company_role === 'CompanyAdmin' ||
      req.user.company_role === 'CompanyReadOnly';

    if (isCompanyLevel) {
      const { rows } = await pool.query(
        'SELECT * FROM projects WHERE company_id = $1 AND active = true ORDER BY name',
        [req.user.company_id]
      );
      return res.json(rows);
    }

    // Regular user: only projects they have an explicit membership in
    const { rows } = await pool.query(
      `SELECT p.* FROM projects p
       INNER JOIN project_members pm ON pm.project_id = p.id AND pm.user_email = $1
       WHERE p.company_id = $2 AND p.active = true
       ORDER BY p.name`,
      [req.user.email, req.user.company_id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projects
router.post('/', requireCompanyAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO projects (company_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.user.company_id, name.trim(), description || '']
    );
    res.status(201).json({ message: 'Project created', data: rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/projects/:id
router.get('/:id', async (req, res) => {
  try {
    const project = await getProjectForCompany(req.params.id, req.user.company_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/projects/:id
router.put('/:id', async (req, res) => {
  try {
    const project = await getProjectForCompany(req.params.id, req.user.company_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!isAdmin(req, req.params.id)) {
      return res.status(403).json({ error: 'Admin access required to update project' });
    }

    const sets = [];
    const vals = [req.params.id];
    const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    const { name, description, active } = req.body;
    if (name        !== undefined) push('name',        name.trim());
    if (description !== undefined) push('description', description);
    if (typeof active === 'boolean') push('active',    active);

    if (!sets.length) return res.json({ message: 'Project updated', data: project });

    const { rows } = await pool.query(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      vals
    );
    res.json({ message: 'Project updated', data: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', requireCompanyAdmin, async (req, res) => {
  try {
    const project = await getProjectForCompany(req.params.id, req.user.company_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    await pool.query('DELETE FROM projects WHERE id = $1', [req.params.id]);
    res.json({ message: `Project "${project.name}" deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Project Members ───────────────────────────────────────────────

// GET /api/projects/:id/members
router.get('/:id/members', async (req, res) => {
  try {
    const project = await getProjectForCompany(req.params.id, req.user.company_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!isAdmin(req, req.params.id)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Company-level users always have implicit access; direct members have a row in project_members
    const { rows } = await pool.query(
      `SELECT
         u.email, u.name, u.active, u.company_role,
         pm.role AS project_role
       FROM users u
       LEFT JOIN project_members pm
         ON pm.user_email = u.email AND pm.project_id = $1
       WHERE u.company_id = $2
         AND (
           pm.project_id IS NOT NULL
           OR u.company_role IN ('CompanyAdmin', 'CompanyReadOnly')
         )
       ORDER BY u.name`,
      [req.params.id, req.user.company_id]
    );

    const members = rows.map(u => {
      let role;
      if (u.company_role === 'CompanyAdmin')     role = 'Admin (Company)';
      else if (u.company_role === 'CompanyReadOnly') role = 'ReadOnly (Company)';
      else role = u.project_role;
      return { email: u.email, name: u.name, role, active: u.active, company_role: u.company_role || null };
    }).filter(m => m.role);

    res.json(members);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projects/:id/members
router.post('/:id/members', async (req, res) => {
  try {
    const project = await getProjectForCompany(req.params.id, req.user.company_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!isAdmin(req, req.params.id)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'email and role required' });
    if (!['Admin', 'ReadWrite', 'ReadOnly'].includes(role)) {
      return res.status(400).json({ error: 'role must be Admin, ReadWrite, or ReadOnly' });
    }

    const normalEmail = email.toLowerCase().trim();

    const { rows: userRows } = await pool.query(
      'SELECT email, company_id FROM users WHERE email = $1',
      [normalEmail]
    );
    if (!userRows.length) return res.status(404).json({ error: 'User not found' });
    if (userRows[0].company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'User does not belong to your company' });
    }

    await pool.query(
      `INSERT INTO project_members (project_id, user_email, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_email) DO UPDATE SET role = $3`,
      [req.params.id, normalEmail, role]
    );
    res.json({ message: `${normalEmail} added to project with role ${role}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/projects/:id/members/:email
router.delete('/:id/members/:email', async (req, res) => {
  try {
    const project = await getProjectForCompany(req.params.id, req.user.company_id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!isAdmin(req, req.params.id)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const email = decodeURIComponent(req.params.email).toLowerCase();
    const { rowCount } = await pool.query(
      'DELETE FROM project_members WHERE project_id = $1 AND user_email = $2',
      [req.params.id, email]
    );
    if (!rowCount) return res.status(404).json({ error: 'User not found in project' });
    res.json({ message: `${email} removed from project` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
