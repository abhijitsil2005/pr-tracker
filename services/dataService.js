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

// ─── Module_Pages CRUD ────────────────────────────────────────

function addModule(moduleData) {
  const mp = getModulePages();
  if (mp.find(m => m.Module === moduleData.Module)) {
    throw new Error(`Module "${moduleData.Module}" already exists`);
  }
  mp.push({ Module: moduleData.Module, Pages: moduleData.Pages || [], OutOfScope: moduleData.OutOfScope || [] });
  writeJSON(FILES.MODULE_PAGES, mp);
  return mp[mp.length - 1];
}

function updateModule(moduleName, updates) {
  const mp = getModulePages();
  const idx = mp.findIndex(m => m.Module === moduleName);
  if (idx === -1) throw new Error(`Module "${moduleName}" not found`);
  mp[idx] = { ...mp[idx], ...updates, Module: mp[idx].Module };
  writeJSON(FILES.MODULE_PAGES, mp);
  return mp[idx];
}

function deleteModule(moduleName) {
  const mp = getModulePages();
  const idx = mp.findIndex(m => m.Module === moduleName);
  if (idx === -1) throw new Error(`Module "${moduleName}" not found`);
  const [removed] = mp.splice(idx, 1);
  writeJSON(FILES.MODULE_PAGES, mp);
  return removed;
}

function addPageToModule(moduleName, pageData) {
  const mp = getModulePages();
  const idx = mp.findIndex(m => m.Module === moduleName);
  if (idx === -1) throw new Error(`Module "${moduleName}" not found`);
  if (mp[idx].Pages.find(p => p.page_name === pageData.page_name)) {
    throw new Error(`Page "${pageData.page_name}" already exists in module "${moduleName}"`);
  }
  mp[idx].Pages.push(pageData);
  writeJSON(FILES.MODULE_PAGES, mp);
  return pageData;
}

function updatePageInModule(moduleName, pageName, updates) {
  const mp = getModulePages();
  const modIdx = mp.findIndex(m => m.Module === moduleName);
  if (modIdx === -1) throw new Error(`Module "${moduleName}" not found`);
  const pageIdx = mp[modIdx].Pages.findIndex(p => p.page_name === pageName);
  if (pageIdx === -1) throw new Error(`Page "${pageName}" not found in module "${moduleName}"`);
  mp[modIdx].Pages[pageIdx] = { ...mp[modIdx].Pages[pageIdx], ...updates };
  writeJSON(FILES.MODULE_PAGES, mp);
  return mp[modIdx].Pages[pageIdx];
}

function deletePageFromModule(moduleName, pageName) {
  const mp = getModulePages();
  const modIdx = mp.findIndex(m => m.Module === moduleName);
  if (modIdx === -1) throw new Error(`Module "${moduleName}" not found`);
  const pageIdx = mp[modIdx].Pages.findIndex(p => p.page_name === pageName);
  if (pageIdx === -1) throw new Error(`Page "${pageName}" not found in module "${moduleName}"`);
  const [removed] = mp[modIdx].Pages.splice(pageIdx, 1);
  writeJSON(FILES.MODULE_PAGES, mp);
  return removed;
}

function addOutOfScopePage(moduleName, pageName) {
  const mp = getModulePages();
  const idx = mp.findIndex(m => m.Module === moduleName);
  if (idx === -1) throw new Error(`Module "${moduleName}" not found`);
  if (!mp[idx].OutOfScope) mp[idx].OutOfScope = [];
  if (!mp[idx].OutOfScope.includes(pageName)) mp[idx].OutOfScope.push(pageName);
  writeJSON(FILES.MODULE_PAGES, mp);
  return mp[idx];
}

function removeOutOfScopePage(moduleName, pageName) {
  const mp = getModulePages();
  const idx = mp.findIndex(m => m.Module === moduleName);
  if (idx === -1) throw new Error(`Module "${moduleName}" not found`);
  mp[idx].OutOfScope = (mp[idx].OutOfScope || []).filter(p => p !== pageName);
  writeJSON(FILES.MODULE_PAGES, mp);
  return mp[idx];
}

module.exports = {
  getPRs, getPRByNumber, addPR, updatePR, deletePR,
  getProdReleases, upsertProdRelease, deleteProdRelease,
  getModulePages, getTeam, getReleaseTimeline,
  getReviewers, getDevelopers, getModuleNames,
  getPagesForModule, getReleaseForDate,
  addModule, updateModule, deleteModule,
  addPageToModule, updatePageInModule, deletePageFromModule,
  addOutOfScopePage, removeOutOfScopePage,
  FILES,
};
