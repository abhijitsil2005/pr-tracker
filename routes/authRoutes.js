const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const router   = express.Router();
const ds       = require('../services/dynamoService');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

// Resolve effective role for a user in a given project
function resolveEffectiveRole(user, projectId) {
  if (user.company_role === 'CompanyAdmin')     return 'Admin';
  if (user.company_role === 'CompanyReadOnly')  return 'ReadOnly';
  const membership = (user.project_memberships || []).find(m => m.project_id === projectId);
  return membership ? membership.role : null;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await ds.getUserByEmail(email.toLowerCase().trim());
    if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    // Build list of accessible projects for this user
    let projects = [];
    if (user.company_id) {
      const allProjects = await ds.getProjectsByCompany(user.company_id);
      const activeProjects = allProjects.filter(p => p.active !== false);

      if (user.company_role === 'CompanyAdmin' || user.company_role === 'CompanyReadOnly') {
        // Company-level roles see all projects
        const companyRole = user.company_role === 'CompanyAdmin' ? 'Admin' : 'ReadOnly';
        projects = activeProjects.map(p => ({ id: p.id, name: p.name, description: p.description || '', role: companyRole }));
      } else {
        // Project-specific memberships only
        const memberships = user.project_memberships || [];
        projects = memberships
          .map(m => {
            const proj = activeProjects.find(p => p.id === m.project_id);
            return proj ? { id: proj.id, name: proj.name, description: proj.description || '', role: m.role } : null;
          })
          .filter(Boolean);
      }
    }

    const tokenPayload = {
      email:        user.email,
      name:         user.name,
      company_id:   user.company_id   || null,
      company_role: user.company_role || null,
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });

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
// Called after login to pick an active project. Returns a project-scoped token.
router.post('/select-project', authenticate, async (req, res) => {
  try {
    const { project_id } = req.body;
    if (!project_id) return res.status(400).json({ error: 'project_id required' });

    const user    = await ds.getUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const project = await ds.getProject(project_id);
    if (!project || project.active === false) return res.status(404).json({ error: 'Project not found' });

    // Verify company match
    if (user.company_id !== project.company_id) {
      return res.status(403).json({ error: 'Project does not belong to your company' });
    }

    const effectiveRole = resolveEffectiveRole(user, project_id);
    if (!effectiveRole) return res.status(403).json({ error: 'You do not have access to this project' });

    const tokenPayload = {
      email:        user.email,
      name:         user.name,
      company_id:   user.company_id,
      company_role: user.company_role || null,
      project_id:   project.id,
      project_name: project.name,
      role:         effectiveRole,
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '12h' });

    res.json({
      token,
      project: { id: project.id, name: project.name },
      role:    effectiveRole,
    });
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

    const user = await ds.getUserByEmail(req.user.email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const password_hash = await bcrypt.hash(new_password, 10);
    await ds.upsertUser({ ...user, password_hash });
    res.json({ message: 'Password changed successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
