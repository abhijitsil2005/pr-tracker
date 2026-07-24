// ═══════════════════════════════════════════════════════
// STATUS TRACKER
// ═══════════════════════════════════════════════════════
let currentWeek   = getWeekStart(new Date());
let stAssignments = [];

// ── Week helpers ────────────────────────────────────────
function getWeekStart(date) {
  const d   = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKey(d) {
  return d.toISOString().slice(0, 10);
}

function weekLabel(d) {
  const end  = new Date(d);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${d.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

// ── Main render ─────────────────────────────────────────
async function renderStatusTracker() {
  const [assignments, prsData] = await Promise.all([
    api('status'),
    api('prs'),
  ]);
  stAssignments = assignments || [];
  allPRs = (prsData && prsData.data) || [];

  const importBtn  = document.getElementById('btnImportTracker');
  const sprintBtn  = document.getElementById('btnSyncSprints');
  if (importBtn) importBtn.style.display = isAdmin() ? '' : 'none';
  if (sprintBtn) sprintBtn.style.display = isAdmin() ? '' : 'none';

  // Populate sprint filter from current assignments
  const sprintSel = document.getElementById('stFilterSprint');
  const curSprint = sprintSel.value;
  sprintSel.innerHTML = '<option value="">All Sprints</option>';
  [...new Set(stAssignments.map(a => a.Sprint).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .forEach(s => sprintSel.add(new Option(`Sprint ${s}`, s)));
  sprintSel.value = curSprint;

  const filterSprint = sprintSel.value;
  const filterDev    = document.getElementById('stFilterDev').value;
  let list = stAssignments;
  if (filterSprint) list = list.filter(a => a.Sprint === filterSprint);
  if (filterDev)    list = list.filter(a => a.Developer === filterDev);

  const container = document.getElementById('stContainer');

  if (!list.length) {
    container.innerHTML = `<div class="empty">
      <div class="e-icon">📋</div>
      <p>No assignments for this week.</p>
      ${canWrite() ? `<p style="margin-top:10px"><button class="btn btn-primary" onclick="openAssignmentModal()">＋ Assign a page</button></p>` : ''}
    </div>`;
    return;
  }

  // Group by developer, sort alphabetically
  const byDev = {};
  list.forEach(a => {
    if (!byDev[a.Developer]) byDev[a.Developer] = [];
    byDev[a.Developer].push(a);
  });

  container.innerHTML = Object.entries(byDev)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dev, items]) => buildDevCard(dev, items))
    .join('');

  renderDevPRSummary();
}

function toggleStDevSection() {
  const body = document.getElementById('stDevBody');
  const chev = document.getElementById('stDevChev');
  if (!body) return;
  const collapsed = body.classList.toggle('st-collapsed');
  if (chev) chev.classList.toggle('open', !collapsed);
  try { localStorage.setItem('st-devsum-collapsed', collapsed ? '1' : '0'); } catch {}
}

function renderDevPRSummary() {
  const excluded = typeof EXCLUDED_FROM_MODULE !== 'undefined' ? EXCLUDED_FROM_MODULE : new Set();
  const devMap = {};
  allPRs.filter(p => !excluded.has(p.Module)).forEach(p => {
    const d = p.Developer || 'Unknown';
    if (!devMap[d]) devMap[d] = { prs: 0, modules: new Set() };
    devMap[d].prs++;
    if (p.Module) devMap[d].modules.add(p.Module);
  });

  const tbody = Object.entries(devMap)
    .sort((a, b) => b[1].prs - a[1].prs)
    .map(([d, v]) => `<tr>
      <td>${escHtml(d)}</td>
      <td><strong>${v.prs}</strong></td>
      <td><div class="tag-list">${[...v.modules].map(m => `<span class="tag">${escHtml(m)}</span>`).join('')}</div></td>
    </tr>`).join('');

  let collapsed = true;
  try { collapsed = localStorage.getItem('st-devsum-collapsed') !== '0'; } catch {}

  document.getElementById('stDevSection').innerHTML = `
    <div class="st-devsum-header" onclick="toggleStDevSection()">
      <span class="st-chev${collapsed ? '' : ' open'}" id="stDevChev">▶</span>
      <span style="font-size:13px;font-weight:600;color:var(--text2);letter-spacing:.04em;text-transform:uppercase">PR Summary by Developer</span>
    </div>
    <div id="stDevBody" class="st-dev-body${collapsed ? ' st-collapsed' : ''}">
      <div class="table-wrap" style="margin-top:10px">
        <table style="font-size:12px">
          <thead><tr><th>Developer</th><th>PRs</th><th>Modules</th></tr></thead>
          <tbody>${tbody || '<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:16px">No PR data</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Dev card helpers ────────────────────────────────────
const _ST_PALETTE = ['#4f7ef8','#22c55e','#f97316','#a855f7','#06b6d4','#ef4444','#eab308','#7c5cfc'];
function _stHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return Math.abs(h);
}
function _devColor(name)  { return _ST_PALETTE[_stHash(name)  % _ST_PALETTE.length]; }
function _modColor(name)  { return _ST_PALETTE[(_stHash(name) + 3) % _ST_PALETTE.length]; }
function _devInitial(n)   { return (n || '?').trim().charAt(0).toUpperCase(); }
function _typeBadge(type) {
  const t = (type || 'Development').trim();
  const map = { 'Development': 'badge-blue', 'Iteration Bug': 'badge-orange', 'TCR Bug': 'badge-yellow', 'Prod Bug': 'badge-red' };
  const cls = map[t] || 'badge-blue';
  return `<span class="badge ${cls}" style="font-size:10px;white-space:nowrap">${escHtml(t)}</span>`;
}

function toggleDevCard(safeId) {
  const body = document.getElementById(`st-body-${safeId}`);
  const chev = document.getElementById(`st-chev-${safeId}`);
  if (!body) return;
  const collapsed = body.classList.toggle('st-collapsed');
  if (chev) chev.classList.toggle('open', !collapsed);
  try { localStorage.setItem(`st-col-${safeId}`, collapsed ? '1' : '0'); } catch {}
}

function buildDevCard(dev, items) {
  const done    = items.filter(i => i.Status === 'Done').length;
  const blocked = items.filter(i => i.Status === 'Blocked').length;
  const inProg  = items.filter(i => i.Status === 'In Progress').length;
  const total   = items.length;

  const safeId  = dev.replace(/[^a-z0-9]/gi, '_');
  const devClr  = _devColor(dev);
  const initial = _devInitial(dev);

  let startCollapsed = true;
  try { startCollapsed = localStorage.getItem(`st-col-${safeId}`) !== '0'; } catch {}

  // Group by module, sorted alphabetically
  const byModule = {};
  items.forEach(a => {
    const mod = a.Module || '(no module)';
    if (!byModule[mod]) byModule[mod] = [];
    byModule[mod].push(a);
  });

  const tableRows = Object.entries(byModule)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([mod, modItems]) => {
      const mc         = _modColor(mod);
      const modDone    = modItems.filter(i => i.Status === 'Done').length;
      const modBlocked = modItems.filter(i => i.Status === 'Blocked').length;
      const modInProg  = modItems.filter(i => i.Status === 'In Progress').length;
      const modTotal   = modItems.length;

      const modRow = `<tr class="st-mod-row">
        <td colspan="8" class="st-mod-cell" style="border-left:3px solid ${mc}">
          <div class="st-mod-header">
            <span class="st-mod-dot" style="background:${mc}"></span>
            <span class="st-mod-name">${escHtml(mod)}</span>
            <span class="st-mod-count">${modTotal} page${modTotal !== 1 ? 's' : ''}</span>
            ${modInProg  ? `<span class="badge badge-orange" style="font-size:10px">${modInProg} in progress</span>` : ''}
            ${modDone    ? `<span class="badge badge-green"  style="font-size:10px">${modDone} done</span>` : ''}
            ${modBlocked ? `<span class="badge badge-red"    style="font-size:10px">${modBlocked} blocked</span>` : ''}
          </div>
        </td>
      </tr>`;

      const pageRows = [...modItems].sort((a, b) => (a.Page || '').localeCompare(b.Page || '')).map((a, idx) => {
        const isLast  = idx === modItems.length - 1;
        const logs    = a.ActivityLog || [];
        const lastLog = logs[logs.length - 1];
        const lastNote = lastLog
          ? `<span class="st-last-note" title="${escHtml(lastLog.note)}">${timeAgo(lastLog.timestamp)} — ${escHtml(lastLog.note.slice(0, 52))}${lastLog.note.length > 52 ? '…' : ''}</span>`
          : '<span class="st-last-note muted">No activity</span>';
        const prList  = a.PRs || [];
        const prBadge = prList.length
          ? prList.map(prNum => {
              const rec = allPRs.find(p => p.PR === Number(prNum) && p.Module === a.Module) || allPRs.find(p => p.PR === Number(prNum));
              return rec
                ? `<span class="pr-pill" onclick="openEditPRModal('${rec.id}')">#${prNum}</span>`
                : `<span class="pr-pill" style="opacity:.5">#${prNum}</span>`;
            }).join('')
          : '<span class="st-dash">—</span>';
        // Task/Sprint auto-fill falls back to whichever PR was linked most recently
        const lastPRNum = prList.length ? prList[prList.length - 1] : null;
        const lastPRRec = lastPRNum
          ? (allPRs.find(p => p.PR === Number(lastPRNum) && p.Module === a.Module) || allPRs.find(p => p.PR === Number(lastPRNum)))
          : null;
        const taskVal     = (lastPRRec && lastPRRec.Task) || a.Task || null;
        const taskDisplay = taskVal
          ? `<span class="st-meta">#${escHtml(String(taskVal))}</span>`
          : '<span class="st-dash">—</span>';
        const sprintVal     = a.Sprint || (lastPRRec && lastPRRec.Dev_Sprint) || null;
        const sprintDisplay = sprintVal
          ? `<span class="badge badge-gray" style="font-size:10px">${escHtml(String(sprintVal))}</span>`
          : '<span class="st-dash">—</span>';

        const statusKey  = (a.Status || 'pending').toLowerCase().replace(/\s+/g, '-');
        const statusOpts = ['Pending', 'In Progress', 'In Review', 'Blocked', 'Dev Done', 'Bug Fixing', 'Done']
          .map(s => `<option${a.Status === s ? ' selected' : ''}>${s}</option>`).join('');
        const statusCell = canWrite()
          ? `<select class="st-status-sel" data-status="${statusKey}" onchange="quickUpdateStatus(this,'${a.id}','${escAttr(a.Status || 'Pending')}',this.value)">${statusOpts}</select>`
          : stStatusBadge(a.Status);

        return `<tr class="st-page-row">
          <td class="st-page-name" style="border-left:3px solid ${mc}40" title="${escHtml(a.Page || '')}">
            <span class="st-tree">${isLast ? '└' : '├'}</span><span class="st-pname">${escHtml(a.Page || '—')}</span>
          </td>
          <td>${statusCell}</td>
          <td>${_typeBadge(a.Type)}</td>
          <td class="st-pr-cell">${prBadge}</td>
          <td>${taskDisplay}</td>
          <td>${sprintDisplay}</td>
          <td class="st-act-cell">${lastNote}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-primary btn-xs" onclick="openActivityModal('${a.id}')" title="Activity log (${logs.length})">📝 ${logs.length}</button>
            ${canWrite() ? `<button class="btn btn-ghost btn-xs" onclick="openEditAssignmentModal('${a.id}')" title="Edit">✏️</button>
            <button class="btn btn-danger btn-xs" onclick="deleteAssignment('${a.id}')" title="Remove">🗑</button>` : ''}
          </td>
        </tr>`;
      }).join('');

      return modRow + pageRows;
    }).join('');

  return `<div class="st-dev-card" style="border-top:3px solid ${devClr}">
    <div class="st-dev-header" onclick="toggleDevCard('${safeId}')" style="cursor:pointer">
      <div class="st-dev-left">
        <span class="st-chev${startCollapsed ? '' : ' open'}" id="st-chev-${safeId}">▶</span>
        <span class="st-dev-avatar" style="background:${devClr}">${initial}</span>
        <span class="st-dev-name">${escHtml(dev)}</span>
        <span class="badge badge-blue">${total} page${total !== 1 ? 's' : ''}</span>
        ${inProg  ? `<span class="badge badge-orange">${inProg} in progress</span>` : ''}
        ${done    ? `<span class="badge badge-green">${done} done</span>` : ''}
        ${blocked ? `<span class="badge badge-red">${blocked} blocked</span>` : ''}
      </div>
      ${canWrite() ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openAssignmentModalForDev('${escAttr(dev)}')">＋ Add Page</button>` : ''}
    </div>
    <div class="st-dev-body${startCollapsed ? ' st-collapsed' : ''}" id="st-body-${safeId}">
      <div class="table-wrap" style="border-radius:0;border-left:none;border-right:none;border-bottom:none">
        <table class="st-table">
          <colgroup>
            <col style="width:19%"><col style="width:12%"><col style="width:9%">
            <col style="width:6%"><col style="width:6%"><col style="width:6%"><col style="width:28%"><col style="width:14%">
          </colgroup>
          <thead><tr>
            <th class="st-th-page">Page</th><th>Status</th><th>Type</th><th>PR</th>
            <th>Task</th><th>Sprint</th><th>Last Activity</th><th>Actions</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>
  </div>`;
}

async function quickUpdateStatus(el, id, oldStatus, newStatus) {
  if (oldStatus === newStatus) return;
  // Optimistically update the select colour
  el.dataset.status = newStatus.toLowerCase().replace(/\s+/g, '-');
  const res = await authFetch(`${API}/status/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Status: newStatus }),
  });
  if (!res.ok) {
    const j = await res.json();
    showToast(j.error || 'Update failed', 'error');
    // Revert the optimistic UI change in place — no full re-render so cards stay open
    el.value = oldStatus;
    el.dataset.status = oldStatus.toLowerCase().replace(/\s+/g, '-');
    return;
  }
  await authFetch(`${API}/status/${id}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: `Status changed from "${oldStatus}" to "${newStatus}"`, type: 'status_change' }),
  });
  showToast(`Status → ${newStatus}`, 'success');
  const idx = stAssignments.findIndex(a => a.id === id);
  if (idx !== -1) stAssignments[idx] = { ...stAssignments[idx], Status: newStatus };
}

function stStatusBadge(s) {
  const l = (s || 'pending').toLowerCase();
  if (l === 'done')        return `<span class="badge badge-green">${s}</span>`;
  if (l === 'blocked')     return `<span class="badge badge-red">${s}</span>`;
  if (l === 'in review')   return `<span class="badge badge-yellow">${s}</span>`;
  if (l === 'in progress') return `<span class="badge badge-orange">${s}</span>`;
  return `<span class="badge badge-gray">${s || 'Pending'}</span>`;
}

function timeAgo(isoStr) {
  if (!isoStr) return '—';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Week navigation ─────────────────────────────────────
function stPrevWeek() {
  currentWeek = new Date(currentWeek);
  currentWeek.setDate(currentWeek.getDate() - 7);
  renderStatusTracker();
}

function stNextWeek() {
  currentWeek = new Date(currentWeek);
  currentWeek.setDate(currentWeek.getDate() + 7);
  renderStatusTracker();
}

function stGoToday() {
  currentWeek = getWeekStart(new Date());
  renderStatusTracker();
}

// ── Assignment modal ────────────────────────────────────
function openAssignmentModal(prefilledDev) {
  stCtx = null;
  document.getElementById('amTitle').textContent     = 'Assign Page';
  document.getElementById('amSaveBtn').textContent   = 'Assign';
  document.getElementById('am_week').textContent     = weekLabel(currentWeek);
  document.getElementById('am_status').value         = 'In Progress';
  document.getElementById('am_type').value           = 'Development';
  document.getElementById('am_task').value           = '';
  document.getElementById('am_sprint').value         = '';
  document.getElementById('am_note').value           = '';
  document.getElementById('am_pages').innerHTML      = '<span class="page-chip-hint">— select a module first —</span>';
  // Populate developer select
  const devSel = document.getElementById('am_dev');
  devSel.innerHTML = '<option value="">— select —</option>';
  lookupDevelopers.sort((a, b) => (a||'').localeCompare(b||'')).forEach(d => devSel.add(new Option(d, d)));
  devSel.value = prefilledDev || '';
  // Populate module select
  const modSel = document.getElementById('am_module');
  modSel.innerHTML = '<option value="">— select —</option>';
  lookupModules.sort((a, b) => (a||'').localeCompare(b||'')).forEach(m => modSel.add(new Option(m, m)));
  modSel.value = '';
  // PR section — no assignment exists yet, chips are staged locally until Assign
  amPrTA.init({ mode: 'staged', prs: [] });
  const qf1 = document.getElementById('amQuickPRForm'); if (qf1) qf1.style.display = 'none';
  const tb1 = document.getElementById('amToggleQPR');   if (tb1) tb1.textContent = '＋ New PR';
  const qn1 = document.getElementById('am_qpr_number'); if (qn1) qn1.value = '';
  const qr1 = document.getElementById('am_qpr_raised'); if (qr1) qr1.value = '';
  const qs1 = document.getElementById('am_qpr_sprint'); if (qs1) qs1.value = '';
  document.getElementById('assignmentModal').classList.add('open');
}

function openAssignmentModalForDev(dev) {
  openAssignmentModal(dev);
}

async function openEditAssignmentModal(id) {
  const assignments = stAssignments.find(x => x.id === id);
  if (!assignments) return;
  stCtx = assignments;
  document.getElementById('amTitle').textContent     = 'Edit Assignment';
  document.getElementById('amSaveBtn').textContent   = 'Update';
  document.getElementById('am_week').textContent     = weekLabel(currentWeek);
  document.getElementById('am_status').value         = assignments.Status || 'In Progress';
  document.getElementById('am_type').value           = assignments.Type   || 'Development';
  document.getElementById('am_note').value           = '';
  const prList = assignments.PRs || [];
  const lastPRNum = prList.length ? prList[prList.length - 1] : null;
  const existingPRRec = lastPRNum
    ? (allPRs.find(p => p.PR === Number(lastPRNum) && p.Module === assignments.Module) || allPRs.find(p => p.PR === Number(lastPRNum)))
    : null;
  document.getElementById('am_task').value   = assignments.Task   || (existingPRRec && existingPRRec.Task)      || '';
  document.getElementById('am_sprint').value = assignments.Sprint || (existingPRRec && existingPRRec.Dev_Sprint) || '';
  // Populate selects
  const devSel = document.getElementById('am_dev');
  devSel.innerHTML = '<option value="">— select —</option>';
  lookupDevelopers.sort((a, b) => (a||'').localeCompare(b||'')).forEach(d => devSel.add(new Option(d, d)));
  devSel.value = assignments.Developer || '';
  const modSel = document.getElementById('am_module');
  modSel.innerHTML = '<option value="">— select —</option>';
  lookupModules.sort((a, b) => (a||'').localeCompare(b||'')).forEach(m => modSel.add(new Option(m, m)));
  modSel.value = assignments.Module || '';
  await amLoadPageOptions();
  if (assignments.Page) {
    document.getElementById('am_pages').querySelectorAll('.page-chip').forEach(chip => {
      if (chip.dataset.value === assignments.Page) chip.classList.add('selected');
    });
  }
  // PR section — assignment already exists, so add/remove save live immediately
  amPrTA.init({ mode: 'live', assignmentId: assignments.id, prs: prList });
  const qf2 = document.getElementById('amQuickPRForm'); if (qf2) qf2.style.display = 'none';
  const tb2 = document.getElementById('amToggleQPR');   if (tb2) tb2.textContent = '＋ New PR';
  const qn2 = document.getElementById('am_qpr_number'); if (qn2) qn2.value = '';
  const qr2 = document.getElementById('am_qpr_raised'); if (qr2) qr2.value = '';
  const qs2 = document.getElementById('am_qpr_sprint'); if (qs2) qs2.value = '';
  document.getElementById('assignmentModal').classList.add('open');
}

async function amLoadPageOptions() {
  const mod       = document.getElementById('am_module').value;
  const container = document.getElementById('am_pages');
  container.innerHTML = '';
  if (!mod) {
    container.innerHTML = '<span class="page-chip-hint">— select a module first —</span>';
    return;
  }
  const pages = await api(`lookup/modules/${encodeURIComponent(mod)}/pages`);
  if (!pages || !pages.length) {
    container.innerHTML = '<span class="page-chip-hint">No pages for this module</span>';
    return;
  }
  pages.forEach(p => {
    const chip = document.createElement('span');
    chip.className     = 'page-chip';
    chip.textContent   = p.page_name;
    chip.dataset.value = p.page_name;
    chip.onclick       = () => chip.classList.toggle('selected');
    container.appendChild(chip);
  });
}

// Creates one assignment per chip, tolerating duplicate-row rejections from
// the server (same developer already assigned to that module/page) instead
// of aborting the whole batch — returns how many succeeded and which were
// skipped, so the caller can report both.
async function createAssignments(chips, dev, mod, status, type, prNumbers, task, sprint, note) {
  let created = 0;
  const skipped = [];
  for (const chip of chips) {
    const body = { Developer: dev, Module: mod, Page: chip.dataset.value, Week: weekKey(currentWeek), Status: status, Type: type, PRs: prNumbers, Task: task, Sprint: sprint };
    if (note) body.note = note;
    const res = await authFetch(`${API}/status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      created++;
    } else {
      const j = await res.json();
      skipped.push(j.error || `Failed to assign ${chip.dataset.value}`);
    }
  }
  return { created, skipped };
}

async function saveAssignment() {
  const dev    = document.getElementById('am_dev').value;
  if (!dev)    return showToast('Select a developer', 'error');
  const mod    = document.getElementById('am_module').value;
  if (!mod)    return showToast('Select a module', 'error');
  const status = document.getElementById('am_status').value;
  const note   = document.getElementById('am_note').value.trim();

  const task   = document.getElementById('am_task').value.trim()   || null;
  const sprint = document.getElementById('am_sprint').value.trim() || null;
  const type   = document.getElementById('am_type').value          || 'Development';
  const prNumbers    = amPrTA.getSelected();
  const mostRecentPR = prNumbers.length ? prNumbers[prNumbers.length - 1] : null;

  if (stCtx) {
    // Edit mode: multi-select — update existing assignment for first page, create new for any extras.
    // PR links for the assignment being edited already saved live via the chips widget's add/remove.
    const selectedChips = [...document.querySelectorAll('#am_pages .page-chip.selected')];
    if (!selectedChips.length) return showToast('Select at least one page', 'error');
    const [firstChip, ...extraChips] = selectedChips;
    const oldStatus = stCtx.Status;

    // Update the existing assignment record
    const res = await authFetch(`${API}/status/${stCtx.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Developer: dev, Module: mod, Page: firstChip.dataset.value, Status: status, Type: type, Task: task, Sprint: sprint }),
    });
    if (!res.ok) { const j = await res.json(); return showToast(j.error, 'error'); }
    if (oldStatus !== status) {
      await authFetch(`${API}/status/${stCtx.id}/activity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: `Status changed from "${oldStatus}" to "${status}"`, type: 'status_change' }),
      });
    }
    if (note) {
      await authFetch(`${API}/status/${stCtx.id}/activity`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note, type: 'update' }),
      });
    }
    if (mostRecentPR && (task || sprint)) {
      const prUpdates = {};
      if (task)   prUpdates.Task       = task;
      if (sprint) prUpdates.Dev_Sprint = sprint;
      await authFetch(`${API}/prs/by-pr/${mostRecentPR}`, {
        method: 'PUT', body: JSON.stringify(prUpdates),
      });
    }
    // Create new assignments for any additional pages selected — inherit the same PR chips
    const { created, skipped } = await createAssignments(extraChips, dev, mod, status, type, prNumbers, task, sprint, note);
    if (skipped.length) {
      showToast(skipped.join('; '), 'error');
    } else {
      const total = selectedChips.length;
      showToast(total === 1 ? 'Assignment updated' : `Assignment updated + ${created} new page${created !== 1 ? 's' : ''} assigned`, 'success');
    }
  } else {
    // Create mode: multi-select — one assignment per page, all sharing the staged PR chips
    const selectedChips = [...document.querySelectorAll('#am_pages .page-chip.selected')];
    if (!selectedChips.length) return showToast('Select at least one page', 'error');
    const { created, skipped } = await createAssignments(selectedChips, dev, mod, status, type, prNumbers, task, sprint, note);
    if (!created) { return showToast(skipped.join('; ') || 'Nothing was assigned', 'error'); }
    if (mostRecentPR && (task || sprint)) {
      const prUpdates = {};
      if (task)   prUpdates.Task       = task;
      if (sprint) prUpdates.Dev_Sprint = sprint;
      await authFetch(`${API}/prs/by-pr/${mostRecentPR}`, {
        method: 'PUT', body: JSON.stringify(prUpdates),
      });
    }
    showToast(skipped.length ? skipped.join('; ') : (created === 1 ? 'Page assigned' : `${created} pages assigned`), skipped.length ? 'error' : 'success');
  }
  closeModal('assignmentModal');
  renderStatusTracker();
}

async function deleteAssignment(id) {
  if (!confirm('Delete this assignment?')) return;
  const res = await authFetch(`${API}/status/${id}`, { method: 'DELETE' });
  if (!res.ok) { const j = await res.json(); return showToast(j.error, 'error'); }
  showToast('Assignment removed', 'success');
  renderStatusTracker();
}

async function importFromTracker() {
  const btn = document.getElementById('btnImportTracker');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Importing…'; }
  try {
    const res = await authFetch(`${API}/import/tracker`, { method: 'POST' });
    const j   = await res.json();
    if (!res.ok) {
      showToast(j.error || 'Import failed', 'error');
    } else {
      showToast(
        `Import done — created: ${j.created}, updated: ${j.updated}, PRs updated: ${j.prUpdated}, skipped: ${j.skipped}`,
        'success'
      );
      renderStatusTracker();
    }
  } catch (e) {
    showToast('Import error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬆ Import from Tracker JSON'; }
  }
}

async function syncSprintDates() {
  const btn = document.getElementById('btnSyncSprints');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Syncing…'; }
  try {
    const res = await authFetch(`${API}/import/sprints`, { method: 'POST' });
    const j   = await res.json();
    if (!res.ok) {
      showToast(j.error || 'Sprint sync failed', 'error');
    } else {
      showToast(
        `Sprint sync done — sprints seeded: ${j.sprintsSeeded}, PRs updated: ${j.prsUpdated}, status assignments updated: ${j.assignmentsUpdated}, skipped: ${j.skipped}`,
        'success'
      );
      renderStatusTracker();
    }
  } catch (e) {
    showToast('Sprint sync error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📅 Sync Sprint Dates'; }
  }
}

// ── Activity modal ──────────────────────────────────────
async function openActivityModal(id) {
  const a = stAssignments.find(x => x.id === id);
  if (!a) return;
  stCtx = a;
  const pageName = a.Page || '—';
  document.getElementById('actTitle').textContent     = `${a.Developer} — ${pageName}`;
  document.getElementById('actAssignInfo').textContent = `${a.Module || '—'} / ${a.Page || '—'} · Week of ${weekLabel(currentWeek)}`;
  document.getElementById('actStatus').value          = a.Status || 'Pending';
  document.getElementById('actNote').value            = '';
  document.getElementById('actQuickPRForm').style.display = 'none';
  document.getElementById('actToggleQPR').textContent = '＋ New PR';
  document.getElementById('qpr_number').value         = '';
  renderActivityLog(a.ActivityLog || []);
  loadActivityPRSection(a);
  document.getElementById('activityModal').classList.add('open');
}

function renderActivityLog(log) {
  const div = document.getElementById('actLog');
  if (!log.length) {
    div.innerHTML = '<p style="color:var(--text2);font-size:12px;padding:14px">No activity yet.</p>';
    return;
  }
  div.innerHTML = [...log].reverse().map(entry => {
    const dotClass = entry.type || 'update';
    return `<div class="act-entry">
      <div class="act-dot ${dotClass}"></div>
      <div class="act-body">
        <div class="act-time">${formatTimestamp(entry.timestamp)}</div>
        <div class="act-note">${escHtml(entry.note)}</div>
      </div>
    </div>`;
  }).join('');
}

function formatTimestamp(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function loadActivityPRSection(a) {
  actPrTA.init({ mode: 'live', assignmentId: a.id, prs: a.PRs || [] });
}

async function addActivityNote() {
  const note = document.getElementById('actNote').value.trim();
  if (!note) return showToast('Enter a note first', 'error');

  const newStatus = document.getElementById('actStatus').value;
  const oldStatus = stCtx.Status;

  await authFetch(`${API}/status/${stCtx.id}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note, type: 'update' }),
  });

  if (newStatus !== oldStatus) {
    await authFetch(`${API}/status/${stCtx.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Status: newStatus }),
    });
    await authFetch(`${API}/status/${stCtx.id}/activity`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: `Status changed from "${oldStatus}" to "${newStatus}"`, type: 'status_change' }),
    });
    stCtx = { ...stCtx, Status: newStatus };
  }

  await refreshActivityModal();
  document.getElementById('actNote').value = '';
  showToast('Activity added', 'success');
  renderStatusTracker();
}

async function updateStatusFromModal() {
  const newStatus = document.getElementById('actStatus').value;
  const oldStatus = stCtx.Status;
  if (newStatus === oldStatus) return showToast('Status unchanged', '');
  await authFetch(`${API}/status/${stCtx.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Status: newStatus }),
  });
  await authFetch(`${API}/status/${stCtx.id}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: `Status changed from "${oldStatus}" to "${newStatus}"`, type: 'status_change' }),
  });
  stCtx = { ...stCtx, Status: newStatus };
  showToast('Status updated', 'success');
  await refreshActivityModal();
  renderStatusTracker();
}

async function refreshActivityModal() {
  await refreshAssignments();
  const fresh = stAssignments.find(x => x.id === stCtx.id);
  if (!fresh) return;
  stCtx = fresh;
  document.getElementById('actStatus').value = fresh.Status;
  renderActivityLog(fresh.ActivityLog || []);
  loadActivityPRSection(fresh);
}

// ── Shared PR-linking helpers ─────────────────────────────
// Both chip widgets below call these same two functions to add/remove a PR
// link — one HTTP call path for the Assign/Edit modal and the Activity modal.
async function apiLinkPR(assignmentId, prNum) {
  const res = await authFetch(`${API}/status/${assignmentId}/prs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pr_number: prNum }),
  });
  if (!res.ok) { const j = await res.json(); showToast(j.error || 'Failed to link PR', 'error'); return false; }
  showToast(`PR #${prNum} linked`, 'success');
  return true;
}

async function apiUnlinkPR(assignmentId, prNum) {
  const res = await authFetch(`${API}/status/${assignmentId}/prs/${prNum}`, { method: 'DELETE' });
  if (!res.ok) { const j = await res.json(); showToast(j.error || 'Failed to unlink PR', 'error'); return false; }
  showToast(`PR #${prNum} unlinked`, 'success');
  return true;
}

async function refreshAssignments() {
  stAssignments = (await api('status')) || [];
}

function prLabel(p) {
  return `#${p.PR}${p.Module ? ' — ' + p.Module : ''}${p.Developer ? ' (' + p.Developer + ')' : ''}`;
}

// Single shared multi-PR chips widget, used identically by the Assign/Edit
// modal's "Linked PR" field and the Activity modal's "PR Association" field —
// one implementation so both stay in sync and a filtering/linking fix only
// has to be made once.
//
// Two modes:
//  - 'staged': no assignment exists yet (Create-mode) — chips are tracked
//    only in memory; the caller reads them back via getSelected() to send
//    as the initial PRs array when creating the assignment.
//  - 'live': the assignment already exists — every add/remove immediately
//    calls the shared apiLinkPR/apiUnlinkPR routes via cfg.onAdd/cfg.onRemove
//    (assignmentId, prNum) => bool, which also does whatever refresh that
//    modal needs. The widget's own chip list is only ever repopulated by a
//    later init() call (driven by that refresh), never by local bookkeeping,
//    so it can't drift from the server.
function createPrChips(cfg) {
  let items        = []; // [{PR, Module, Developer, Status, id?}, ...] in position order
  let mode         = 'staged';
  let assignmentId = null;
  let activeIndex  = -1;

  const el = (id) => document.getElementById(id);
  const selectedPRs = () => items.map(i => i.PR);

  function candidates() {
    const { developer, module } = cfg.getFilters() || {};
    const exclude = cfg.getExcludePR ? cfg.getExcludePR() : null;
    const already = new Set(selectedPRs());
    return allPRs
      .filter(p => p.PR !== exclude)
      .filter(p => !already.has(p.PR))
      .filter(p => !developer || p.Developer === developer)
      .filter(p => !module    || p.Module    === module)
      .sort((a, b) => b.PR - a.PR);
  }

  function search(qRaw) {
    const q    = (qRaw || '').trim().toLowerCase();
    const base = candidates();
    if (!q) return base.slice(0, 40);
    return base
      .filter(p =>
        String(p.PR).includes(q) ||
        (p.Module    && p.Module.toLowerCase().includes(q)) ||
        (p.Developer && p.Developer.toLowerCase().includes(q))
      )
      .slice(0, 40);
  }

  function renderChips() {
    const box = el(cfg.chipsId);
    box.innerHTML = items.length
      ? items.map(p => `<span class="pr-pill">
          <span${p.id ? ` onclick="openEditPRModal('${p.id}')"` : ''}>#${p.PR}</span>
          <span class="pr-pill-x" onmousedown="event.preventDefault();${cfg.name}.remove(${p.PR})" title="Unlink">✕</span>
        </span>`).join('')
      : '<span class="st-dash" style="font-size:12px">No PR linked</span>';
  }

  function renderList(list) {
    const l = el(cfg.listId);
    l.innerHTML = list.length
      ? list.map(p => `<div class="ta-item" data-pr="${p.PR}" onmousedown="event.preventDefault();${cfg.name}.add(${p.PR})">
          <span>${escHtml(prLabel(p))}</span>
          ${p.Status ? `<span class="ta-item-status">${escHtml(p.Status)}</span>` : ''}
        </div>`).join('')
      : `<div class="ta-empty">No matching PRs</div>`;
    l.style.display = 'block';
  }

  function hideList() {
    const l = el(cfg.listId);
    if (l) l.style.display = 'none';
  }

  function highlight(nodes) {
    nodes.forEach((n, i) => n.classList.toggle('active', i === activeIndex));
    if (nodes[activeIndex]) nodes[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  const widget = {
    init(opts = {}) {
      mode         = opts.mode || 'staged';
      assignmentId = opts.assignmentId || null;
      items        = (opts.prs || []).map(num => allPRs.find(p => p.PR === Number(num)) || { PR: Number(num) });
      el(cfg.inputId).value = '';
      hideList();
      renderChips();
    },
    getSelected() { return selectedPRs(); },
    async add(prNum) {
      if (selectedPRs().includes(prNum)) { el(cfg.inputId).value = ''; hideList(); return; }
      el(cfg.inputId).value = '';
      hideList();
      if (mode === 'live') {
        if (cfg.onAdd) await cfg.onAdd(assignmentId, prNum);
        return;
      }
      const rec = allPRs.find(p => p.PR === prNum);
      items.push(rec || { PR: prNum });
      renderChips();
    },
    async remove(prNum) {
      if (mode === 'live') {
        if (cfg.onRemove) await cfg.onRemove(assignmentId, prNum);
        return;
      }
      items = items.filter(p => p.PR !== prNum);
      renderChips();
    },
    onInput() { activeIndex = -1; renderList(search(el(cfg.inputId).value)); },
    onFocus()  { activeIndex = -1; renderList(search(el(cfg.inputId).value)); },
    hideList,
    onKeyDown(e) {
      const l = el(cfg.listId);
      if (!l || l.style.display === 'none') return;
      const nodes = [...l.querySelectorAll('.ta-item[data-pr]')];
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!nodes.length) return;
        activeIndex = Math.min(activeIndex + 1, nodes.length - 1);
        highlight(nodes);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!nodes.length) return;
        activeIndex = Math.max(activeIndex - 1, 0);
        highlight(nodes);
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && nodes[activeIndex]) {
          e.preventDefault();
          widget.add(Number(nodes[activeIndex].dataset.pr));
        }
      } else if (e.key === 'Escape') {
        hideList();
      }
    },
    // Developer/module filter changed — just re-hide the list; already-added
    // chips are never retroactively removed by a filter change.
    refreshIfOpen() { hideList(); },
  };
  return widget;
}

// Assign/Edit Assignment modal — "Linked PR" chips, scoped to the developer + module selected in the form
const amPrTA = createPrChips({
  name: 'amPrTA',
  inputId: 'am_pr_input', listId: 'am_pr_list', chipsId: 'am_pr_chips',
  getFilters: () => ({
    developer: document.getElementById('am_dev')?.value || '',
    module:    document.getElementById('am_module')?.value || '',
  }),
  onAdd: async (assignmentId, prNum) => {
    const ok = await apiLinkPR(assignmentId, prNum);
    if (ok) await amPrTA_refreshLive(assignmentId);
    return ok;
  },
  onRemove: async (assignmentId, prNum) => {
    const ok = await apiUnlinkPR(assignmentId, prNum);
    if (ok) await amPrTA_refreshLive(assignmentId);
    return ok;
  },
});

async function amPrTA_refreshLive(assignmentId) {
  await refreshAssignments();
  const fresh = stAssignments.find(x => x.id === assignmentId);
  if (fresh) amPrTA.init({ mode: 'live', assignmentId, prs: fresh.PRs });
  renderStatusTracker();
}

// Activity modal — "PR Association" chips, scoped to the assignment's own developer + module
const actPrTA = createPrChips({
  name: 'actPrTA',
  inputId: 'act_pr_input', listId: 'act_pr_list', chipsId: 'act_pr_chips',
  getFilters: () => (stCtx ? { developer: stCtx.Developer, module: stCtx.Module } : {}),
  onAdd: async (assignmentId, prNum) => {
    const ok = await apiLinkPR(assignmentId, prNum);
    if (ok) { await refreshActivityModal(); renderStatusTracker(); }
    return ok;
  },
  onRemove: async (assignmentId, prNum) => {
    const ok = await apiUnlinkPR(assignmentId, prNum);
    if (ok) { await refreshActivityModal(); renderStatusTracker(); }
    return ok;
  },
});

function toggleAmQuickPRForm() {
  const form = document.getElementById('amQuickPRForm');
  const btn  = document.getElementById('amToggleQPR');
  if (!form || !btn) return;
  const show = form.style.display === 'none';
  form.style.display = show ? 'block' : 'none';
  btn.textContent    = show ? '✕ Cancel' : '＋ New PR';
  if (show) { const n = document.getElementById('am_qpr_number'); if (n) n.focus(); }
}

async function amQPRDateChanged() {
  await loadSprints();
  const sprint = sprintForDate(document.getElementById('am_qpr_raised').value);
  if (!sprint) return;
  document.getElementById('am_qpr_sprint').value = sprint;
  const mainSprint = document.getElementById('am_sprint');
  if (mainSprint && !mainSprint.value) mainSprint.value = sprint;
}

async function actQPRDateChanged() {
  await loadSprints();
  const sprint = sprintForDate(document.getElementById('qpr_raised').value);
  if (sprint) document.getElementById('qpr_devSprint').value = sprint;
}

async function saveAmQuickPR() {
  const prNum = Number(document.getElementById('am_qpr_number').value);
  if (!prNum) return showToast('PR number is required', 'error');
  const status     = document.getElementById('am_qpr_status').value;
  const raisedDate = document.getElementById('am_qpr_raised').value || null;
  const devSprint  = document.getElementById('am_qpr_sprint').value.trim() || null;
  const dev    = document.getElementById('am_dev').value || null;
  const mod    = document.getElementById('am_module').value || null;
  const pages  = [...document.querySelectorAll('#am_pages .page-chip.selected')].map(c => c.dataset.value);

  const prBody = { PR: prNum, Type: 'Development', Developer: dev, Module: mod, Page: pages, Status: status };
  if (raisedDate) prBody['PR Raised Date'] = raisedDate;
  if (devSprint)  prBody.Dev_Sprint        = devSprint;

  const prRes = await authFetch(`${API}/prs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prBody),
  });
  const prJson = await prRes.json();
  if (!prRes.ok) return showToast(prJson.error || 'Failed to create PR', 'error');

  const created = prJson.data || { PR: prNum, Status: status };
  allPRs = [created, ...allPRs.filter(p => p.PR !== prNum)];
  await amPrTA.add(prNum);

  // Propagate sprint to the assignment form fields
  if (devSprint) {
    const mainSprint = document.getElementById('am_sprint');
    if (mainSprint && !mainSprint.value) mainSprint.value = devSprint;
  }

  document.getElementById('amQuickPRForm').style.display = 'none';
  document.getElementById('amToggleQPR').textContent = '＋ New PR';
  document.getElementById('am_qpr_number').value = '';
  document.getElementById('am_qpr_raised').value = '';
  document.getElementById('am_qpr_sprint').value = '';
  showToast(`PR #${prNum} created`, 'success');
}

// ── Quick PR creation (activity modal) ───────────────────
function toggleQuickPRForm() {
  const form  = document.getElementById('actQuickPRForm');
  const btn   = document.getElementById('actToggleQPR');
  const show  = form.style.display === 'none';
  form.style.display   = show ? 'block' : 'none';
  btn.textContent      = show ? '✕ Cancel' : '＋ New PR';
  if (show) document.getElementById('qpr_number').focus();
}

async function saveQuickPR() {
  const prNum = Number(document.getElementById('qpr_number').value);
  if (!prNum) return showToast('PR number is required', 'error');
  const status     = document.getElementById('qpr_status').value;
  const raisedDate = document.getElementById('qpr_raised').value || null;
  const devSprint  = document.getElementById('qpr_devSprint').value.trim() || null;
  const { Developer: dev, Module: mod, Page: page } = stCtx;

  // Create the PR with minimal details
  const prBody = {
    PR:        prNum,
    Type:      'Development',
    Developer: dev   || null,
    Module:    mod   || null,
    Page:      page  ? [page] : [],
    Status:    status,
  };
  if (raisedDate) prBody['PR Raised Date'] = raisedDate;
  if (devSprint)  prBody.Dev_Sprint        = devSprint;
  const prRes = await authFetch(`${API}/prs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prBody),
  });
  const prJson = await prRes.json();
  if (!prRes.ok) return showToast(prJson.error || 'Failed to create PR', 'error');

  // Refresh the global PR list so the chips widget can find the new record,
  // then link it through the exact same route the search-and-pick flow uses.
  const fresh = await api('prs');
  allPRs = (fresh && fresh.data) || [];
  await actPrTA.add(prNum);

  // Hide quick form, refresh
  document.getElementById('actQuickPRForm').style.display = 'none';
  document.getElementById('actToggleQPR').textContent     = '＋ New PR';
  document.getElementById('qpr_number').value             = '';
  document.getElementById('qpr_raised').value             = '';
  document.getElementById('qpr_devSprint').value          = '';
}
