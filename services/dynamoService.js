// services/dynamoService.js
require('dotenv').config();
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand,
        DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const docClient = DynamoDBDocumentClient.from(client);

// ── Core helpers ──────────────────────────────────────────────────
async function scanTable(tableName) {
  const result = await docClient.send(new ScanCommand({ TableName: tableName }));
  return result.Items || [];
}

async function getItem(tableName, key) {
  const result = await docClient.send(new GetCommand({ TableName: tableName, Key: key }));
  return result.Item || null;
}

async function putItem(tableName, item) {
  await docClient.send(new PutCommand({ TableName: tableName, Item: item }));
  return item;
}

async function deleteItem(tableName, key) {
  await docClient.send(new DeleteCommand({ TableName: tableName, Key: key }));
}

// ── PRDetails ─────────────────────────────────────────────────────
const getPRs        = ()     => scanTable('PRDetails');
const getPRByNumber = (pr)   => getItem('PRDetails', { PR: Number(pr) });
const addPR         = (item) => putItem('PRDetails', item);
const deletePR      = (pr)   => deleteItem('PRDetails', { PR: Number(pr) });

async function updatePR(prNumber, updates) {
  const existing = await getPRByNumber(prNumber);
  if (!existing) throw new Error(`PR ${prNumber} not found`);
  return putItem('PRDetails', { ...existing, ...updates, PR: existing.PR });
}

// ── ProdReleases ──────────────────────────────────────────────────
const getProdReleases   = ()     => scanTable('ProdReleases');
const getProdRelease    = (num)  => getItem('ProdReleases', { Release_Number: String(num) });
const upsertProdRelease = (item) => putItem('ProdReleases', item);
const deleteProdRelease = (num)  => deleteItem('ProdReleases', { Release_Number: String(num) });

// ── ModulePages ───────────────────────────────────────────────────
const getModulePages = ()    => scanTable('ModulePages');
const getModulePage  = (mod) => getItem('ModulePages', { Module: mod });

async function getModuleNames() {
  const items = await scanTable('ModulePages');
  return items.map(m => m.Module);
}

async function getPagesForModule(moduleName) {
  const mod = await getModulePage(moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  return mod.Pages || [];
}

async function addModule(item) {
  return putItem('ModulePages', item);
}

async function updateModule(name, updates) {
  const existing = await getModulePage(name);
  if (!existing) throw new Error(`Module "${name}" not found`);
  return putItem('ModulePages', { ...existing, ...updates, Module: existing.Module });
}

const deleteModule = (mod) => deleteItem('ModulePages', { Module: mod });

async function addPageToModule(moduleName, page) {
  const mod = await getModulePage(moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const pages = [...(mod.Pages || []), page];
  return putItem('ModulePages', { ...mod, Pages: pages });
}

async function updatePageInModule(moduleName, pageName, updates) {
  const mod = await getModulePage(moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const pages = mod.Pages || [];
  const idx = pages.findIndex(p => p.page_name === pageName);
  if (idx === -1) throw new Error(`Page "${pageName}" not found in module "${moduleName}"`);
  pages[idx] = { ...pages[idx], ...updates };
  return putItem('ModulePages', { ...mod, Pages: pages });
}

async function deletePageFromModule(moduleName, pageName) {
  const mod = await getModulePage(moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const before = mod.Pages || [];
  const after = before.filter(p => p.page_name !== pageName);
  if (before.length === after.length) throw new Error(`Page "${pageName}" not found in module "${moduleName}"`);
  return putItem('ModulePages', { ...mod, Pages: after });
}

async function addOutOfScopePage(moduleName, pageName) {
  const mod = await getModulePage(moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const oos = mod.OutOfScope || [];
  if (!oos.includes(pageName)) oos.push(pageName);
  return putItem('ModulePages', { ...mod, OutOfScope: oos });
}

async function removeOutOfScopePage(moduleName, pageName) {
  const mod = await getModulePage(moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const oos = (mod.OutOfScope || []).filter(p => p !== pageName);
  return putItem('ModulePages', { ...mod, OutOfScope: oos });
}

// ── Team ──────────────────────────────────────────────────────────
const getTeam = () => scanTable('Team');

async function getDevelopers() {
  const item = await getItem('Team', { Role: 'Developer' });
  return item ? item.Members : [];
}

async function getReviewers() {
  const item = await getItem('Team', { Role: 'PR Reviewer' });
  return item ? item.Members : [];
}

// ── ReleaseTimeline ───────────────────────────────────────────────
const getReleaseTimeline = () => scanTable('ReleaseTimeline');

// ── StatusTracker ─────────────────────────────────────────────────
const { randomUUID } = require('crypto');

const getStatusAssignments = () => scanTable('StatusTracker');
const getStatusAssignment  = (id) => getItem('StatusTracker', { id });

async function addStatusAssignment(data) {
  const now  = new Date().toISOString();
  const item = {
    id:        randomUUID(),
    Developer: data.Developer,
    Module:    data.Module  || null,
    Page:      data.Page    || null,
    Week:      data.Week,
    PR:        data.PR ? Number(data.PR) : null,
    Status:    data.Status  || 'Pending',
    ActivityLog: [{
      timestamp: now,
      note:      data.note || 'Assignment created',
      type:      'created',
    }],
    CreatedAt: now,
    UpdatedAt: now,
  };
  return putItem('StatusTracker', item);
}

async function updateStatusAssignment(id, updates) {
  const existing = await getStatusAssignment(id);
  if (!existing) throw new Error(`Assignment ${id} not found`);
  const now    = new Date().toISOString();
  const merged = { ...existing, ...updates, id: existing.id, UpdatedAt: now };
  if ('PR' in updates) merged.PR = updates.PR ? Number(updates.PR) : null;
  return putItem('StatusTracker', merged);
}

const deleteStatusAssignment = (id) => deleteItem('StatusTracker', { id });

async function addActivityToAssignment(id, activity) {
  const existing = await getStatusAssignment(id);
  if (!existing) throw new Error(`Assignment ${id} not found`);
  const now = new Date().toISOString();
  const log = [...(existing.ActivityLog || []), {
    timestamp: now,
    note:      activity.note,
    type:      activity.type || 'update',
  }];
  return putItem('StatusTracker', { ...existing, ActivityLog: log, UpdatedAt: now });
}

// ── Sync PR → Release ─────────────────────────────────────────────
// Remove a PR number from every release (all when exceptReleaseDate is null,
// otherwise all except the one with that date). Uses caller-supplied list to avoid
// a second scan and type-coerces PR numbers for robust comparison.
async function removePRFromOtherReleases(prNum, exceptReleaseDate) {
  const releases = await getProdReleases();
  await _removePRFromReleasesInList(releases, prNum, exceptReleaseDate);
}

async function _removePRFromReleasesInList(releases, prNum, exceptReleaseDate) {
  const num = Number(prNum);
  for (const rel of releases) {
    if (exceptReleaseDate && (rel.Release_Date || '').trim() === exceptReleaseDate.trim()) continue;
    const hasThisPR = (rel.Modules || []).some(m =>
      (m.Pages || []).some(p => p.PR != null && Number(p.PR) === num)
    );
    if (!hasThisPR) continue;
    const modules = (rel.Modules || []).map(m => ({
      ...m,
      Pages: (m.Pages || []).filter(p => p.PR == null || Number(p.PR) !== num),
    }));
    await putItem('ProdReleases', { ...rel, Modules: modules });
  }
}

// Returns { synced: bool, releaseNumber?, reason? }
async function syncPRToRelease(pr) {
  // Fetch all releases once — used for both cleanup and target lookup
  const releases = await getProdReleases();
  const prNum    = Number(pr.PR);

  const targetDate = pr.Target_Release ? pr.Target_Release.trim() : null;

  // Always remove this PR's pages from every release that is NOT the target.
  // This handles: target changed, target cleared, pages removed from PR.
  await _removePRFromReleasesInList(releases, prNum, targetDate);

  if (!targetDate) return { synced: false, reason: 'no_target_release' };
  if (!pr.Module)  return { synced: false, reason: 'no_module' };

  // Re-fetch the target release so we have its latest state after cleanup writes
  const rel = (await getProdReleases()).find(r => (r.Release_Date || '').trim() === targetDate);
  if (!rel) return { synced: false, reason: `no_release_for_date:${targetDate}` };

  const prPages = (pr.Page || []).map(p => (p || '').trim()).filter(Boolean);

  // Fuzzy match: handles 'PageName' == 'Module/PageName' path prefix differences
  const pagesMatch = (a, b) =>
    a === b ||
    a.endsWith('/' + b) ||
    b.endsWith('/' + a) ||
    a.split('/').pop() === b.split('/').pop();

  // Resolve FF info from ModulePages
  const mpMod = await getModulePage(pr.Module).catch(() => null);
  const mpPageList = mpMod ? (mpMod.Pages || []) : [];
  const findMpPage = (pageName) => mpPageList.find(p => pagesMatch(p.page_name, pageName));

  const modules = (rel.Modules || []).map(m => ({ ...m }));
  const moduleIdx = modules.findIndex(m => m.Module === pr.Module);
  let relPages = moduleIdx !== -1 ? [...(modules[moduleIdx].Pages || [])] : [];

  // Add or update pages now in pr.Page
  for (const pageName of prPages) {
    const idx = relPages.findIndex(p => pagesMatch((p.Page_Name || '').trim(), pageName));
    if (idx !== -1) {
      relPages[idx] = { ...relPages[idx], PR: prNum };
    } else {
      const mp = findMpPage(pageName);
      relPages.push({
        Page_Name: pageName,
        Feature_Flag: mp ? (mp.Feature_Flag || '') : '',
        Feature_Flag_Status: mp ? (mp.Feature_Flag_Status || 'N/A') : 'N/A',
        PR: prNum,
        Task: '',
      });
    }
  }

  // Remove pages that were previously linked to this PR but are no longer in pr.Page
  relPages = relPages.filter(p => {
    if (p.PR == null || Number(p.PR) !== prNum) return true;
    return prPages.some(sp => pagesMatch((p.Page_Name || '').trim(), sp));
  });

  if (moduleIdx !== -1) {
    modules[moduleIdx] = { ...modules[moduleIdx], Pages: relPages };
  } else {
    modules.push({ Module: pr.Module, User_Story: '', Pages: relPages });
  }

  await putItem('ProdReleases', { ...rel, Modules: modules });
  return { synced: true, releaseNumber: rel.Release_Number };
}

// ── Complete Release ──────────────────────────────────────────────
async function completeRelease(releaseNumber) {
  const releases = await getProdReleases();
  const rel = releases.find(r => String(r.Release_Number) === String(releaseNumber));
  if (!rel) throw new Error(`Release ${releaseNumber} not found`);

  const releaseDate = rel.Release_Date;
  const modules = rel.Modules || [];

  // Collect all unique PR numbers from the release
  const prNumbers = new Set();
  modules.forEach(mod => {
    (mod.Pages || []).forEach(page => {
      if (page.PR) prNumbers.add(page.PR);
    });
  });

  // Update ModulePages for each module/page in the release
  for (const mod of modules) {
    if (!mod.Module) continue;
    const mpMod = await getModulePage(mod.Module);
    if (!mpMod) continue;

    const mpPages = mpMod.Pages || [];
    let changed = false;

    for (const relPage of (mod.Pages || [])) {
      const pageName = relPage.Page_Name;
      const ffStatus = relPage.Feature_Flag_Status;

      // Fuzzy match: exact, suffix, or basename
      const idx = mpPages.findIndex(mp =>
        mp.page_name === pageName ||
        (pageName || '').endsWith(mp.page_name) ||
        mp.page_name === (pageName || '').split('/').pop()
      );

      if (idx !== -1) {
        mpPages[idx] = {
          ...mpPages[idx],
          Production_Deployment_Status: 'Deployed',
          Feature_Flag_Status: ffStatus || mpPages[idx].Feature_Flag_Status,
          Release_Date: releaseDate,
        };
        changed = true;
      }
    }

    if (changed) {
      await putItem('ModulePages', { ...mpMod, Pages: mpPages });
    }
  }

  // Update PRDetails for each PR associated with this release
  for (const prNum of prNumbers) {
    const pr = await getPRByNumber(prNum);
    if (!pr) continue;
    await putItem('PRDetails', {
      ...pr,
      Status: 'Prod Deployed',
      Release_Date: releaseDate,
    });
  }

  // Stamp the release itself as completed
  await putItem('ProdReleases', { ...rel, Completed: true, Completed_At: new Date().toISOString() });

  return { moduleCount: modules.length, prCount: prNumbers.size };
}

// ── Users ─────────────────────────────────────────────────
const getUsers      = ()      => scanTable('Users');
const getUserByEmail = (email) => getItem('Users', { email });
const upsertUser    = (item)  => putItem('Users', item);
const deleteUser    = (email) => deleteItem('Users', { email });

async function ensureUsersTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: 'Users' }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    await client.send(new CreateTableCommand({
      TableName: 'Users',
      KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'email', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    // Wait briefly for table to become active
    await new Promise(r => setTimeout(r, 3000));
  }
}

module.exports = {
  getPRs, getPRByNumber, addPR, deletePR, updatePR,
  getProdReleases, getProdRelease, upsertProdRelease, deleteProdRelease,
  completeRelease, syncPRToRelease, removePRFromOtherReleases,
  getModulePages, getModulePage, getModuleNames, getPagesForModule,
  addModule, updateModule, deleteModule,
  addPageToModule, updatePageInModule, deletePageFromModule,
  addOutOfScopePage, removeOutOfScopePage,
  getReleaseTimeline, getTeam, getDevelopers, getReviewers,
  getStatusAssignments, getStatusAssignment,
  addStatusAssignment, updateStatusAssignment, deleteStatusAssignment,
  addActivityToAssignment,
  getUsers, getUserByEmail, upsertUser, deleteUser, ensureUsersTable,
};
