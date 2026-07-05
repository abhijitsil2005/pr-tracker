const express = require('express');
const router  = express.Router();
const ds      = require('../services/dynamoService');
const { authenticate, requireCompanyAdmin, requireProjectAdmin } = require('../middleware/auth');

router.use(authenticate);

// GET /api/projects — list all accessible projects for the logged-in user
router.get('/', async (req, res) => {
  try {
    if (!req.user.company_id) return res.json([]);
    const allProjects = await ds.getProjectsByCompany(req.user.company_id);
    const active = allProjects.filter(p => p.active !== false);

    if (req.user.company_role === 'CompanyAdmin' || req.user.company_role === 'CompanyReadOnly') {
      return res.json(active);
    }

    // Return only projects this user has a membership in
    const memberships = new Set((req.user.project_memberships || []).map(m => m.project_id));
    res.json(active.filter(p => memberships.has(p.id)));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projects — create project (CompanyAdmin only)
router.post('/', requireCompanyAdmin, async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const project = await ds.createProject({
      company_id:  req.user.company_id,
      name,
      description: description || '',
    });
    res.status(201).json({ message: 'Project created', data: project });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// GET /api/projects/:id — get one project (must have access)
router.get('/:id', async (req, res) => {
  try {
    const project = await ds.getProject(req.params.id);
    if (!project || project.company_id !== req.user.company_id) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(project);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/projects/:id — update project (CompanyAdmin or ProjectAdmin)
router.put('/:id', async (req, res) => {
  try {
    const project = await ds.getProject(req.params.id);
    if (!project || project.company_id !== req.user.company_id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Only CompanyAdmin or users with Admin role in THIS project can update it
    const isCompanyAdmin  = req.user.company_role === 'CompanyAdmin';
    const isProjectAdmin  = req.user.project_id === req.params.id && req.user.role === 'Admin';
    if (!isCompanyAdmin && !isProjectAdmin) {
      return res.status(403).json({ error: 'Admin access required to update project' });
    }

    const { name, description, active } = req.body;
    const updates = {};
    if (name        !== undefined) updates.name        = name.trim();
    if (description !== undefined) updates.description = description;
    if (typeof active === 'boolean') updates.active    = active;

    const updated = await ds.updateProject(req.params.id, updates);
    res.json({ message: 'Project updated', data: updated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/projects/:id — delete project (CompanyAdmin only)
router.delete('/:id', requireCompanyAdmin, async (req, res) => {
  try {
    const project = await ds.getProject(req.params.id);
    if (!project || project.company_id !== req.user.company_id) {
      return res.status(404).json({ error: 'Project not found' });
    }
    await ds.deleteProject(req.params.id);
    res.json({ message: `Project "${project.name}" deleted` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Project Members ───────────────────────────────────────────────

// GET /api/projects/:id/members — list members (CompanyAdmin or ProjectAdmin)
router.get('/:id/members', async (req, res) => {
  try {
    const project = await ds.getProject(req.params.id);
    if (!project || project.company_id !== req.user.company_id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const isCompanyAdmin = req.user.company_role === 'CompanyAdmin';
    const isProjectAdmin = req.user.project_id === req.params.id && req.user.role === 'Admin';
    if (!isCompanyAdmin && !isProjectAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const users = await ds.getUsersByCompany(req.user.company_id);
    const members = users
      .filter(u => {
        if (u.company_role === 'CompanyAdmin' || u.company_role === 'CompanyReadOnly') return true;
        return (u.project_memberships || []).some(m => m.project_id === req.params.id);
      })
      .map(u => {
        let role;
        if (u.company_role === 'CompanyAdmin')    role = 'Admin (Company)';
        else if (u.company_role === 'CompanyReadOnly') role = 'ReadOnly (Company)';
        else {
          const m = (u.project_memberships || []).find(m => m.project_id === req.params.id);
          role = m ? m.role : null;
        }
        return { email: u.email, name: u.name, role, active: u.active, company_role: u.company_role || null };
      })
      .filter(m => m.role);

    res.json(members);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/projects/:id/members — add/update a member's role
router.post('/:id/members', async (req, res) => {
  try {
    const project = await ds.getProject(req.params.id);
    if (!project || project.company_id !== req.user.company_id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const isCompanyAdmin = req.user.company_role === 'CompanyAdmin';
    const isProjectAdmin = req.user.project_id === req.params.id && req.user.role === 'Admin';
    if (!isCompanyAdmin && !isProjectAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { email, role } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'email and role required' });
    if (!['Admin', 'ReadWrite', 'ReadOnly'].includes(role)) {
      return res.status(400).json({ error: 'role must be Admin, ReadWrite, or ReadOnly' });
    }

    const user = await ds.getUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.company_id !== req.user.company_id) {
      return res.status(403).json({ error: 'User does not belong to your company' });
    }

    const memberships = (user.project_memberships || []).filter(m => m.project_id !== req.params.id);
    memberships.push({ project_id: req.params.id, role });
    await ds.upsertUser({ ...user, project_memberships: memberships });
    res.json({ message: `${email} added to project with role ${role}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/projects/:id/members/:email — remove a member from the project
router.delete('/:id/members/:email', async (req, res) => {
  try {
    const project = await ds.getProject(req.params.id);
    if (!project || project.company_id !== req.user.company_id) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const isCompanyAdmin = req.user.company_role === 'CompanyAdmin';
    const isProjectAdmin = req.user.project_id === req.params.id && req.user.role === 'Admin';
    if (!isCompanyAdmin && !isProjectAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const email = decodeURIComponent(req.params.email).toLowerCase();
    const user  = await ds.getUserByEmail(email);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const memberships = (user.project_memberships || []).filter(m => m.project_id !== req.params.id);
    await ds.upsertUser({ ...user, project_memberships: memberships });
    res.json({ message: `${email} removed from project` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
