const jwt = require('jsonwebtoken');
const { pool } = require('../services/pgClient');

if (!process.env.JWT_SECRET) {
  throw new Error(
    'JWT_SECRET environment variable is not set. Refusing to start with an insecure default — ' +
    'set JWT_SECRET to a long random value (e.g. `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"`).'
  );
}
const JWT_SECRET = process.env.JWT_SECRET;

// Verify JWT, then confirm the account is still active and the token hasn't
// been revoked (users.token_version is bumped on deactivation, company_role
// change, or password change) — this is what makes deprovisioning instant
// instead of "whenever the 12h token happens to expire".
async function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let decoded;
  try {
    decoded = jwt.verify(auth.slice(7), JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT active, token_version FROM users WHERE email = $1',
      [decoded.email]
    );
    const user = rows[0];
    if (!user || !user.active || user.token_version !== decoded.token_version) {
      return res.status(401).json({ error: 'Session no longer valid. Please log in again.' });
    }
    req.user = decoded;
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
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
