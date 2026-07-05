const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'pr-tracker-jwt-secret';

// Verify JWT and attach req.user
function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Token must include an active project selection
function requireProject(req, res, next) {
  if (!req.user || !req.user.project_id) {
    return res.status(403).json({ error: 'No project selected. Call /api/auth/select-project first.' });
  }
  next();
}

// Role hierarchy:
//   company_role = 'CompanyAdmin'  → effective role = 'Admin' in any project
//   company_role = 'CompanyReadOnly' → effective role = 'ReadOnly' in any project
//   otherwise → use the project-level role from the token (set by select-project)
//
// req.user.role is the EFFECTIVE role after select-project resolves the hierarchy.

function requireWrite(req, res, next) {
  const role = req.user?.role;
  if (role !== 'Admin' && role !== 'ReadWrite') {
    return res.status(403).json({ error: 'Write access required' });
  }
  next();
}

function requireProjectAdmin(req, res, next) {
  if (req.user?.role !== 'Admin') {
    return res.status(403).json({ error: 'Project admin access required' });
  }
  next();
}

function requireCompanyAdmin(req, res, next) {
  if (req.user?.company_role !== 'CompanyAdmin') {
    return res.status(403).json({ error: 'Company admin access required' });
  }
  next();
}

// Legacy alias — kept for routes that still use requireAdmin
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'Admin' && req.user?.company_role !== 'CompanyAdmin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, requireProject, requireWrite, requireProjectAdmin, requireCompanyAdmin, requireAdmin, JWT_SECRET };
