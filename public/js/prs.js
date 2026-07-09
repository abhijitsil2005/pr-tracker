// ═══════════════════════════════════════════════════════
// PULL REQUESTS
// ═══════════════════════════════════════════════════════

// mm/dd/yyyy ↔ yyyy-mm-dd conversions for <input type="date">
function toInputDate(s) {
  if (!s) return '';
  // DB returns YYYY-MM-DD (type parser OID 1082 returns raw string)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Legacy mm/dd/yyyy fallback
  const [m, d, y] = s.split('/');
  if (!y) return '';
  return `${y}-${(m||'').padStart(2,'0')}-${(d||'').padStart(2,'0')}`;
}
function fromInputDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return null;
  return `${m}/${d}/${y}`;
}

// ── Sprint auto-fill ───────────────────────────────────
let _sprintsCache = null;

async function loadSprints() {
  if (_sprintsCache !== null) return _sprintsCache;
  try {
    const res = await authFetch(`${API}/import/sprints`);
    const data = await res.json();
    _sprintsCache = Array.isArray(data) ? data : [];
  } catch (e) {
    _sprintsCache = [];
  }
  return _sprintsCache;
}

function sprintForDate(isoDate) {
  if (!isoDate || !Array.isArray(_sprintsCache)) return null;
  return (_sprintsCache.find(s => isoDate >= s.StartDate && isoDate <= s.EndDate) || {}).Sprint || null;
}

// Wire up auto-fill: when PR Raised Date changes, populate Dev Sprint
document.getElementById('f_raised').addEventListener('change', function () {
  const sprint = sprintForDate(this.value);
  if (sprint) document.getElementById('f_devSprint').value = sprint;
});

// ── Pagination state ───────────────────────────────────
let _prPage     = 1;
let _prPageSize = 25;
let _prTotal    = 0;

const _PR_STATUS_ORDER = {
  'development inprogress': 1,
  'dev pr in review':       2,
  'tcr testing in progress':3,
  'ready for prod deploy':  4,
  'prod deployed ff off':   5,
  'prod deployed':          6,
};
const _prStatusRank = s => _PR_STATUS_ORDER[(s||'').toLowerCase()] ?? 99;

function _filteredSortedPRs() {
  const search = (document.getElementById('searchInput').value || '').toLowerCase();
  let rows = allPRs;
  if (search) rows = rows.filter(p =>
    String(p.PR).includes(search) ||
    (p.Title||'').toLowerCase().includes(search) ||
    (p.Developer||'').toLowerCase().includes(search) ||
    (p.Module||'').toLowerCase().includes(search) ||
    (p.Status||'').toLowerCase().includes(search));
  return rows.slice().sort((a, b) => {
    const sd = _prStatusRank(a.Status) - _prStatusRank(b.Status);
    return sd !== 0 ? sd : b.PR - a.PR;
  });
}

async function renderPRs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.module)    params.set('module',    filters.module);
  if (filters.developer) params.set('developer', filters.developer);
  if (filters.status)    params.set('status',    filters.status);
  const data = await api(`prs?${params}`);
  allPRs = (data && data.data) || [];

  const statSel = document.getElementById('filterStatus');
  const cur = statSel.value;
  statSel.innerHTML = '<option value="">All Statuses</option>';
  [...new Set(allPRs.map(p => p.Status).filter(Boolean))].sort().forEach(s => statSel.add(new Option(s, s)));
  statSel.value = cur;

  _prPage = 1;
  _renderPRPage();
}

function _renderPRPage() {
  const sorted = _filteredSortedPRs();
  _prTotal = sorted.length;
  const start = (_prPage - 1) * _prPageSize;
  const page  = sorted.slice(start, start + _prPageSize);

  document.getElementById('prTableBody').innerHTML = page.map(p => `
    <tr>
      <td><strong style="color:var(--accent)">#${p.PR}</strong></td>
      <td>${p.Module||'—'}</td>
      <td>${p.Developer||'—'}</td>
      <td><div class="tag-list">${(p.Page||[]).map(pg=>`<span class="tag">${pg.split('/').pop()}</span>`).join('')}</div></td>
      <td>${p.Dev_Sprint||'—'}</td>
      <td>${statusBadge(p.Status)}</td>
      <td style="white-space:nowrap">${p['PR Raised Date']||'—'}</td>
      <td style="white-space:nowrap">${p.Target_Release||'—'}</td>
      <td style="white-space:nowrap">
        ${canWrite() ? `<button class="btn btn-ghost btn-sm" onclick="openEditPRModal('${p.id}')">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deletePR('${p.id}')">🗑</button>` : ''}
      </td>
    </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:32px">No PRs found</td></tr>`;

  _renderPRPagination();
}

function _renderPRPagination() {
  const bar = document.getElementById('prPagination');
  if (!bar) return;
  const totalPages = Math.max(1, Math.ceil(_prTotal / _prPageSize));
  const from = _prTotal === 0 ? 0 : (_prPage - 1) * _prPageSize + 1;
  const to   = Math.min(_prPage * _prPageSize, _prTotal);

  // Build page number window (max 7 slots)
  let pageNums = [];
  if (totalPages <= 7) {
    pageNums = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    pageNums = [1];
    const lo = Math.max(2, _prPage - 2);
    const hi = Math.min(totalPages - 1, _prPage + 2);
    if (lo > 2) pageNums.push('…');
    for (let i = lo; i <= hi; i++) pageNums.push(i);
    if (hi < totalPages - 1) pageNums.push('…');
    pageNums.push(totalPages);
  }

  const pageButtons = pageNums.map(p =>
    p === '…'
      ? `<span class="pg-ellipsis">…</span>`
      : `<button class="pg-btn${p === _prPage ? ' active' : ''}" onclick="goPRPage(${p})">${p}</button>`
  ).join('');

  const sizeOpts = [10, 25, 50, 100].map(n =>
    `<option value="${n}"${n === _prPageSize ? ' selected' : ''}>${n}</option>`
  ).join('');

  bar.innerHTML = `
    <span class="pg-info">Showing <strong>${from}–${to}</strong> of <strong>${_prTotal}</strong> PRs</span>
    <div class="pg-controls">
      <button class="pg-btn" onclick="goPRPage(${_prPage - 1})"${_prPage === 1 ? ' disabled' : ''}>‹</button>
      ${pageButtons}
      <button class="pg-btn" onclick="goPRPage(${_prPage + 1})"${_prPage === totalPages ? ' disabled' : ''}>›</button>
    </div>
    <label class="pg-size-label">Rows <select class="pg-size-sel" onchange="setPRPageSize(this.value)">${sizeOpts}</select></label>`;
}

function goPRPage(page) {
  const totalPages = Math.max(1, Math.ceil(_prTotal / _prPageSize));
  _prPage = Math.max(1, Math.min(page, totalPages));
  _renderPRPage();
}

function setPRPageSize(size) {
  _prPageSize = Number(size);
  _prPage = 1;
  _renderPRPage();
}

// Server filters re-fetch; search is client-side only
['filterModule','filterDeveloper','filterStatus'].forEach(id =>
  document.getElementById(id).addEventListener('change', () => {
    renderPRs({
      module:    document.getElementById('filterModule').value,
      developer: document.getElementById('filterDeveloper').value,
      status:    document.getElementById('filterStatus').value,
    });
  })
);
document.getElementById('searchInput').addEventListener('input', () => {
  _prPage = 1;
  _renderPRPage();
});
function applyFilters() {
  renderPRs({
    module:    document.getElementById('filterModule').value,
    developer: document.getElementById('filterDeveloper').value,
    status:    document.getElementById('filterStatus').value,
  });
}

// ── PR Modal ───────────────────────────────────────────
function populatePRModuleSelect(selectedValue) {
  const sel = document.getElementById('f_module');
  sel.innerHTML = '<option value="">— select —</option>';
  lookupModules.sort((a, b) => a.localeCompare(b)).forEach(m => sel.add(new Option(m, m)));
  if (selectedValue) {
    // If the module isn't in lookupModules, add it so the PR's existing module is always visible
    if (![...sel.options].some(o => o.value === selectedValue)) {
      sel.add(new Option(selectedValue, selectedValue));
    }
    sel.value = selectedValue;
  }
}

function openAddPRModal() {
  editingPR = null;
  document.getElementById('prModalTitle').textContent = 'Add PR';
  document.getElementById('savePRBtn').textContent = 'Add PR';
  clearPRForm();
  populatePRModuleSelect();
  loadSprints();
  document.getElementById('prModal').classList.add('open');
}

async function openAddPRModalForPage(moduleName, pageName) {
  await loadSprints();
  editingPR = null;
  document.getElementById('prModalTitle').textContent = 'Add PR';
  document.getElementById('savePRBtn').textContent = 'Add PR';
  clearPRForm();
  populatePRModuleSelect();
  document.getElementById('f_module').value = moduleName;
  await loadPageOptions();
  document.getElementById('f_pages').querySelectorAll('.page-chip').forEach(chip => {
    if (chip.dataset.value === pageName) chip.classList.add('selected');
  });
  document.getElementById('prModal').classList.add('open');
}

async function openEditPRModal(id) {
  await loadSprints();
  const pr = await api(`prs/by-id/${id}`);
  editingPR = pr.id;
  document.getElementById('prModalTitle').textContent = `Edit PR #${pr.PR}`;
  document.getElementById('savePRBtn').textContent = 'Update PR';
  document.getElementById('f_pr').value = pr.PR;
  document.getElementById('f_pr').disabled = true;
  document.getElementById('f_firstResponseGroup').style.display = 'none';
  document.getElementById('f_title').value = pr.Title||'';
  document.getElementById('f_description').value = pr.Description||'';
  document.getElementById('f_additionalDetails').value = pr.Additional_Details||'';
  document.getElementById('f_type').value = pr.Type||'Development';
  populatePRModuleSelect(pr.Module||'');
  document.getElementById('f_developer').value = pr.Developer||'';
  await loadPageOptions();
  const savedPages = (pr.Page||[]).map(p => (p||'').trim()).filter(Boolean);
  const pageMatches = (chipVal, saved) =>
    saved === chipVal ||
    saved.endsWith('/' + chipVal) ||
    chipVal.endsWith('/' + saved) ||
    saved.split('/').pop() === chipVal.split('/').pop();
  document.getElementById('f_pages').querySelectorAll('.page-chip').forEach(chip => {
    const v = chip.dataset.value || '';
    if (savedPages.some(s => pageMatches(v, s))) chip.classList.add('selected');
  });
  document.getElementById('f_status').value = pr.Status||'';
  document.getElementById('f_reviewer').value = pr.Reviewer||'';
  document.getElementById('f_raised').value = toInputDate(pr['PR Raised Date']);
  document.getElementById('f_firstResponse').value = pr['PR First Response Date']||'';
  document.getElementById('f_approved').value = toInputDate(pr['PR Approved Date']);
  document.getElementById('f_merged').value = toInputDate(pr['PR Merged Date']);
  document.getElementById('f_devSprint').value = pr.Dev_Sprint||'';
  document.getElementById('f_testSprint').value = pr.Testing_Sprint||'';
  document.getElementById('f_target').value = pr.Target_Release||'';
  document.getElementById('f_task').value = pr.Task||'';
  document.getElementById('f_deps').value = (pr.Dependent_PRs||[]).join(', ');
  document.getElementById('prModal').classList.add('open');
}

function closePRModal() {
  document.getElementById('prModal').classList.remove('open');
  document.getElementById('f_pr').disabled = false;
  editingPR = null;
}

function clearPRForm() {
  document.getElementById('f_firstResponseGroup').style.display = '';
  ['f_pr','f_title','f_description','f_additionalDetails','f_raised','f_firstResponse','f_approved','f_merged','f_devSprint','f_testSprint','f_task','f_deps'].forEach(id=>{ document.getElementById(id).value=''; });
  ['f_type','f_module','f_developer','f_status','f_reviewer','f_target'].forEach(id=>{ document.getElementById(id).selectedIndex=0; });
  document.getElementById('f_pages').innerHTML = '<span class="page-chip-hint">— select a module first —</span>';
}

async function loadPageOptions() {
  const mod = document.getElementById('f_module').value;
  const container = document.getElementById('f_pages');
  container.innerHTML = '';
  if (!mod) {
    container.innerHTML = '<span class="page-chip-hint">— select a module first —</span>';
    return;
  }
  const pages = await api(`lookup/modules/${encodeURIComponent(mod)}/pages`);
  if (!pages || !pages.length) {
    container.innerHTML = '<span class="page-chip-hint">No pages defined for this module</span>';
    return;
  }
  const tail = new Set(['api', 'infrastructure pages']);
  const sorted = [...pages].sort((a, b) => {
    const aT = tail.has((a.page_name || '').toLowerCase());
    const bT = tail.has((b.page_name || '').toLowerCase());
    if (aT !== bT) return aT ? 1 : -1;
    if (aT && bT) {
      // Within tail: API before Infrastructure Pages
      const aI = (a.page_name || '').toLowerCase() === 'infrastructure pages';
      const bI = (b.page_name || '').toLowerCase() === 'infrastructure pages';
      if (aI !== bI) return aI ? 1 : -1;
    }
    return (a.page_name || '').localeCompare(b.page_name || '');
  });
  sorted.forEach(p => {
    const chip = document.createElement('span');
    chip.className = 'page-chip';
    chip.textContent = p.page_name;
    chip.dataset.value = p.page_name;
    chip.onclick = () => chip.classList.toggle('selected');
    container.appendChild(chip);
  });
}

async function savePR() {
  const pr = Number(document.getElementById('f_pr').value);
  if (!pr) return showToast('PR number is required','error');
  const body = {
    PR:pr,
    Title:document.getElementById('f_title').value.trim()||null,
    Description:document.getElementById('f_description').value.trim()||null,
    Additional_Details:document.getElementById('f_additionalDetails').value.trim()||null,
    Type:document.getElementById('f_type').value,
    Module:document.getElementById('f_module').value||null,
    Developer:document.getElementById('f_developer').value||null,
    Page:[...document.getElementById('f_pages').querySelectorAll('.page-chip.selected')].map(c=>c.dataset.value),
    Status:document.getElementById('f_status').value||null,
    Reviewer:document.getElementById('f_reviewer').value||null,
    'PR Raised Date':fromInputDate(document.getElementById('f_raised').value),
    'PR First Response Date':document.getElementById('f_firstResponse').value||null,
    'PR Approved Date':fromInputDate(document.getElementById('f_approved').value),
    'PR Merged Date':fromInputDate(document.getElementById('f_merged').value),
    Dev_Sprint:document.getElementById('f_devSprint').value||null,
    Testing_Sprint:document.getElementById('f_testSprint').value||null,
    Target_Release:document.getElementById('f_target').value||null,
    Task:document.getElementById('f_task').value.trim()||null,
    Dependent_PRs:document.getElementById('f_deps').value.split(',').map(s=>s.trim()).filter(Boolean).map(Number),
  };
  const isEdit = !!editingPR;
  const res = await authFetch(`${API}/prs${isEdit?'/'+editingPR:''}`, { method:isEdit?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');

  const sync = json.sync || {};
  if (sync.synced) {
    showToast(`${isEdit ? `PR #${pr} updated` : `PR #${pr} created`} · Release ${sync.releaseNumber} synced`, 'success');
  } else if (body.Target_Release && sync.reason && sync.reason.startsWith('no_release_for_date')) {
    showToast(`PR saved · No release found for date ${body.Target_Release} — add it in Releases tab first`, 'error');
  } else {
    showToast(isEdit?`PR #${pr} updated`:`PR #${pr} created`,'success');
  }

  closePRModal();
  renderPRs();
  if (document.getElementById('section-modules').classList.contains('active')) renderModulePages();
  if (document.getElementById('section-releases').classList.contains('active')) renderReleases();
}

async function deletePR(id) {
  if (!confirm(`Delete this PR entry?`)) return;
  const res = await authFetch(`${API}/prs/${id}`,{method:'DELETE'});
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast(json.message || 'PR deleted','success');
  renderPRs();
}
