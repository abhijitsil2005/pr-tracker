// services/dynamoService.js
require('dotenv').config();
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, DeleteTableCommand } = require('@aws-sdk/client-dynamodb');
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
// Primary key is now `id` (UUID string). `PR` is the GitHub PR number (non-unique).
// The combination of PR + Module must be unique (enforced in addPR).

const getPRs   = () => scanTable('PRDetails');
const getPRById = (id) => getItem('PRDetails', { id });

async function getPRByNumber(prNumber) {
  const result = await docClient.send(new ScanCommand({
    TableName: 'PRDetails',
    FilterExpression: '#pr = :pr',
    ExpressionAttributeNames: { '#pr': 'PR' },
    ExpressionAttributeValues: { ':pr': Number(prNumber) },
  }));
  return result.Items || [];
}

async function addPR(item) {
  const prNum = Number(item.PR);
  if (item.Module) {
    const existing = await getPRByNumber(prNum);
    if (existing.some(p => p.Module === item.Module)) {
      throw new Error(`PR ${prNum} with module "${item.Module}" already exists`);
    }
  }
  const newItem = { ...item, id: randomUUID(), PR: prNum };
  return putItem('PRDetails', newItem);
}

const deletePR = (id) => deleteItem('PRDetails', { id });

async function updatePR(id, updates) {
  const existing = await getPRById(id);
  if (!existing) throw new Error(`PR record ${id} not found`);
  return putItem('PRDetails', { ...existing, ...updates, id: existing.id, PR: existing.PR });
}

async function _waitForPRTableActive() {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const d = await client.send(new DescribeTableCommand({ TableName: 'PRDetails' }));
      if (d.Table.TableStatus === 'ACTIVE') return;
    } catch (e) {
      if (e.name !== 'ResourceNotFoundException') throw e;
      // Not visible yet — keep waiting
    }
  }
  throw new Error('PRDetails table did not reach ACTIVE status in time');
}

async function _waitForPRTableDeleted() {
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const d = await client.send(new DescribeTableCommand({ TableName: 'PRDetails' }));
      if (d.Table.TableStatus !== 'DELETING') {
        // Unexpected — still exists and not being deleted
        throw new Error(`PRDetails table in unexpected status: ${d.Table.TableStatus}`);
      }
      // Still deleting — keep polling
    } catch (e) {
      if (e.name === 'ResourceNotFoundException') return; // fully deleted
      throw e;
    }
  }
  throw new Error('PRDetails table deletion timed out after 3 minutes. Delete it manually via the AWS console and restart.');
}

async function _createPRDetailsTable() {
  await client.send(new CreateTableCommand({
    TableName: 'PRDetails',
    KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    BillingMode: 'PAY_PER_REQUEST',
  }));
  await _waitForPRTableActive();
}

async function ensurePRDetailsTable() {
  let existing;
  try {
    existing = await client.send(new DescribeTableCommand({ TableName: 'PRDetails' }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    // Table doesn't exist — create fresh
    await _createPRDetailsTable();
    return;
  }

  const pkName = existing.Table.KeySchema.find(k => k.KeyType === 'HASH')?.AttributeName;
  if (pkName === 'id') return; // already on new schema
  if (pkName !== 'PR') throw new Error(`PRDetails has unexpected partition key: "${pkName}"`);

  // Old schema detected — migrate
  console.log('PRDetails: migrating from PR-keyed to id-keyed schema...');
  const items = await getPRs(); // scan all data BEFORE deleting
  console.log(`  Scanned ${items.length} records`);

  await client.send(new DeleteTableCommand({ TableName: 'PRDetails' }));
  console.log('  Deletion initiated, waiting for completion...');
  await _waitForPRTableDeleted();

  console.log('  Creating new table...');
  await _createPRDetailsTable();

  console.log('  Restoring data...');
  for (const item of items) {
    await putItem('PRDetails', { ...item, id: item.id || randomUUID() });
  }
  console.log(`PRDetails migration complete: ${items.length} records restored`);
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
// module: if provided, only removes the PR from that specific module in each release.
// Pass null to remove from all modules (used when deleting a PR entirely).
async function removePRFromOtherReleases(prNum, module, exceptReleaseDate) {
  const releases = await getProdReleases();
  await _removePRFromReleasesInList(releases, prNum, module, exceptReleaseDate, null);
}

// exceptReleaseDate: date string from ReleaseTimeline (may differ from ProdReleases date)
// exceptReleaseNumber: Release_Number resolved via ReleaseTimeline (authoritative)
async function _removePRFromReleasesInList(releases, prNum, module, exceptReleaseDate, exceptReleaseNumber) {
  const num = Number(prNum);
  for (const rel of releases) {
    // Skip the target release — match by release number (preferred) or date (fallback)
    if (exceptReleaseNumber && String(rel.Release_Number) === String(exceptReleaseNumber)) continue;
    if (!exceptReleaseNumber && exceptReleaseDate && (rel.Release_Date || '').trim() === exceptReleaseDate.trim()) continue;
    const hasThisPR = (rel.Modules || []).some(m =>
      (!module || m.Module === module) &&
      (m.Pages || []).some(p => p.PR != null && Number(p.PR) === num)
    );
    if (!hasThisPR) continue;
    const modules = (rel.Modules || []).map(m => {
      if (module && m.Module !== module) return m; // leave other modules alone
      return {
        ...m,
        Pages: (m.Pages || []).filter(p => p.PR == null || Number(p.PR) !== num),
      };
    }).filter(m => (m.Pages || []).some(p => p.PR != null)); // drop modules with no PR-bearing pages
    await putItem('ProdReleases', { ...rel, Modules: modules });
  }
}

// Returns { synced: bool, releaseNumber?, reason? }
// oldTargetRelease: the PR's Target_Release value BEFORE this update (used to clean up the source release)
async function syncPRToRelease(pr, oldTargetRelease = null) {
  const releases = await getProdReleases();
  const prNum    = Number(pr.PR);

  const targetDate = pr.Target_Release ? pr.Target_Release.trim() : null;
  const oldDate    = oldTargetRelease   ? oldTargetRelease.trim()  : null;

  // Use ReleaseTimeline to resolve the authoritative Release_Number for the target date.
  // This decouples the sync from exact date-string matching between two separate tables.
  const timeline = await getReleaseTimeline();
  const tlEntry  = targetDate ? timeline.find(t => (t.Release_Date || '').trim() === targetDate) : null;
  const targetReleaseNumber = tlEntry ? String(tlEntry.Release_Number) : null;

  // Remove this PR's pages (scoped to its module) from every release that is NOT the target.
  await _removePRFromReleasesInList(releases, prNum, pr.Module, targetDate, targetReleaseNumber);

  if (!targetDate) return { synced: false, reason: 'no_target_release' };
  if (!pr.Module)  return { synced: false, reason: 'no_module' };

  // Re-fetch after cleanup; find target release by Release_Number (preferred) or date (fallback).
  const freshReleases = await getProdReleases();

  // Explicit source-release cleanup: covers the case where the old release's pages were
  // not tagged with this PR's number (e.g. manually added via Edit Release with no PR field),
  // which causes _removePRFromReleasesInList to skip that release entirely.
  if (oldDate && oldDate !== targetDate && pr.Module) {
    const oldRel = freshReleases.find(r => (r.Release_Date || '').trim() === oldDate);
    if (oldRel) {
      const oldModIdx = (oldRel.Modules || []).findIndex(m => m.Module === pr.Module);
      if (oldModIdx !== -1) {
        const oldMod = oldRel.Modules[oldModIdx];
        // Keep module only if pages with OTHER PR numbers still reference it
        const remainingPages = (oldMod.Pages || []).filter(p => p.PR == null || Number(p.PR) !== prNum);
        const hasOtherPRs = remainingPages.some(p => p.PR != null);
        if (!hasOtherPRs) {
          const newModules = (oldRel.Modules || []).filter((_, i) => i !== oldModIdx);
          await putItem('ProdReleases', { ...oldRel, Modules: newModules });
        }
      }
    }
  }

  let rel = targetReleaseNumber
    ? freshReleases.find(r => String(r.Release_Number) === targetReleaseNumber)
    : null;
  if (!rel) rel = freshReleases.find(r => (r.Release_Date || '').trim() === targetDate);

  // If still not found but the date IS in ReleaseTimeline, auto-create the ProdRelease
  // so the user doesn't need to manually add it in the Releases tab first.
  if (!rel && tlEntry && tlEntry.Release_Number != null) {
    rel = {
      Release_Number:   String(tlEntry.Release_Number),
      Release_Date:     tlEntry.Release_Date || targetDate,
      Code_Freeze:      tlEntry['Code Freeze'] || null,
      Regression_Start: tlEntry['Regression Start Date'] || null,
      Modules:          [],
    };
    await putItem('ProdReleases', rel);
  }

  if (!rel) return { synced: false, reason: `no_release_for_date:${targetDate}` };

  const prPages = (pr.Page || []).map(p => (p || '').trim()).filter(Boolean);

  // Fuzzy match: handles 'PageName' == 'Module/PageName' path prefix differences
  const pagesMatch = (a, b) => {
    if (!a || !b) return false;
    return a === b ||
      a.endsWith('/' + b) ||
      b.endsWith('/' + a) ||
      a.split('/').pop() === b.split('/').pop();
  };

  // Resolve FF info from ModulePages
  const mpMod = await getModulePage(pr.Module).catch(() => null);
  const mpPageList = mpMod ? (mpMod.Pages || []) : [];
  const findMpPage = (pageName) => mpPageList.find(p => pagesMatch(p.page_name, pageName));

  const modules = (rel.Modules || []).map(m => ({ ...m }));
  const moduleIdx = modules.findIndex(m => m.Module === pr.Module);
  let relPages = moduleIdx !== -1 ? [...(modules[moduleIdx].Pages || [])] : [];

  // Add or update pages now in pr.Page.
  // Match by BOTH page name AND PR number so that multiple PRs targeting the same
  // page (e.g. 3 PRs all covering "Infrastructure Pages") each keep their own entry
  // instead of overwriting each other.
  for (const pageName of prPages) {
    const idx = relPages.findIndex(p =>
      Number(p.PR) === prNum && pagesMatch((p.Page_Name || '').trim(), pageName)
    );
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

  const hasActivePRPages = relPages.some(p => p.PR != null);
  if (hasActivePRPages) {
    if (moduleIdx !== -1) {
      modules[moduleIdx] = { ...modules[moduleIdx], Pages: relPages };
    } else {
      modules.push({ Module: pr.Module, User_Story: '', Pages: relPages });
    }
  } else if (moduleIdx !== -1) {
    modules.splice(moduleIdx, 1); // no PR-bearing pages left — remove the module
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
  // getPRByNumber returns an array (one record per module), iterate all records
  for (const prNum of prNumbers) {
    const prs = await getPRByNumber(prNum);
    if (!prs || !prs.length) continue;
    for (const pr of prs) {
      await putItem('PRDetails', {
        ...pr,
        Status: 'Prod Deployed',
        Release_Date: releaseDate,
      });
    }
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
  getPRs, getPRById, getPRByNumber, addPR, deletePR, updatePR,
  ensurePRDetailsTable,
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
