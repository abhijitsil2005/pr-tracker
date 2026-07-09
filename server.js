require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const { authenticate } = require('./middleware/auth');
const { apiLimiter }   = require('./middleware/rateLimit');

const prRoutes      = require('./routes/prRoutes');
const releaseRoutes = require('./routes/releaseRoutes');
const lookupRoutes  = require('./routes/lookupRoutes');
const moduleRoutes  = require('./routes/moduleRoutes');
const statusRoutes  = require('./routes/statusRoutes');
const authRoutes    = require('./routes/authRoutes');
const userRoutes    = require('./routes/userRoutes');
const importRoutes  = require('./routes/importRoutes');
const companyRoutes = require('./routes/companyRoutes');
const projectRoutes = require('./routes/projectRoutes');
const onboardRoutes = require('./routes/onboardRoutes');

const app  = express();
const PORT = process.env.PORT || 3000;

// Elastic Beanstalk's Nginx sits in front of the app as a single reverse-proxy
// hop — trust its X-Forwarded-For so rate limiting keys on the real client IP.
app.set('trust proxy', 1);

// Security headers (HSTS, X-Frame-Options, X-Content-Type-Options, etc.).
// CSP allows 'unsafe-inline' for script/style because the frontend is built
// with inline onclick=/onchange= handlers and inline style= attributes
// throughout public/index.html — a strict default-src would break the whole
// UI. Everything else (fonts, connect, objects, framing) stays locked to
// same-origin, which still blocks injected remote-script/clickjacking attacks.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],  // needed: onclick=/onchange= handlers throughout the UI
      styleSrc:      ["'self'", "'unsafe-inline'"],
      imgSrc:        ["'self'", 'data:'],
      fontSrc:       ["'self'"],
      connectSrc:    ["'self'"],
      objectSrc:     ["'none'"],
      baseUri:       ["'self'"],
      formAction:    ["'self'"],
      frameAncestors:["'none'"],
    },
  },
  // No cross-origin embedding of images/fonts today; avoid COEP's stricter
  // resource-loading requirements until/unless that's actually needed.
  crossOriginEmbedderPolicy: false,
}));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiLimiter);

// Public routes
app.use('/api/auth', authRoutes);

// Protected API routes
app.use('/api/prs',      authenticate, prRoutes);
app.use('/api/releases', authenticate, releaseRoutes);
app.use('/api/lookup',   authenticate, lookupRoutes);
app.use('/api/modules',  authenticate, moduleRoutes);
app.use('/api/status',   authenticate, statusRoutes);
app.use('/api/import',   authenticate, importRoutes);

// Company and project management (auth enforced inside route files)
app.use('/api/companies', companyRoutes);
app.use('/api/projects',  projectRoutes);
app.use('/api/onboard',   onboardRoutes);

// User management (auth + company admin enforced inside)
app.use('/api/users', userRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`ProjectPulse running on http://localhost:${PORT}`);
});

module.exports = app;
