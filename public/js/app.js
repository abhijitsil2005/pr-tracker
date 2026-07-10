const API = '/api';

// ── Calculation exclusions (loaded from project settings) ──
const _DEFAULT_EXCL_PAGES   = ['Infrastructure Pages', 'API', 'Shared Controls'];
const _DEFAULT_EXCL_MODULES = ['Shared Controls'];
let EXCLUDED_FROM_PAGES  = new Set(_DEFAULT_EXCL_PAGES);
let EXCLUDED_FROM_MODULE = new Set(_DEFAULT_EXCL_MODULES);

// ── State ──────────────────────────────────────────────
let allPRs = [], allReleases = [], allModulePages = [];
let lookupModules = [], lookupDevelopers = [], lookupReviewers = [], lookupTimeline = [], lookupPRStatuses = [];
let editingPR = null, editingRelease = null;
let pageModalCtx = null; // { moduleName, pageName (for edit) }
let pagePRCtx   = null; // { moduleName, pageName } for PR-page association modal
let stCtx       = null; // { id, developer, module, page, ... } for activity modal

// ── Nav collapse ───────────────────────────────────────
function toggleNav() {
  const nav = document.getElementById('mainNav');
  const collapsed = nav.classList.toggle('collapsed');
  localStorage.setItem('navCollapsed', collapsed);
}

// ── Init (called by auth.js after successful login) ────
async function init() {
  if (localStorage.getItem('navCollapsed') === 'true') {
    document.getElementById('mainNav').classList.add('collapsed');
  }
  await loadLookups();
  populateFilters();
  showSection('dashboard');
  setupDragDrop();
}

async function loadLookups() {
  const [mods, devs, revs, tl, statuses, proj] = await Promise.all([
    api('lookup/modules'),
    api('lookup/developers'),
    api('lookup/reviewers'),
    api('lookup/timeline'),
    api('lookup/pr-statuses'),
    currentUser?.project_id ? api(`projects/${currentUser.project_id}`) : Promise.resolve(null),
  ]);
  lookupModules = mods || [];
  lookupDevelopers = (devs || []).sort((a, b) => a.localeCompare(b));
  lookupReviewers  = (revs || []).sort((a, b) => a.localeCompare(b));
  lookupTimeline = tl || [];
  lookupPRStatuses = statuses || [];
  _applyProjectExclusions(proj);
}

// Fill a PR-status <select> from the project's configured list (Project
// Setup > PR Status), keeping a leading placeholder option if present.
function populatePRStatusSelect(sel, selectedValue) {
  const placeholder = sel.options.length && !sel.options[0].value ? sel.options[0] : null;
  sel.innerHTML = '';
  if (placeholder) sel.add(placeholder);
  lookupPRStatuses.forEach(s => sel.add(new Option(s.Name, s.Name)));
  if (selectedValue) {
    if (![...sel.options].some(o => o.value === selectedValue)) {
      sel.add(new Option(selectedValue, selectedValue));
    }
    sel.value = selectedValue;
  }
}

// Re-populate every PR-status <select> from the current lookupPRStatuses —
// call after an admin add/remove/reorder so open forms reflect it without a
// full reload. (Unlike populateFilters(), safe to call repeatedly: each
// populatePRStatusSelect() call clears its <select> first.)
function refreshPRStatusSelects() {
  populatePRStatusSelect(document.getElementById('f_status'));
  populatePRStatusSelect(document.getElementById('am_qpr_status'));
  populatePRStatusSelect(document.getElementById('qpr_status'));
}

function _applyProjectExclusions(proj) {
  EXCLUDED_FROM_PAGES  = new Set(proj?.excluded_pages  ?? _DEFAULT_EXCL_PAGES);
  EXCLUDED_FROM_MODULE = new Set(proj?.excluded_modules ?? _DEFAULT_EXCL_MODULES);
}

async function api(path, opts = {}) {
  const res = await authFetch(`${API}/${path}`, opts);
  if (!res || res.status === 401) return null;
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
  [...lookupTimeline]
    .sort((a, b) => Number(a.Release_Number) - Number(b.Release_Number))
    .forEach(t => fTarget.add(new Option(`${t.Release_Date} (R${t.Release_Number})`, t.Release_Date)));
  const stDev = document.getElementById('stFilterDev');
  lookupDevelopers.forEach(d => stDev.add(new Option(d, d)));
  const filterDev = document.getElementById('filterDeveloper');
  lookupDevelopers.forEach(d => filterDev.add(new Option(d, d)));

  populatePRStatusSelect(document.getElementById('f_status'));
  populatePRStatusSelect(document.getElementById('am_qpr_status'));
  populatePRStatusSelect(document.getElementById('qpr_status'));
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
  const titles = {
    dashboard: 'Dashboard',
    prs:       'Pull Requests',
    releases:  'Releases',
    modules:   'Module Pages',
    status:    'Status Tracker',
    reports:   'Reports',
    sync:      'Sync Excel',
    admin:     'Admin',
  };
  document.getElementById('pageTitle').textContent = titles[name] || name;
  const ha = document.getElementById('headerActions');
  ha.innerHTML = '';
  if (name === 'prs'     && canWrite()) ha.innerHTML = `<button class="btn btn-primary" onclick="openAddPRModal()">＋ Add PR</button>`;
  if (name === 'status'  && canWrite()) ha.innerHTML = `<button class="btn btn-primary" onclick="openAssignmentModal()">＋ Assign</button>`;
  if (name === 'modules' && canWrite()) ha.innerHTML = `<button class="btn btn-primary" onclick="openAddModuleModal()">＋ Add Module</button>`;
  if (name === 'dashboard') renderDashboard();
  if (name === 'prs')       renderPRs();
  if (name === 'releases')  renderReleases();
  if (name === 'modules')   renderModulePages();
  if (name === 'status')    renderStatusTracker();
  if (name === 'reports')   renderReports();
  if (name === 'admin')     renderAdminPage();
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

function prPillClass(status) {
  if (!status) return 'pr-pill-gray';
  const l = status.toLowerCase();
  if (l.includes('prod deployed')) return 'pr-pill-green';
  if (l.includes('ready for prod')) return 'pr-pill-teal';
  if (l.includes('tcr')) return 'pr-pill-yellow';
  if (l.includes('review') || l.includes('inprogress') || l.includes('in progress')) return 'pr-pill-orange';
  return 'pr-pill-gray';
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
