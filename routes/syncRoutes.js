const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const excelService = require('../services/excelService');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'Final_Estimation_' + Date.now() + '.xlsx'),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.includes('spreadsheet') || file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx files are allowed'));
    }
  },
});

// POST /api/sync/excel  — sync from default bundled Excel file
router.post('/excel', (req, res) => {
  try {
    const defaultPath = path.join(__dirname, '..', 'data', 'Final_Estimation.xlsx');
    if (!fs.existsSync(defaultPath)) {
      return res.status(404).json({ error: 'Final_Estimation.xlsx not found in data directory' });
    }
    const result = excelService.fullSync(defaultPath);
    res.json({
      message: 'Sync completed',
      prs_synced: result.prs_synced,
      releases_built: result.releases_built,
      summary: {
        modules: [...new Set(result.pr_list.map(p => p.Module).filter(Boolean))],
        developers: [...new Set(result.pr_list.map(p => p.Developer).filter(Boolean))],
        statuses: [...new Set(result.pr_list.map(p => p.Status).filter(Boolean))],
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sync/upload  — upload a new Excel and sync from it
router.post('/upload', upload.single('excel'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const result = excelService.fullSync(req.file.path);

    // Also copy the uploaded file to data dir for future default syncs
    const destPath = path.join(__dirname, '..', 'data', 'Final_Estimation.xlsx');
    fs.copyFileSync(req.file.path, destPath);

    res.json({
      message: 'Upload & sync completed',
      filename: req.file.originalname,
      prs_synced: result.prs_synced,
      releases_built: result.releases_built,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sync/preview  — dry run: read Excel, return data without saving
router.get('/preview', (req, res) => {
  try {
    const defaultPath = path.join(__dirname, '..', 'data', 'Final_Estimation.xlsx');
    if (!fs.existsSync(defaultPath)) {
      return res.status(404).json({ error: 'Final_Estimation.xlsx not found' });
    }
    const prList = excelService.syncFromExcel(defaultPath);
    const releases = excelService.buildProdReleases(prList);
    res.json({
      prs: prList.length,
      releases: releases.length,
      pr_list: prList,
      prod_releases: releases,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
