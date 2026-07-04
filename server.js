const express = require('express');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');
const path    = require('path');
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

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Public routes
app.use('/api/auth', authRoutes);

// Protected API routes
app.use('/api/prs',      authenticate, prRoutes);
app.use('/api/releases', authenticate, releaseRoutes);
app.use('/api/sync',     authenticate, syncRoutes);
app.use('/api/lookup',   authenticate, lookupRoutes);
app.use('/api/modules',  authenticate, moduleRoutes);
app.use('/api/status',   authenticate, statusRoutes);
app.use('/api/users',    userRoutes);   // auth + admin enforced inside
app.use('/api/import',   authenticate, importRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function seedAdmin() {
  try {
    await ds.ensureUsersTable();
    const email = 'abhijit.sil@ascendion.com';
    const existing = await ds.getUserByEmail(email);
    if (!existing) {
      const password_hash = await bcrypt.hash('Admin@123', 10);
      await ds.upsertUser({
        email,
        name:       'Abhijit Sil',
        role:       'Admin',
        password_hash,
        active:     true,
        created_at: new Date().toISOString(),
      });
      console.log(`Admin seeded: ${email} / Admin@123`);
    }
  } catch (e) {
    console.error('Seed admin error:', e.message);
  }
}

app.listen(PORT, async () => {
  console.log(`PR Tracker running on http://localhost:${PORT}`);
  await ds.ensurePRDetailsTable();
  await seedAdmin();
});

module.exports = app;
