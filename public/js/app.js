const API = '/api';

// ── State ──────────────────────────────────────────────
let allPRs = [], allReleases = [], allModulePages = [];
let lookupModules = [], lookupDevelopers = [], lookupReviewers = [], lookupTimeline = [];
let editingPR = null, editingRelease = null;
let pageModalCtx = null; // { moduleName, pageName (for edit) }
let pagePRCtx   = null; // { moduleName, pageName } for PR-page association modal
let stCtx       = null; // { id, developer, module, page, ... } for activity modal

// ── Init ───────────────────────────────────────────────
async function init() {
  await loadLookups();
  populateFilters();
  showSection('dashboard');
  setupDragDrop();
}

async function loadLookups() {
  const [mods, devs, revs, tl] = await Promise.all([
    api('lookup/modules'),
    api('lookup/developers'),
    api('lookup/reviewers'),
    api('lookup/timeline'),
  ]);
  lookupModules = mods || [];
  lookupDevelopers = devs || [];
  lookupReviewers = revs || [];
  lookupTimeline = tl || [];
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}/${path}`, opts);
  return res.json().catch(() => null);
}

function populateFilters() {
  const modSel = document.getElementById('filterModule');
  lookupModules.forEach(m => modSel.add(new Option(m, m)));
  const fDev = document.getElementById('f_developer');
  lookupDevelopers.forEach(d => fDev.add(new Option(d, d)));
  const fRev = document.getElementById('f_reviewer');
  lookupReviewers.forEach(r => fRev.add(new Option(r, r)));
  const fTarget = document.getElementById('f_target');
  lookupTimeline.forEach(t => fTarget.add(new Option(`${t.Release_Date} (R${t.Release_Number})`, t.Release_Date)));
  const stDev = document.getElementById('stFilterDev');
  lookupDevelopers.forEach(d => stDev.add(new Option(d, d)));
  const filterDev = document.getElementById('filterDeveloper');
  lookupDevelopers.forEach(d => filterDev.add(new Option(d, d)));
}

// ── Navigation ─────────────────────────────────────────
document.querySelectorAll('nav ul li a').forEach(a => {
  a.addEventListener('click', e => {
    e.preventDefault();
    document.querySelectorAll('nav ul li a').forEach(x => x.classList.remove('active'));
    a.classList.add('active');
    showSection(a.dataset.section);
  });
});

function showSection(name) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${name}`).classList.add('active');
  const titles = { dashboard:'Dashboard', prs:'Pull Requests', releases:'Releases', modules:'Module Pages', status:'Status Tracker', sync:'Sync Excel' };
  document.getElementById('pageTitle').textContent = titles[name] || name;
  const ha = document.getElementById('headerActions');
  ha.innerHTML = '';
  if (name === 'prs')    ha.innerHTML = `<button class="btn btn-primary" onclick="openAddPRModal()">＋ Add PR</button>`;
  if (name === 'status') ha.innerHTML = `<button class="btn btn-primary" onclick="openAssignmentModal()">＋ Assign</button>`;
  if (name === 'dashboard') renderDashboard();
  if (name === 'prs')    renderPRs();
  if (name === 'releases') renderReleases();
  if (name === 'modules')  renderModulePages();
  if (name === 'status')   renderStatusTracker();
}

// ── Status badges ───────────────────────────────────────
function statusBadge(s) {
  if (!s) return '<span class="badge badge-gray">—</span>';
  const l = s.toLowerCase();
  if (l.includes('prod deployed') && l.includes('ff on')) return `<span class="badge badge-green">${s}</span>`;
  if (l.includes('prod deployed')) return `<span class="badge badge-blue">${s}</span>`;
  if (l.includes('tcr')) return `<span class="badge badge-yellow">${s}</span>`;
  if (l.includes('review')) return `<span class="badge badge-orange">${s}</span>`;
  return `<span class="badge badge-gray">${s}</span>`;
}

function ffBadge(status) {
  const l = (status || '').toLowerCase();
  if (l === 'enabled') return '<span class="badge badge-green">Enabled</span>';
  if (l === 'disabled') return '<span class="badge badge-red">Disabled</span>';
  return `<span class="badge badge-gray">${status || '—'}</span>`;
}

// ── Utils ──────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.querySelectorAll(`#${id} input[disabled]`).forEach(el => el.disabled = false);
}

let toastTimer;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 3500);
}

function escAttr(s) { return s.replace(/'/g, "\\'"); }
