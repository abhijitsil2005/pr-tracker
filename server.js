const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const path    = require('path');
const fs      = require('fs');
const ds      = require('./services/dynamoService');
const { authenticate } = require('./middleware/auth');

const prRoutes      = require('./routes/prRoutes');
const releaseRoutes = require('./routes/releaseRoutes');
const syncRoutes    = require('./routes/syncRoutes');
const lookupRoutes  = require('./routes/lookupRoutes');
const moduleRoutes  = require('./routes/moduleRoutes');
const statusRoutes  = require('./routes/statusRoutes');
const authRoutes    = require('./routes/authRoutes');
const userRoutes    = require('./routes/userRoutes');
const importRoutes  = require('./routes/importRoutes');
const companyRoutes = require('./routes/companyRoutes');
const projectRoutes = require('./routes/projectRoutes');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Public routes
app.use('/api/auth', authRoutes);

// Protected API routes
// Note: requireProject is applied inside each route file for data routes
app.use('/api/prs',      authenticate, prRoutes);
app.use('/api/releases', authenticate, releaseRoutes);
app.use('/api/sync',     authenticate, syncRoutes);
app.use('/api/lookup',   authenticate, lookupRoutes);
app.use('/api/modules',  authenticate, moduleRoutes);
app.use('/api/status',   authenticate, statusRoutes);
app.use('/api/import',   authenticate, importRoutes);

// Company and project management (auth enforced inside route files)
app.use('/api/companies', companyRoutes);
app.use('/api/projects',  projectRoutes);

// User management (auth + company admin enforced inside)
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function seedSprints(projectId) {
  try {
    const existing = await ds.getSprints(projectId);
    if (existing.length > 0) return;
    const jsonPath = path.join(__dirname, 'uploads/sprint.json');
    if (!fs.existsSync(jsonPath)) return;
    const raw   = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const toISO = (str) => {
      const [m, d, y] = str.trim().split('/').map(Number);
      const yr = y < 100 ? 2000 + y : y;
      return `${yr}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    for (const s of raw) {
      await ds.upsertSprint(projectId, { Sprint: String(s.Sprint), StartDate: toISO(s['Start Date']), EndDate: toISO(s['End Date']) });
    }
    console.log(`Sprints seeded: ${raw.length} records`);
  } catch (e) {
    console.error('Seed sprints error:', e.message);
  }
}

async function seedDefaultCompanyAndProject() {
  // Ensure tables exist
  await ds.ensureCompaniesTable();
  await ds.ensureProjectsTable();

  let companies = await ds.getCompanies();
  let company;
  if (companies.length === 0) {
    company = await ds.createCompany({ name: 'Default Company' });
    console.log(`Default company created: ${company.id}`);
  } else {
    company = companies[0];
  }

  let projects = await ds.getProjectsByCompany(company.id);
  let project;
  if (projects.length === 0) {
    project = await ds.createProject({
      company_id:  company.id,
      name:        'Default Project',
      description: 'Auto-created on first run',
    });
    console.log(`Default project created: ${project.id}`);
  } else {
    project = projects[0];
  }

  return { company, project };
}

async function seedAdmin(companyId, projectId) {
  try {
    await ds.ensureUsersTable();
    const email = 'abhijit.sil@ascendion.com';
    const existing = await ds.getUserByEmail(email);
    if (!existing) {
      const password_hash = await bcrypt.hash('Admin@123', 10);
      await ds.upsertUser({
        email,
        name:                'Abhijit Sil',
        company_id:          companyId,
        company_role:        'CompanyAdmin',
        project_memberships: [{ project_id: projectId, role: 'Admin' }],
        password_hash,
        active:              true,
        created_at:          new Date().toISOString(),
      });
      console.log(`Admin seeded: ${email} / Admin@123`);
    }
  } catch (e) {
    console.error('Seed admin error:', e.message);
  }
}

app.listen(PORT, async () => {
  console.log(`ProjectPulse running on http://localhost:${PORT}`);
  await ds.ensurePRDetailsTable();
  await ds.ensureSprintsTable();

  const { company, project } = await seedDefaultCompanyAndProject();
  await seedAdmin(company.id, project.id);

  // Migrate existing single-tenant data to the default project
  await ds.migrateToSaaS(company.id, project.id);
  await seedSprints(project.id);
});

module.exports = app;
