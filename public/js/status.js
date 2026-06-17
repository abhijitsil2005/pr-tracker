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

  const filterDev = document.getElementById('stFilterDev').value;
  let list = stAssignments;
  if (filterDev) list = list.filter(a => a.Developer === filterDev);

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
}

function buildDevCard(dev, items) {
  const done    = items.filter(i => i.Status === 'Done').length;
  const blocked = items.filter(i => i.Status === 'Blocked').length;
  const total   = items.length;

  const rows = items.map(a => {
    const logs    = a.ActivityLog || [];
    const lastLog = logs[logs.length - 1];
    const lastNote = lastLog
      ? `<span style="color:var(--text2);font-size:11px" title="${escHtml(lastLog.note)}">${timeAgo(lastLog.timestamp)} — ${escHtml(lastLog.note.slice(0, 55))}${lastLog.note.length > 55 ? '…' : ''}</span>`
      : '<span style="color:var(--text2);font-size:11px">No activity yet</span>';
    const prBadge = a.PR
      ? `<span class="pr-pill" onclick="openEditPRModal(${a.PR})">#${a.PR}</span>`
      : '<span style="color:var(--text2);font-size:11px">—</span>';
    const pageName = (a.Page || '').split('/').pop() || a.Page || '—';
    const weekDisplay = a.Week
      ? `<div style="font-size:10px;color:var(--text2);margin-top:2px">wk ${a.Week}</div>`
      : '';
    return `<tr>
      <td style="font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis" title="${escHtml(a.Module||'')} / ${escHtml(a.Page||'')}">
        ${escHtml(a.Module||'—')} / ${escHtml(pageName)}${weekDisplay}
      </td>
      <td>${stStatusBadge(a.Status)}</td>
      <td>${prBadge}</td>
      <td style="max-width:260px">${lastNote}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-primary btn-xs" onclick="openActivityModal('${a.id}')" title="View activity &amp; updates">📝 ${logs.length}</button>
        ${canWrite() ? `<button class="btn btn-ghost btn-xs" onclick="openEditAssignmentModal('${a.id}')" title="Edit assignment">✏️</button>
        <button class="btn btn-danger btn-xs" onclick="deleteAssignment('${a.id}')" title="Remove">🗑</button>` : ''}
      </td>
    </tr>`;
  }).join('');

  return `<div class="st-dev-card">
    <div class="st-dev-header">
      <div class="st-dev-left">
        <span class="st-dev-name">👤 ${escHtml(dev)}</span>
        <span class="badge badge-blue">${total} page${total !== 1 ? 's' : ''}</span>
        ${done    ? `<span class="badge badge-green">${done} done</span>` : ''}
        ${blocked ? `<span class="badge badge-red">${blocked} blocked</span>` : ''}
      </div>
      ${canWrite() ? `<button class="btn btn-ghost btn-sm" onclick="openAssignmentModalForDev('${escAttr(dev)}')">＋ Add Page</button>` : ''}
    </div>
    <div class="table-wrap" style="border-radius:0;border-left:none;border-right:none;border-bottom:none">
      <table style="font-size:12px">
        <colgroup>
          <col style="width:22%"><col style="width:12%"><col style="width:9%">
          <col style="width:43%"><col style="width:14%">
        </colgroup>
        <thead><tr>
          <th>Module / Page</th><th>Status</th><th>PR</th>
          <th>Last Activity</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
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
  // PR section
  populateAmPRSelect();
  const qf1 = document.getElementById('amQuickPRForm'); if (qf1) qf1.style.display = 'none';
  const tb1 = document.getElementById('amToggleQPR');   if (tb1) tb1.textContent = '＋ New PR';
  const qn1 = document.getElementById('am_qpr_number'); if (qn1) qn1.value = '';
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
  document.getElementById('am_note').value           = '';
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
  // PR section
  populateAmPRSelect(assignments.PR);
  const qf2 = document.getElementById('amQuickPRForm'); if (qf2) qf2.style.display = 'none';
  const tb2 = document.getElementById('amToggleQPR');   if (tb2) tb2.textContent = '＋ New PR';
  const qn2 = document.getElementById('am_qpr_number'); if (qn2) qn2.value = '';
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
    chip.onclick       = () => {
      if (stCtx) {
        // edit mode: single-select
        container.querySelectorAll('.page-chip').forEach(c => c.classList.remove('selected'));
        chip.classList.add('selected');
      } else {
        // create mode: multi-select toggle
        chip.classList.toggle('selected');
      }
    };
    container.appendChild(chip);
  });
}

async function saveAssignment() {
  const dev    = document.getElementById('am_dev').value;
  if (!dev)    return showToast('Select a developer', 'error');
  const mod    = document.getElementById('am_module').value;
  if (!mod)    return showToast('Select a module', 'error');
  const status = document.getElementById('am_status').value;
  const note   = document.getElementById('am_note').value.trim();

  const prEl = document.getElementById('am_pr');
  const linkedPR = prEl ? (Number(prEl.value) || null) : null;

  if (stCtx) {
    // Edit mode: single-select
    const chip = document.querySelector('#am_pages .page-chip.selected');
    if (!chip) return showToast('Select a page', 'error');
    const page = chip.dataset.value;
    const oldStatus = stCtx.Status;
    const res = await authFetch(`${API}/status/${stCtx.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Developer: dev, Module: mod, Page: page, Status: status, PR: linkedPR }),
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
    showToast('Assignment updated', 'success');
  } else {
    // Create mode: multi-select — one assignment per page
    const selectedChips = [...document.querySelectorAll('#am_pages .page-chip.selected')];
    if (!selectedChips.length) return showToast('Select at least one page', 'error');
    for (const chip of selectedChips) {
      const body = { Developer: dev, Module: mod, Page: chip.dataset.value, Week: weekKey(currentWeek), Status: status, PR: linkedPR };
      if (note) body.note = note;
      const res = await authFetch(`${API}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const j = await res.json(); return showToast(j.error, 'error'); }
    }
    showToast(selectedChips.length === 1 ? 'Page assigned' : `${selectedChips.length} pages assigned`, 'success');
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

// ── Activity modal ──────────────────────────────────────
async function openActivityModal(id) {
  const a = stAssignments.find(x => x.id === id);
  if (!a) return;
  stCtx = a;
  const pageName = (a.Page || '').split('/').pop() || a.Page || '—';
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
  const prSel = document.getElementById('actPRSelect');
  prSel.innerHTML = '<option value="">— link existing PR —</option>';
  const unlinked = allPRs.filter(p => p.PR !== a.PR).sort((x, y) => y.PR - x.PR);
  unlinked.forEach(p => prSel.add(new Option(
    `#${p.PR} — ${p.Module || '?'} — ${p.Developer || '?'} (${p.Status || '?'})`, p.PR
  )));
  document.getElementById('actLinkedPR').innerHTML = a.PR
    ? `<span class="pr-pill" onclick="closeModal('activityModal');openEditPRModal(${a.PR})">#${a.PR}</span>
       <button class="btn btn-danger btn-xs" onclick="unlinkPRFromAssignment()">Unlink</button>`
    : '<span style="color:var(--text2);font-size:12px">No PR linked</span>';
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

async function linkPRFromActivity() {
  const prNum = Number(document.getElementById('actPRSelect').value);
  if (!prNum) return showToast('Select a PR first', 'error');
  const res = await authFetch(`${API}/status/${stCtx.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ PR: prNum }),
  });
  if (!res.ok) { const j = await res.json(); return showToast(j.error, 'error'); }
  await authFetch(`${API}/status/${stCtx.id}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: `PR #${prNum} linked`, type: 'pr_linked' }),
  });
  stCtx = { ...stCtx, PR: prNum };
  showToast(`PR #${prNum} linked`, 'success');
  await refreshActivityModal();
  renderStatusTracker();
}

async function unlinkPRFromAssignment() {
  const prNum = stCtx.PR;
  if (!prNum) return;
  if (!confirm(`Unlink PR #${prNum} from this assignment?`)) return;
  await authFetch(`${API}/status/${stCtx.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ PR: null }),
  });
  await authFetch(`${API}/status/${stCtx.id}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: `PR #${prNum} unlinked`, type: 'pr_unlinked' }),
  });
  stCtx = { ...stCtx, PR: null };
  showToast(`PR #${prNum} unlinked`, 'success');
  await refreshActivityModal();
  renderStatusTracker();
}

async function refreshActivityModal() {
  const updated = await api('status');
  stAssignments  = updated || [];
  const fresh    = stAssignments.find(x => x.id === stCtx.id);
  if (!fresh) return;
  stCtx = fresh;
  document.getElementById('actStatus').value = fresh.Status;
  renderActivityLog(fresh.ActivityLog || []);
  loadActivityPRSection(fresh);
}

// ── Assign-modal PR helpers ──────────────────────────────
function populateAmPRSelect(selectedPR) {
  const sel = document.getElementById('am_pr');
  if (!sel) return;
  sel.innerHTML = '<option value="">— no PR —</option>';
  const active = allPRs
    .filter(p => {
      const s = (p.Status || '').toLowerCase();
      // Always include the currently linked PR even if its status is outside the filter
      if (selectedPR && p.PR === selectedPR) return true;
      return s === 'development inprogress' || s === 'dev pr in review';
    })
    .sort((a, b) => b.PR - a.PR);
  active.forEach(p => sel.add(new Option(
    `#${p.PR}${p.Module ? ' — ' + p.Module : ''}${p.Developer ? ' (' + p.Developer + ')' : ''}`,
    p.PR
  )));
  if (selectedPR) sel.value = selectedPR;
}

function toggleAmQuickPRForm() {
  const form = document.getElementById('amQuickPRForm');
  const btn  = document.getElementById('amToggleQPR');
  if (!form || !btn) return;
  const show = form.style.display === 'none';
  form.style.display = show ? 'block' : 'none';
  btn.textContent    = show ? '✕ Cancel' : '＋ New PR';
  if (show) { const n = document.getElementById('am_qpr_number'); if (n) n.focus(); }
}

async function saveAmQuickPR() {
  const prNum = Number(document.getElementById('am_qpr_number').value);
  if (!prNum) return showToast('PR number is required', 'error');
  const status = document.getElementById('am_qpr_status').value;
  const dev    = document.getElementById('am_dev').value || null;
  const mod    = document.getElementById('am_module').value || null;
  const pages  = [...document.querySelectorAll('#am_pages .page-chip.selected')].map(c => c.dataset.value);

  const prRes = await authFetch(`${API}/prs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ PR: prNum, Type: 'Development', Developer: dev, Module: mod, Page: pages, Status: status }),
  });
  const prJson = await prRes.json();
  if (!prRes.ok) return showToast(prJson.error || 'Failed to create PR', 'error');

  const created = prJson.data || { PR: prNum, Status: status };
  allPRs = [created, ...allPRs.filter(p => p.PR !== prNum)];
  populateAmPRSelect(prNum);
  // If status doesn't match the filter, ensure the option is still present and selected
  const sel = document.getElementById('am_pr');
  if (Number(sel.value) !== prNum) {
    sel.add(new Option(`#${prNum} (${status})`, prNum));
    sel.value = prNum;
  }

  document.getElementById('amQuickPRForm').style.display = 'none';
  document.getElementById('amToggleQPR').textContent = '＋ New PR';
  document.getElementById('am_qpr_number').value = '';
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
  const status = document.getElementById('qpr_status').value;
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
  const prRes = await authFetch(`${API}/prs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prBody),
  });
  const prJson = await prRes.json();
  if (!prRes.ok) return showToast(prJson.error || 'Failed to create PR', 'error');

  // Link the new PR to this assignment
  await authFetch(`${API}/status/${stCtx.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ PR: prNum }),
  });
  await authFetch(`${API}/status/${stCtx.id}/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: `PR #${prNum} created and linked`, type: 'pr_linked' }),
  });

  stCtx = { ...stCtx, PR: prNum };
  showToast(`PR #${prNum} created and linked`, 'success');

  // Hide quick form, refresh
  document.getElementById('actQuickPRForm').style.display = 'none';
  document.getElementById('actToggleQPR').textContent     = '＋ New PR';
  document.getElementById('qpr_number').value             = '';

  // Refresh PRs global list + modal
  const fresh = await api('prs');
  allPRs = (fresh && fresh.data) || [];
  await refreshActivityModal();
  renderStatusTracker();
}
