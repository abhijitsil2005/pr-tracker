const express = require('express');
const cors = require('cors');
const path = require('path');

const prRoutes = require('./routes/prRoutes');
const releaseRoutes = require('./routes/releaseRoutes');
const syncRoutes = require('./routes/syncRoutes');
const lookupRoutes = require('./routes/lookupRoutes');

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/prs', prRoutes);
app.use('/api/releases', releaseRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/lookup', lookupRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root → serve UI
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PR Tracker running on http://localhost:${PORT}`);
});

module.exports = app;
