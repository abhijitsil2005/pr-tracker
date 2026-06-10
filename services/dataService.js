const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

const FILES = {
  PR_DETAILS: path.join(DATA_DIR, 'PR_Details.json'),
  PROD_RELEASES: path.join(DATA_DIR, 'Prod_Releases.json'),
  MODULE_PAGES: path.join(DATA_DIR, 'Module_Pages.json'),
  TEAM: path.join(DATA_DIR, 'Team.json'),
  RELEASE_TIMELINE: path.join(DATA_DIR, 'Release_Timeline.json'),
};

function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
    return [];
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── PR Details ───────────────────────────────────────────────
function getPRs() { return readJSON(FILES.PR_DETAILS); }

function getPRByNumber(prNumber) {
  const prs = getPRs();
  return prs.find(p => p.PR === Number(prNumber)) || null;
}

function addPR(prData) {
  const prs = getPRs();
  if (prs.find(p => p.PR === Number(prData.PR))) {
    throw new Error(`PR ${prData.PR} already exists`);
  }
  prs.push(prData);
  writeJSON(FILES.PR_DETAILS, prs);
  return prData;
}

function updatePR(prNumber, updates) {
  const prs = getPRs();
  const idx = prs.findIndex(p => p.PR === Number(prNumber));
  if (idx === -1) throw new Error(`PR ${prNumber} not found`);
  prs[idx] = { ...prs[idx], ...updates, PR: prs[idx].PR };
  writeJSON(FILES.PR_DETAILS, prs);
  return prs[idx];
}

function deletePR(prNumber) {
  const prs = getPRs();
  const idx = prs.findIndex(p => p.PR === Number(prNumber));
  if (idx === -1) throw new Error(`PR ${prNumber} not found`);
  const [removed] = prs.splice(idx, 1);
  writeJSON(FILES.PR_DETAILS, prs);
  return removed;
}

// ─── Prod Releases ────────────────────────────────────────────
function getProdReleases() { return readJSON(FILES.PROD_RELEASES); }

function upsertProdRelease(releaseData) {
  const releases = getProdReleases();
  const idx = releases.findIndex(r => r.Release_Number === releaseData.Release_Number);
  if (idx === -1) releases.push(releaseData);
  else releases[idx] = { ...releases[idx], ...releaseData };
  writeJSON(FILES.PROD_RELEASES, releases);
  return releaseData;
}

function deleteProdRelease(releaseNumber) {
  const releases = getProdReleases();
  const idx = releases.findIndex(r => r.Release_Number === releaseNumber);
  if (idx === -1) throw new Error(`Release ${releaseNumber} not found`);
  const [removed] = releases.splice(idx, 1);
  writeJSON(FILES.PROD_RELEASES, releases);
  return removed;
}

// ─── Lookup data ──────────────────────────────────────────────
function getModulePages() { return readJSON(FILES.MODULE_PAGES); }
function getTeam() { return readJSON(FILES.TEAM); }
function getReleaseTimeline() { return readJSON(FILES.RELEASE_TIMELINE); }

function getReviewers() {
  const team = getTeam();
  const reviewerGroup = team.find(g => g.Role === 'PR Reviewer');
  return reviewerGroup ? reviewerGroup.Members : [];
}

function getDevelopers() {
  const team = getTeam();
  const devGroup = team.find(g => g.Role === 'Developer');
  return devGroup ? devGroup.Members : [];
}

function getModuleNames() {
  return getModulePages().map(m => m.Module);
}

function getPagesForModule(moduleName) {
  const mp = getModulePages();
  const mod = mp.find(m => m.Module === moduleName);
  return mod ? mod.Pages : [];
}

function getReleaseForDate(targetDate) {
  if (!targetDate) return null;
  const timeline = getReleaseTimeline();
  return timeline.find(r => r.Release_Date === targetDate) || null;
}

module.exports = {
  getPRs, getPRByNumber, addPR, updatePR, deletePR,
  getProdReleases, upsertProdRelease, deleteProdRelease,
  getModulePages, getTeam, getReleaseTimeline,
  getReviewers, getDevelopers, getModuleNames,
  getPagesForModule, getReleaseForDate,
  FILES,
};
