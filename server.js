require('dotenv').config();
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const path    = require('path');
const { authenticate } = require('./middleware/auth');
const { apiLimiter }   = require('./middleware/rateLimit');
const { requestId }    = require('./middleware/requestId');
const logger            = require('./services/logger');

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
// This environment is served over plain HTTP (no TLS listener) — Helmet's
// `upgrade-insecure-requests` default silently rewrites every http:// asset
// request to https://, which then hangs forever against a port nothing is
// listening on (net::ERR_CONNECTION_TIMED_OUT on every script/stylesheet).
// Same reasoning for HSTS: it's meaningless (browsers ignore it over plain
// HTTP) and misleading to send on a site with no HTTPS. Re-enable both once
// this environment sits behind real TLS (ACM cert + ALB/CloudFront).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:            ["'self'"],
      scriptSrc:             ["'self'", "'unsafe-inline'"],
      scriptSrcAttr:         ["'unsafe-inline'"],  // needed: onclick=/onchange= handlers throughout the UI
      styleSrc:              ["'self'", "'unsafe-inline'"],
      imgSrc:                ["'self'", 'data:'],
      fontSrc:               ["'self'"],
      connectSrc:            ["'self'"],
      objectSrc:             ["'none'"],
      baseUri:               ["'self'"],
      formAction:            ["'self'"],
      frameAncestors:        ["'none'"],
      upgradeInsecureRequests: null,
    },
  },
  hsts: false,
  // No cross-origin embedding of images/fonts today; avoid COEP's stricter
  // resource-loading requirements until/unless that's actually needed.
  crossOriginEmbedderPolicy: false,
}));

// Assign/propagate a correlation id before anything else logs, then log one
// line per completed request (method, path, status, duration) tagged with
// it — this is what makes CloudWatch Logs Insights useful for tracing a
// single request through the app and across concurrent traffic.
app.use(requestId);
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info('http_request', {
      correlationId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });
  next();
});

app.use(cors());
// Every request body here is a plain JSON object (PR/module/release fields,
// arrays of pages) — no file uploads go through this parser. 1mb is generous
// for that and rejects oversized payloads before they're fully buffered into
// memory, instead of relying on body-parser's implicit 100kb default.
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiLimiter);
// Every /api response is live application data (PRs, releases, dependencies...)
// that other users/tabs can change at any time. Without this, Express's default
// ETag plus a bare GET can lead a browser to reuse a cached response instead of
// hitting the network — e.g. saving PR A's dependency on PR B, then opening PR
// B's Edit modal showing stale data until a manual page refresh.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

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

// Every frontend call does res.json() on the response — without this, a
// request over the 1mb body limit (or malformed JSON) would fall through to
// Express's default HTML error page and break that parsing with a confusing
// "Unexpected token '<'" instead of a clean error message.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large', correlationId: req.id });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed JSON in request body', correlationId: req.id });
  }
  logger.error('unhandled_error', {
    correlationId: req.id,
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: err.message || 'Internal server error', correlationId: req.id });
});

app.listen(PORT, () => {
  logger.info('server_started', { port: PORT });
});

module.exports = app;
