// services/dynamoService.js
require('dotenv').config();
const { DynamoDBClient, CreateTableCommand, DescribeTableCommand, DeleteTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand,
        DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');

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

async function scanTableFiltered(tableName, filterKey, filterValue) {
  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: '#k = :v',
    ExpressionAttributeNames: { '#k': filterKey },
    ExpressionAttributeValues: { ':v': filterValue },
  }));
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

// ── Multi-tenant key helpers ──────────────────────────────────────
// Compound PK format: "{projectId}#{naturalKey}" for tables whose original PK
// is a business key (not UUID), preventing cross-project key collisions.
const mkKey = (projectId, value) => `${projectId}#${String(value)}`;

// Expose clean natural keys to callers (strip internal compound key)
const exposeModule  = (item) => item ? { ...item, Module: item.module_name } : null;
const exposeRelease = (item) => item ? { ...item, Release_Number: item.release_number } : null;
const exposeSprint  = (item) => item ? { ...item, Sprint: item.sprint_name } : null;

// Write helpers that enforce compound keys
async function _putModuleRecord(projectId, item) {
  const name = item.module_name != null ? item.module_name : item.Module;
  return putItem('ModulePages', {
    ...item,
    Module:      mkKey(projectId, name),
    module_name: name,
    project_id:  projectId,
  });
}

async function _putReleaseRecord(projectId, item) {
  const num = String(item.release_number != null ? item.release_number : item.Release_Number);
  return putItem('ProdReleases', {
    ...item,
    Release_Number: mkKey(projectId, num),
    release_number: num,
    project_id:     projectId,
  });
}

async function _putSprintRecord(projectId, item) {
  const sprint = String(item.sprint_name != null ? item.sprint_name : item.Sprint);
  return putItem('Sprints', {
    ...item,
    Sprint:      mkKey(projectId, sprint),
    sprint_name: sprint,
    project_id:  projectId,
  });
}

// ── Companies ─────────────────────────────────────────────────────
const getCompanies = () => scanTable('Companies');
const getCompany   = (id) => getItem('Companies', { id });

async function createCompany({ name }) {
  const item = { id: randomUUID(), name: name.trim(), created_at: new Date().toISOString(), active: true };
  return putItem('Companies', item);
}

async function updateCompany(id, updates) {
  const existing = await getCompany(id);
  if (!existing) throw new Error(`Company ${id} not found`);
  return putItem('Companies', { ...existing, ...updates, id: existing.id });
}

async function ensureCompaniesTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: 'Companies' }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    await client.send(new CreateTableCommand({
      TableName: 'Companies',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ── Projects ──────────────────────────────────────────────────────
const getProjectsByCompany = (companyId) => scanTableFiltered('Projects', 'company_id', companyId);
const getProject = (id) => getItem('Projects', { id });

async function createProject({ company_id, name, description }) {
  const item = {
    id:          randomUUID(),
    company_id,
    name:        name.trim(),
    description: description || '',
    created_at:  new Date().toISOString(),
    active:      true,
  };
  return putItem('Projects', item);
}

async function updateProject(id, updates) {
  const existing = await getProject(id);
  if (!existing) throw new Error(`Project ${id} not found`);
  return putItem('Projects', { ...existing, ...updates, id: existing.id, company_id: existing.company_id });
}

async function deleteProject(id) {
  return deleteItem('Projects', { id });
}

async function ensureProjectsTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: 'Projects' }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    await client.send(new CreateTableCommand({
      TableName: 'Projects',
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ── PRDetails ─────────────────────────────────────────────────────
const getPRs    = (projectId) => scanTableFiltered('PRDetails', 'project_id', projectId);
const getPRById = (id)        => getItem('PRDetails', { id });

async function getPRByNumber(projectId, prNumber) {
  const result = await docClient.send(new ScanCommand({
    TableName: 'PRDetails',
    FilterExpression: '#pr = :pr AND project_id = :pid',
    ExpressionAttributeNames: { '#pr': 'PR' },
    ExpressionAttributeValues: { ':pr': Number(prNumber), ':pid': projectId },
  }));
  return result.Items || [];
}

async function addPR(projectId, item) {
  const prNum = Number(item.PR);
  if (item.Module) {
    const existing = await getPRByNumber(projectId, prNum);
    if (existing.some(p => p.Module === item.Module)) {
      throw new Error(`PR ${prNum} with module "${item.Module}" already exists`);
    }
  }
  const newItem = { ...item, id: randomUUID(), PR: prNum, project_id: projectId };
  return putItem('PRDetails', newItem);
}

const deletePR = (id) => deleteItem('PRDetails', { id });

async function updatePR(id, updates) {
  const existing = await getPRById(id);
  if (!existing) throw new Error(`PR record ${id} not found`);
  return putItem('PRDetails', { ...existing, ...updates, id: existing.id, PR: existing.PR, project_id: existing.project_id });
}

async function _waitForPRTableActive() {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const d = await client.send(new DescribeTableCommand({ TableName: 'PRDetails' }));
      if (d.Table.TableStatus === 'ACTIVE') return;
    } catch (e) {
      if (e.name !== 'ResourceNotFoundException') throw e;
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
        throw new Error(`PRDetails table in unexpected status: ${d.Table.TableStatus}`);
      }
    } catch (e) {
      if (e.name === 'ResourceNotFoundException') return;
      throw e;
    }
  }
  throw new Error('PRDetails table deletion timed out after 3 minutes.');
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
    await _createPRDetailsTable();
    return;
  }
  const pkName = existing.Table.KeySchema.find(k => k.KeyType === 'HASH')?.AttributeName;
  if (pkName === 'id') return;
  if (pkName !== 'PR') throw new Error(`PRDetails has unexpected partition key: "${pkName}"`);
  console.log('PRDetails: migrating from PR-keyed to id-keyed schema...');
  const items = await docClient.send(new ScanCommand({ TableName: 'PRDetails' })).then(r => r.Items || []);
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
async function getProdReleases(projectId) {
  const items = await scanTableFiltered('ProdReleases', 'project_id', projectId);
  return items.map(exposeRelease);
}

async function getProdRelease(projectId, releaseNum) {
  const item = await getItem('ProdReleases', { Release_Number: mkKey(projectId, releaseNum) });
  return exposeRelease(item);
}

async function upsertProdRelease(projectId, item) {
  const result = await _putReleaseRecord(projectId, item);
  return exposeRelease(result);
}

async function deleteProdRelease(projectId, releaseNum) {
  return deleteItem('ProdReleases', { Release_Number: mkKey(projectId, releaseNum) });
}

// ── ModulePages ───────────────────────────────────────────────────
async function getModulePages(projectId) {
  const items = await scanTableFiltered('ModulePages', 'project_id', projectId);
  return items.map(exposeModule);
}

async function getModulePage(projectId, moduleName) {
  const item = await getItem('ModulePages', { Module: mkKey(projectId, moduleName) });
  return exposeModule(item);
}

async function getModuleNames(projectId) {
  const items = await getModulePages(projectId);
  return items.map(m => m.Module);
}

async function getPagesForModule(projectId, moduleName) {
  const mod = await getModulePage(projectId, moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  return mod.Pages || [];
}

async function addModule(projectId, item) {
  const result = await _putModuleRecord(projectId, { Pages: [], OutOfScope: [], ...item });
  return exposeModule(result);
}

async function updateModule(projectId, name, updates) {
  const existing = await getModulePage(projectId, name);
  if (!existing) throw new Error(`Module "${name}" not found`);
  const result = await _putModuleRecord(projectId, { ...existing, ...updates, module_name: name });
  return exposeModule(result);
}

async function deleteModule(projectId, name) {
  return deleteItem('ModulePages', { Module: mkKey(projectId, name) });
}

async function addPageToModule(projectId, moduleName, page) {
  const mod = await getModulePage(projectId, moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const pages = [...(mod.Pages || []), page];
  const result = await _putModuleRecord(projectId, { ...mod, Pages: pages });
  return exposeModule(result);
}

async function updatePageInModule(projectId, moduleName, pageName, updates) {
  const mod = await getModulePage(projectId, moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const pages = mod.Pages || [];
  const idx = pages.findIndex(p => p.page_name === pageName);
  if (idx === -1) throw new Error(`Page "${pageName}" not found in module "${moduleName}"`);
  pages[idx] = { ...pages[idx], ...updates };
  const result = await _putModuleRecord(projectId, { ...mod, Pages: pages });
  return exposeModule(result);
}

async function deletePageFromModule(projectId, moduleName, pageName) {
  const mod = await getModulePage(projectId, moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const before = mod.Pages || [];
  const after  = before.filter(p => p.page_name !== pageName);
  if (before.length === after.length) throw new Error(`Page "${pageName}" not found in module "${moduleName}"`);
  const result = await _putModuleRecord(projectId, { ...mod, Pages: after });
  return exposeModule(result);
}

async function addOutOfScopePage(projectId, moduleName, pageName) {
  const mod = await getModulePage(projectId, moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const oos = mod.OutOfScope || [];
  if (!oos.includes(pageName)) oos.push(pageName);
  const result = await _putModuleRecord(projectId, { ...mod, OutOfScope: oos });
  return exposeModule(result);
}

async function removeOutOfScopePage(projectId, moduleName, pageName) {
  const mod = await getModulePage(projectId, moduleName);
  if (!mod) throw new Error(`Module "${moduleName}" not found`);
  const oos = (mod.OutOfScope || []).filter(p => p !== pageName);
  const result = await _putModuleRecord(projectId, { ...mod, OutOfScope: oos });
  return exposeModule(result);
}

// ── Team (project-scoped) ─────────────────────────────────────────
function _putTeamRecord(projectId, item) {
  const roleName = item.role_name != null ? item.role_name : item.Role;
  return putItem('Team', {
    ...item,
    Role:       mkKey(projectId, roleName),
    role_name:  roleName,
    project_id: projectId,
  });
}

const exposeTeam = (item) => item ? { ...item, Role: item.role_name } : null;

const getTeam = (projectId) =>
  scanTableFiltered('Team', 'project_id', projectId).then(items => items.map(exposeTeam));

async function getDevelopers(projectId) {
  const item = await getItem('Team', { Role: mkKey(projectId, 'Developer') });
  return item ? item.Members : [];
}

async function getReviewers(projectId) {
  const item = await getItem('Team', { Role: mkKey(projectId, 'PR Reviewer') });
  return item ? item.Members : [];
}

// ── ReleaseTimeline (project-scoped) ──────────────────────────────
function _putTimelineRecord(projectId, item) {
  const releaseNum = item.release_tl_number != null
    ? item.release_tl_number
    : String(item.Release_Number);
  return putItem('ReleaseTimeline', {
    ...item,
    Release_Number:    mkKey(projectId, releaseNum),
    release_tl_number: releaseNum,
    project_id:        projectId,
  });
}

const exposeTimeline = (item) => item ? { ...item, Release_Number: item.release_tl_number } : null;

const getReleaseTimeline = (projectId) =>
  scanTableFiltered('ReleaseTimeline', 'project_id', projectId)
    .then(items => items.map(exposeTimeline));

// ── StatusTracker ─────────────────────────────────────────────────
const getStatusAssignments = (projectId) => scanTableFiltered('StatusTracker', 'project_id', projectId);
const getStatusAssignment  = (id)         => getItem('StatusTracker', { id });

async function addStatusAssignment(projectId, data) {
  const now  = new Date().toISOString();
  const item = {
    id:          randomUUID(),
    project_id:  projectId,
    Developer:   data.Developer,
    Module:      data.Module  || null,
    Page:        data.Page    || null,
    Week:        data.Week,
    PR:          data.PR ? Number(data.PR) : null,
    Status:      data.Status  || 'Pending',
    ActivityLog: [{ timestamp: now, note: data.note || 'Assignment created', type: 'created' }],
    CreatedAt:   now,
    UpdatedAt:   now,
  };
  return putItem('StatusTracker', item);
}

async function updateStatusAssignment(id, updates) {
  const existing = await getStatusAssignment(id);
  if (!existing) throw new Error(`Assignment ${id} not found`);
  const now    = new Date().toISOString();
  const merged = { ...existing, ...updates, id: existing.id, project_id: existing.project_id, UpdatedAt: now };
  if ('PR' in updates) merged.PR = updates.PR ? Number(updates.PR) : null;
  return putItem('StatusTracker', merged);
}

const deleteStatusAssignment = (id)   => deleteItem('StatusTracker', { id });
const putStatusAssignment    = (item) => putItem('StatusTracker', item);

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

// ── Sprints ───────────────────────────────────────────────────────
async function getSprints(projectId) {
  const items = await scanTableFiltered('Sprints', 'project_id', projectId);
  return items.map(exposeSprint);
}

async function getSprint(projectId, sprintName) {
  const item = await getItem('Sprints', { Sprint: mkKey(projectId, sprintName) });
  return exposeSprint(item);
}

async function upsertSprint(projectId, sprintData) {
  const result = await _putSprintRecord(projectId, sprintData);
  return exposeSprint(result);
}

async function ensureSprintsTable() {
  try {
    await client.send(new DescribeTableCommand({ TableName: 'Sprints' }));
  } catch (e) {
    if (e.name !== 'ResourceNotFoundException') throw e;
    await client.send(new CreateTableCommand({
      TableName: 'Sprints',
      KeySchema: [{ AttributeName: 'Sprint', KeyType: 'HASH' }],
      AttributeDefinitions: [{ AttributeName: 'Sprint', AttributeType: 'S' }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ── Sync PR → Release ─────────────────────────────────────────────
async function removePRFromOtherReleases(projectId, prNum, module, exceptReleaseDate) {
  const releases = await getProdReleases(projectId);
  await _removePRFromReleasesInList(projectId, releases, prNum, module, exceptReleaseDate, null);
}

async function _removePRFromReleasesInList(projectId, releases, prNum, module, exceptReleaseDate, exceptReleaseNumber) {
  const num = Number(prNum);
  for (const rel of releases) {
    if (exceptReleaseNumber && String(rel.Release_Number) === String(exceptReleaseNumber)) continue;
    if (!exceptReleaseNumber && exceptReleaseDate && (rel.Release_Date || '').trim() === exceptReleaseDate.trim()) continue;
    const hasThisPR = (rel.Modules || []).some(m =>
      (!module || m.Module === module) &&
      (m.Pages || []).some(p => p.PR != null && Number(p.PR) === num)
    );
    if (!hasThisPR) continue;
    const modules = (rel.Modules || []).map(m => {
      if (module && m.Module !== module) return m;
      return { ...m, Pages: (m.Pages || []).filter(p => p.PR == null || Number(p.PR) !== num) };
    }).filter(m => (m.Pages || []).some(p => p.PR != null));
    await _putReleaseRecord(projectId, { ...rel, Modules: modules });
  }
}

async function syncPRToRelease(pr, oldTargetRelease = null) {
  const projectId = pr.project_id;
  if (!projectId) return { synced: false, reason: 'no_project_id' };

  const releases  = await getProdReleases(projectId);
  const prNum     = Number(pr.PR);

  const targetDate = pr.Target_Release ? pr.Target_Release.trim() : null;
  const oldDate    = oldTargetRelease   ? oldTargetRelease.trim()  : null;

  const timeline      = await getReleaseTimeline(projectId);
  const tlEntry       = targetDate ? timeline.find(t => (t.Release_Date || '').trim() === targetDate) : null;
  const targetReleaseNumber = tlEntry ? String(tlEntry.Release_Number) : null;

  await _removePRFromReleasesInList(projectId, releases, prNum, pr.Module, targetDate, targetReleaseNumber);

  if (!targetDate) return { synced: false, reason: 'no_target_release' };
  if (!pr.Module)  return { synced: false, reason: 'no_module' };

  const freshReleases = await getProdReleases(projectId);

  if (oldDate && oldDate !== targetDate && pr.Module) {
    const oldRel = freshReleases.find(r => (r.Release_Date || '').trim() === oldDate);
    if (oldRel) {
      const oldModIdx = (oldRel.Modules || []).findIndex(m => m.Module === pr.Module);
      if (oldModIdx !== -1) {
        const oldMod = oldRel.Modules[oldModIdx];
        const remainingPages = (oldMod.Pages || []).filter(p => p.PR == null || Number(p.PR) !== prNum);
        const hasOtherPRs = remainingPages.some(p => p.PR != null);
        if (!hasOtherPRs) {
          const newModules = (oldRel.Modules || []).filter((_, i) => i !== oldModIdx);
          await _putReleaseRecord(projectId, { ...oldRel, Modules: newModules });
        }
      }
    }
  }

  let rel = targetReleaseNumber
    ? freshReleases.find(r => String(r.Release_Number) === targetReleaseNumber)
    : null;
  if (!rel) rel = freshReleases.find(r => (r.Release_Date || '').trim() === targetDate);

  if (!rel && tlEntry && tlEntry.Release_Number != null) {
    rel = {
      release_number:   String(tlEntry.Release_Number),
      Release_Number:   String(tlEntry.Release_Number),
      Release_Date:     tlEntry.Release_Date || targetDate,
      Code_Freeze:      tlEntry['Code Freeze'] || null,
      Regression_Start: tlEntry['Regression Start Date'] || null,
      Modules:          [],
    };
    await _putReleaseRecord(projectId, rel);
    rel = await getProdRelease(projectId, tlEntry.Release_Number);
  }

  if (!rel) return { synced: false, reason: `no_release_for_date:${targetDate}` };

  const prPages = (pr.Page || []).map(p => (p || '').trim()).filter(Boolean);

  const pagesMatch = (a, b) => {
    if (!a || !b) return false;
    return a === b || a.endsWith('/' + b) || b.endsWith('/' + a) || a.split('/').pop() === b.split('/').pop();
  };

  const mpMod = await getModulePage(projectId, pr.Module).catch(() => null);
  const mpPageList = mpMod ? (mpMod.Pages || []) : [];
  const findMpPage = (pageName) => mpPageList.find(p => pagesMatch(p.page_name, pageName));

  const modules  = (rel.Modules || []).map(m => ({ ...m }));
  const moduleIdx = modules.findIndex(m => m.Module === pr.Module);
  let relPages = moduleIdx !== -1 ? [...(modules[moduleIdx].Pages || [])] : [];

  for (const pageName of prPages) {
    const idx = relPages.findIndex(p =>
      Number(p.PR) === prNum && pagesMatch((p.Page_Name || '').trim(), pageName)
    );
    if (idx !== -1) {
      relPages[idx] = { ...relPages[idx], PR: prNum, Task: pr.Task || relPages[idx].Task || '' };
    } else {
      const mp = findMpPage(pageName);
      relPages.push({
        Page_Name:          pageName,
        Feature_Flag:       mp ? (mp.Feature_Flag || '') : '',
        Feature_Flag_Status: mp ? (mp.Feature_Flag_Status || 'N/A') : 'N/A',
        PR:   prNum,
        Task: pr.Task || '',
      });
    }
  }

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
    modules.splice(moduleIdx, 1);
  }

  await _putReleaseRecord(projectId, { ...rel, Modules: modules });
  return { synced: true, releaseNumber: rel.Release_Number };
}

// ── Complete Release ──────────────────────────────────────────────
async function completeRelease(projectId, releaseNumber) {
  const releases = await getProdReleases(projectId);
  const rel = releases.find(r => String(r.Release_Number) === String(releaseNumber));
  if (!rel) throw new Error(`Release ${releaseNumber} not found`);

  const releaseDate = rel.Release_Date;
  const modules     = rel.Modules || [];

  const prNumbers = new Set();
  modules.forEach(mod => {
    (mod.Pages || []).forEach(page => { if (page.PR) prNumbers.add(page.PR); });
  });

  const EXCLUDED_PAGES = new Set(['Infrastructure Pages', 'API', 'Shared Controls']);

  for (const mod of modules) {
    if (!mod.Module) continue;
    const mpMod = await getModulePage(projectId, mod.Module);
    if (!mpMod) continue;

    const mpPages = mpMod.Pages || [];
    let changed = false;

    for (const relPage of (mod.Pages || [])) {
      const pageName = relPage.Page_Name;
      const ffStatus = relPage.Feature_Flag_Status;
      const idx = mpPages.findIndex(mp =>
        mp.page_name === pageName ||
        (pageName || '').endsWith(mp.page_name) ||
        mp.page_name === (pageName || '').split('/').pop()
      );
      if (idx !== -1) {
        mpPages[idx] = {
          ...mpPages[idx],
          Production_Deployment_Status: 'Deployed',
          Feature_Flag_Status:          ffStatus || mpPages[idx].Feature_Flag_Status,
          Release_Date:                 releaseDate,
        };
        changed = true;
      }
    }

    if (changed) {
      const updatedMod = { ...mpMod, Pages: mpPages };
      const countablePages = mpPages.filter(p => !EXCLUDED_PAGES.has(p.page_name));
      const allReady = countablePages.length > 0 && countablePages.every(p =>
        (p.Production_Deployment_Status || '').toLowerCase() === 'deployed'
      );
      if (allReady) updatedMod.Actual_Release_Date = releaseDate;
      await _putModuleRecord(projectId, updatedMod);
    }
  }

  for (const prNum of prNumbers) {
    const prs = await getPRByNumber(projectId, prNum);
    if (!prs || !prs.length) continue;
    for (const pr of prs) {
      await putItem('PRDetails', { ...pr, Status: 'Prod Deployed', Release_Date: releaseDate });
    }
  }

  await _putReleaseRecord(projectId, { ...rel, Completed: true, Completed_At: new Date().toISOString() });
  return { moduleCount: modules.length, prCount: prNumbers.size };
}

// ── Users ─────────────────────────────────────────────────────────
const getUsers        = ()       => scanTable('Users');
const getUserByEmail  = (email)  => getItem('Users', { email });
const upsertUser      = (item)   => putItem('Users', item);
const deleteUser      = (email)  => deleteItem('Users', { email });
const getUsersByCompany = (cid)  => scanTableFiltered('Users', 'company_id', cid);

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
    await new Promise(r => setTimeout(r, 3000));
  }
}

// ── SaaS Migration ────────────────────────────────────────────────
// Migrates existing single-tenant data to a specific company/project.
// Safe to run multiple times (idempotent for already-migrated records).
async function migrateToSaaS(defaultCompanyId, defaultProjectId) {
  console.log('SaaS migration: starting...');
  let count = 0;

  // PRDetails: add project_id to records that lack it
  const prs = await scanTable('PRDetails');
  for (const item of prs) {
    if (!item.project_id) {
      await putItem('PRDetails', { ...item, project_id: defaultProjectId });
      count++;
    }
  }
  console.log(`  PRDetails patched: ${count}`);
  count = 0;

  // StatusTracker: add project_id
  const statuses = await scanTable('StatusTracker');
  for (const item of statuses) {
    if (!item.project_id) {
      await putItem('StatusTracker', { ...item, project_id: defaultProjectId });
      count++;
    }
  }
  console.log(`  StatusTracker patched: ${count}`);
  count = 0;

  // ModulePages: migrate from natural key to compound key
  const modules = await scanTable('ModulePages');
  for (const item of modules) {
    if (!item.project_id) {
      // Create new record with compound key
      await _putModuleRecord(defaultProjectId, { ...item, module_name: item.Module });
      // Delete the old record (natural key)
      await deleteItem('ModulePages', { Module: item.Module });
      count++;
    }
  }
  console.log(`  ModulePages migrated: ${count}`);
  count = 0;

  // ProdReleases: migrate from natural key to compound key
  const releases = await scanTable('ProdReleases');
  for (const item of releases) {
    if (!item.project_id) {
      await _putReleaseRecord(defaultProjectId, { ...item, release_number: String(item.Release_Number) });
      await deleteItem('ProdReleases', { Release_Number: item.Release_Number });
      count++;
    }
  }
  console.log(`  ProdReleases migrated: ${count}`);
  count = 0;

  // Sprints: migrate from natural key to compound key
  const sprints = await scanTable('Sprints');
  for (const item of sprints) {
    if (!item.project_id) {
      await _putSprintRecord(defaultProjectId, { ...item, sprint_name: String(item.Sprint) });
      await deleteItem('Sprints', { Sprint: item.Sprint });
      count++;
    }
  }
  console.log(`  Sprints migrated: ${count}`);

  // Team: migrate from natural key to compound key
  const team = await scanTable('Team');
  for (const item of team) {
    if (!item.project_id) {
      await _putTeamRecord(defaultProjectId, { ...item, role_name: item.Role });
      await deleteItem('Team', { Role: item.Role });
      count++;
    }
  }
  console.log(`  Team migrated: ${count}`);
  count = 0;

  // ReleaseTimeline: migrate from natural key to compound key
  const timeline = await scanTable('ReleaseTimeline');
  for (const item of timeline) {
    if (!item.project_id) {
      await _putTimelineRecord(defaultProjectId, { ...item, release_tl_number: String(item.Release_Number) });
      await deleteItem('ReleaseTimeline', { Release_Number: item.Release_Number });
      count++;
    }
  }
  console.log(`  ReleaseTimeline migrated: ${count}`);
  count = 0;

  // Users: assign existing users to the default company
  const users = await scanTable('Users');
  for (const user of users) {
    if (!user.company_id) {
      const updated = {
        ...user,
        company_id:          defaultCompanyId,
        company_role:        user.role === 'Admin' ? 'CompanyAdmin' : null,
        project_memberships: [{
          project_id: defaultProjectId,
          role: user.role === 'Admin' ? 'Admin' : user.role === 'ReadWrite' ? 'ReadWrite' : 'ReadOnly',
        }],
      };
      await putItem('Users', updated);
    }
  }
  console.log('  Users patched');
  console.log('SaaS migration: complete');
}

// ── Exports ───────────────────────────────────────────────────────
module.exports = {
  // Companies
  getCompanies, getCompany, createCompany, updateCompany, ensureCompaniesTable,
  // Projects
  getProjectsByCompany, getProject, createProject, updateProject, deleteProject, ensureProjectsTable,
  // PRDetails
  getPRs, getPRById, getPRByNumber, addPR, deletePR, updatePR,
  ensurePRDetailsTable,
  // ProdReleases
  getProdReleases, getProdRelease, upsertProdRelease, deleteProdRelease,
  completeRelease, syncPRToRelease, removePRFromOtherReleases,
  // ModulePages
  getModulePages, getModulePage, getModuleNames, getPagesForModule,
  addModule, updateModule, deleteModule,
  addPageToModule, updatePageInModule, deletePageFromModule,
  addOutOfScopePage, removeOutOfScopePage,
  // Lookups (project-scoped)
  getReleaseTimeline, getTeam, getDevelopers, getReviewers,
  // StatusTracker
  getStatusAssignments, getStatusAssignment,
  addStatusAssignment, updateStatusAssignment, deleteStatusAssignment,
  putStatusAssignment, addActivityToAssignment,
  // Sprints
  getSprints, getSprint, upsertSprint, ensureSprintsTable,
  // Users
  getUsers, getUserByEmail, getUsersByCompany, upsertUser, deleteUser, ensureUsersTable,
  // Migration
  migrateToSaaS,
};
