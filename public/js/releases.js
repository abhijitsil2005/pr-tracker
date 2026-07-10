// ═══════════════════════════════════════════════════════
// RELEASES
// ═══════════════════════════════════════════════════════

// Parse YYYY-MM-DD or mm/dd/yyyy → Date (local midnight)
function parseRelDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const [m, d, y] = str.split('/').map(Number);
  return new Date(y, m - 1, d);
}

// Classify a release relative to today
function classifyRelease(rel) {
  const today = new Date(); today.setHours(0,0,0,0);
  const rd = parseRelDate(rel.Release_Date);
  if (!rd) return 'future';
  if (rd < today) return 'past';
  if (rd.getTime() === today.getTime()) return 'current';
  return 'future';
}

async function renderReleases() {
  const [relData, prData, mpData] = await Promise.all([
    api('releases'), api('prs'), api('modules')
  ]);
  allReleases = (relData && relData.data) || [];
  allPRs      = (prData  && prData.data)  || [];
  allModulePages = mpData || [];

  const search    = (document.getElementById('relSearch').value || '').toLowerCase();
  const container = document.getElementById('releaseContainer');

  if (!allReleases.length) {
    container.innerHTML = `<div class="empty"><div class="e-icon">📭</div><p>No releases yet. Run a sync first.</p></div>`;
    return;
  }

  // Sort all releases chronologically
  const sorted = [...allReleases].sort((a,b) => {
    const da = parseRelDate(a.Release_Date), db = parseRelDate(b.Release_Date);
    return (da||0) - (db||0);
  });

  const today = new Date(); today.setHours(0,0,0,0);

  // Find "current" = closest upcoming release (next release date >= today)
  let currentIdx = sorted.findIndex(r => {
    const d = parseRelDate(r.Release_Date);
    return d && d >= today;
  });
  if (currentIdx === -1) currentIdx = sorted.length - 1; // all past → last is "current"

  const past     = sorted.slice(0, currentIdx);     // oldest → newest
  const current  = sorted[currentIdx] || null;
  const nextUp   = sorted[currentIdx + 1] || null;
  const future   = sorted.slice(currentIdx + 2);    // beyond next release

  let html = '';

  // Chronological: past group (collapsed) → current (open) → next (collapsed) → upcoming group (collapsed)
  if (past.length) {
    html += buildGroupAccordion('past-releases', '🕘 Past Releases', past, 'past', search);
  }
  if (current) {
    html += buildReleaseBlock(current, search, 'current');
  }
  if (nextUp) {
    html += `<div class="rel-section-label">🟢 Next Release</div>`;
    html += buildReleaseBlock(nextUp, search, 'next-up');
  }
  if (future.length) {
    html += buildGroupAccordion('upcoming-releases', '📅 Upcoming Releases', future, '', search);
  }

  container.innerHTML = html || `<div class="empty"><div class="e-icon">🔍</div><p>No releases match your search.</p></div>`;
}

document.getElementById('relSearch').addEventListener('input', renderReleases);

// ── Group accordion (Past / Upcoming) ─────────────────
function buildGroupAccordion(groupId, label, items, cssClass, search) {
  const blocks = items
    .map(r => buildReleaseBlock(r, search, cssClass))
    .filter(Boolean)
    .join('');
  if (!blocks) return '';
  const count = items.length;
  return `
  <div class="rel-group">
    <div class="rel-group-header" onclick="toggleGroup('${groupId}')">
      <span class="chevron" id="chev-${groupId}">▼</span>
      <span class="rel-group-title">${label}</span>
      <span class="badge badge-gray">${count} release${count !== 1 ? 's' : ''}</span>
    </div>
    <div class="rel-group-body" id="body-${groupId}" style="display:none">
      ${blocks}
    </div>
  </div>`;
}

function toggleGroup(groupId) {
  const body = document.getElementById(`body-${groupId}`);
  const chev = document.getElementById(`chev-${groupId}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chev.classList.toggle('open', !isOpen);
}

// ── Build one release block ────────────────────────────
function buildReleaseBlock(rel, search, cssClass) {
  const modules = rel.Modules || [];

  // Search filter
  let filteredMods = modules;
  if (search) {
    filteredMods = modules
      .map(mod => {
        const modMatch = (mod.Module||'').toLowerCase().includes(search) ||
                         String(mod.User_Story||'').includes(search);
        const filtPages = (mod.Pages||[]).filter(p =>
          modMatch ||
          (p.Page_Name||'').toLowerCase().includes(search) ||
          String(p.PR||'').includes(search) ||
          String(p.Task||'').includes(search) ||
          (p.Feature_Flag||'').toLowerCase().includes(search)
        );
        return (modMatch || filtPages.length)
          ? { ...mod, Pages: modMatch ? mod.Pages : filtPages }
          : null;
      })
      .filter(Boolean);
    if (!filteredMods.length) return '';
  }

  // Stats for header badges
  const totalMods  = filteredMods.filter(m =>
    (m.Pages||[]).some(p => p.Page_Name !== 'Infrastructure Pages' || p.Page_Name !== 'Shared Controls')
  ).length;
  const totalPages = filteredMods.reduce((s, m) =>
    s + (m.Pages||[]).filter(p =>
      (p.Page_Name !== 'Infrastructure Pages' || p.Page_Name !== 'Shared Controls') &&
      (p.Feature_Flag_Status||'').toLowerCase() === 'enabled'
    ).length, 0);
  // PR count: use the same scoped cross-reference as buildModGroup so the total matches
  // the sum of per-module counts. Only adds a PR from allPRs if its page already exists
  // in the stored module pages (prevents false positives from unsynced PRs).
  const relDate = (rel.Release_Date || '').trim();
  const pgBase  = s => (s || '').split('/').pop();
  const distinctRelPRs = new Set();
  filteredMods.forEach(mod => {
    const modPages = mod.Pages || [];
    const storedBases = new Set(modPages.map(p => pgBase(p.Page_Name || '')).filter(Boolean));
    modPages.forEach(p => { if (p.PR) distinctRelPRs.add(Number(p.PR)); });
    allPRs.forEach(pr => {
      if (pr.Module !== mod.Module) return;
      if (!pr.Target_Release || pr.Target_Release.trim() !== relDate) return;
      if ((pr.Page || []).some(pg => storedBases.has(pgBase(pg)))) {
        distinctRelPRs.add(Number(pr.PR));
      }
    });
  });
  const allRelPRs = [...distinctRelPRs];

  const modGroupsHtml = filteredMods.sort((a, b) => (a.Module||'').localeCompare(b.Module||'')).map(mod => buildModGroup(mod, rel)).join('');

  const relId = `rel-${rel.Release_Number}`;
  const extraClass = cssClass ? ` ${cssClass}` : '';

  // Build Complete button before the template string to avoid nested backtick issues
  const isFuture = cssClass === 'next-up' || cssClass === '';
  let completeBtn;
  if (rel.Completed) {
    const doneOn = rel.Completed_At
      ? new Date(rel.Completed_At).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    completeBtn = '<button class="btn btn-success btn-sm" disabled style="opacity:.45;cursor:not-allowed" title="Completed' + (doneOn ? ' on ' + doneOn : '') + '">✅ Completed</button>';
  } else if (isFuture) {
    completeBtn = '<button class="btn btn-success btn-sm" disabled style="opacity:.35;cursor:not-allowed" title="Cannot complete a future release">✅ Complete</button>';
  } else {
    completeBtn = '<button class="btn btn-success btn-sm" onclick="completeRelease(\'' + rel.Release_Number + '\')">✅ Complete</button>';
  }

  return `
  <div class="release-block${extraClass}" id="block-${relId}">
    <div class="release-header" onclick="toggleRelease('${relId}')">
      <div class="release-header-left">
        <span class="chevron${cssClass === 'current' ? ' open' : ''}" id="chev-${relId}">▼</span>
        <div>
          <div class="release-title">
            📅 ${rel.Release_Date}
            <span style="color:var(--text2);font-weight:400;font-size:12px;margin-left:6px">Release ${rel.Release_Number||'—'}</span>
            ${rel.Sprint ? `<span style="color:var(--accent2);font-weight:500;font-size:12px;margin-left:8px;background:var(--surface3);padding:2px 8px;border-radius:10px">Sprint ${rel.Sprint}</span>` : ''}
          </div>
          <div class="release-meta">
            ${rel.Code_Freeze     ? '<span>❄️ Code Freeze: ' + rel.Code_Freeze + '</span>'      : ''}
            ${rel.Regression_Start? '<span>🔬 Regression: ' + rel.Regression_Start + '</span>' : ''}
          </div>
        </div>
      </div>
      <div class="release-counts" onclick="event.stopPropagation()">
        <span class="badge badge-blue">${totalMods} module${totalMods!==1?'s':''}</span>
        <span class="badge badge-purple">${totalPages} page${totalPages!==1?'s':''}</span>
        <span class="badge badge-gray">${allRelPRs.length} PR${allRelPRs.length!==1?'s':''}</span>
        ${canWrite() ? completeBtn : ''}
        ${canWrite() ? `<button class="btn btn-ghost btn-sm" onclick="openEditReleaseModal('${rel.Release_Number}')">✏️ Edit</button>` : ''}
        ${canWrite() ? `<button class="btn btn-danger btn-sm" onclick="deleteRelease('${rel.Release_Number}')">🗑</button>` : ''}
      </div>
    </div>
    <div class="release-body" id="body-${relId}"${cssClass !== 'current' ? ' style="display:none"' : ''}>
      ${modGroupsHtml || '<div style="padding:18px;color:var(--text2);font-size:13px">No module data in this release.</div>'}
    </div>
  </div>`;
}

// ── Build one module group table ───────────────────────
function buildModGroup(mod, rel) {
  const pages  = mod.Pages || [];
  const mpMod  = allModulePages.find(m => m.Module === mod.Module);

  // Group pages by PR
  const prGroups = {};
  const noPRPages = [];
  pages.forEach(p => {
    if (p.PR) {
      if (!prGroups[p.PR]) prGroups[p.PR] = [];
      prGroups[p.PR].push(p);
    } else {
      noPRPages.push(p);
    }
  });

  let rows = '';

  // Group page entries by Page_Name so multiple PRs for the same page
  // render as one row with multiple PR chips instead of duplicate rows.
  // Use a Set for prs to avoid duplicates when cross-referencing below.
  const pageMap = new Map();
  pages.forEach(p => {
    const key = p.Page_Name || '';
    if (!pageMap.has(key)) {
      pageMap.set(key, { page: { ...p }, prSet: new Set() });
    }
    if (p.PR) pageMap.get(key).prSet.add(Number(p.PR));
    // Prefer non-empty FF values from any entry for this page
    if (p.Feature_Flag)        pageMap.get(key).page.Feature_Flag        = p.Feature_Flag;
    if (p.Feature_Flag_Status) pageMap.get(key).page.Feature_Flag_Status = p.Feature_Flag_Status;
  });

  // Cross-reference allPRs: if a PR targets this release and this module, add it to
  // every page it covers — even if the stored release data only kept the last-synced PR
  // per page (the old overwrite bug).
  const relDate = (rel.Release_Date || '').trim();
  const pgBase  = s => (s || '').split('/').pop();
  allPRs.forEach(pr => {
    if (pr.Module !== mod.Module) return;
    if (!pr.Target_Release || pr.Target_Release.trim() !== relDate) return;
    (pr.Page || []).forEach(pg => {
      for (const [key, entry] of pageMap) {
        if (pgBase(pg) === pgBase(key) || pg === key) {
          entry.prSet.add(Number(pr.PR));
        }
      }
    });
  });

  // Materialise sorted prs arrays
  pageMap.forEach(entry => {
    entry.prs = [...entry.prSet].sort((a, b) => a - b);
  });

  const sortedPageEntries = [...pageMap.entries()].sort(([aKey], [bKey]) => {
    const aInfra = aKey === 'Infrastructure Pages';
    const bInfra = bKey === 'Infrastructure Pages';
    if (aInfra !== bInfra) return aInfra ? 1 : -1;
    return aKey.localeCompare(bKey, undefined, { sensitivity: 'base' });
  });

  sortedPageEntries.forEach(([, { page: p, prs }]) => {
    const ffName = p.Feature_Flag || (mpMod
      ? (() => {
          const mpPage = mpMod.Pages.find(mp =>
            mp.page_name === p.Page_Name ||
            p.Page_Name?.endsWith(mp.page_name) ||
            mp.page_name === (p.Page_Name||'').split('/').pop()
          );
          return mpPage ? mpPage.Feature_Flag : '';
        })()
      : '');

    const ffStatus = p.Feature_Flag_Status || 'N/A';

    const prStatusCombined = prs.length ? prs.map(prNum => {
      const detail = allPRs.find(pr => String(pr.PR) === String(prNum) && pr.Module === mod.Module)
                  || allPRs.find(pr => String(pr.PR) === String(prNum));
      const status = detail && detail.Status ? detail.Status : '';
      const statusText = status ? ` · ${status}` : '';
      const colorClass = prPillClass(status);
      return `<span class="pr-pill ${colorClass}" onclick="showPRDetail(${prNum},'${mod.Module.replace(/'/g,"\\'")}')" style="margin:2px 4px 2px 0">#${prNum}${statusText}</span>`;
    }).join('') : '<span style="color:var(--text2)">—</span>';

    rows += `<tr>
      <td></td>
      <td style="font-family:monospace;font-size:11px" title="${p.Page_Name||''}">${p.Page_Name||'—'}</td>
      <td style="color:var(--accent2)" title="${ffName}">${ffName||'N/A'}</td>
      <td>${ffBadge(ffStatus)}</td>
      <td class="pr-cell">${prStatusCombined}</td>
      <td style="white-space:nowrap">${p.Task ? `<span style="color:var(--text2);font-size:11px">#${p.Task}</span>` : '—'}</td>
    </tr>`;
  });

  const userStoryHtml = mod.User_Story
    ? `<span class="mod-story-label">US#</span><span class="mod-story">${mod.User_Story}</span>`
    : '';

  return `
  <div class="mod-group">
    <div class="mod-header">
      <span style="font-size:15px">📦</span>
      <span class="mod-name">${mod.Module}</span>
      ${userStoryHtml}
      <span class="badge badge-blue" style="margin-left:auto">${pageMap.size} page${pageMap.size!==1?'s':''}</span>
      <span class="badge badge-gray">${new Set([...pageMap.values()].flatMap(e => e.prs)).size} PR${new Set([...pageMap.values()].flatMap(e => e.prs)).size!==1?'s':''}</span>
    </div>
    <table class="pages-table">
      <colgroup>
        <col class="col-margin">
        <col class="col-page"><col class="col-ff"><col class="col-ffs">
        <col class="col-pr"><col class="col-task">
      </colgroup>
      <thead>
        <tr>
          <th></th>
          <th>Page</th><th>Feature Flag</th><th>FF Status</th>
          <th>PR # / Status</th><th>Task #</th>
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:14px">No pages defined</td></tr>'}</tbody>
    </table>
  </div>`;
}


function toggleRelease(id) {
  const body = document.getElementById(`body-${id}`);
  const chev = document.getElementById(`chev-${id}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  chev.classList.toggle('open', !isOpen);
}

// ── PR Detail popup ────────────────────────────────────
function showPRDetail(prNum, module) {
  // Prefer the record that matches both PR number and module; fall back to first match
  const pr = (module ? allPRs.find(p => p.PR === Number(prNum) && p.Module === module) : null)
           || allPRs.find(p => p.PR === Number(prNum));
  if (!pr) return showToast(`PR #${prNum} not found in loaded data`, 'error');
  document.getElementById('prDetailTitle').textContent = `PR #${pr.PR} — ${pr.Module||''}`;
  const rows = [
    ['Developer',      pr.Developer||'—'],
    ['Type',           pr.Type||'—'],
    ['Status',         `<span>${statusBadge(pr.Status)}</span>`],
    ['Dev Sprint',     pr.Dev_Sprint||'—'],
    ['Testing Sprint', pr.Testing_Sprint||'—'],
    ['Merged',         pr['PR Merged Date']||'—'],
    ['Target Release', pr.Target_Release||'—'],
    ['Dependent PRs',  (pr.Dependent_PRs||[]).length ? pr.Dependent_PRs.map(n=>`<span class="pr-pill" style="cursor:default">#${n}</span>`).join(' ') : '—'],
    ['Pages',          (pr.Page||[]).map(p=>`<code style="font-size:11px;background:var(--surface3);padding:2px 6px;border-radius:4px">${p}</code>`).join('<br>')],
  ];

  const statusOptions = lookupPRStatuses.map(s =>
    `<option value="${s.Name}" ${pr.Status === s.Name ? 'selected' : ''}>${s.Name}</option>`
  ).join('');

  const sortedTL = [...lookupTimeline].sort((a, b) => Number(a.Release_Number) - Number(b.Release_Number));
  const currentTarget = pr.Target_Release || '';
  const inTimeline = currentTarget && sortedTL.some(t => t.Release_Date === currentTarget);
  const targetOptions = [
    '<option value="">— no release —</option>',
    (currentTarget && !inTimeline) ? `<option value="${currentTarget}" selected>${currentTarget} (current)</option>` : '',
    ...sortedTL.map(t => {
      const sel = t.Release_Date === currentTarget ? ' selected' : '';
      return `<option value="${t.Release_Date}"${sel}>${t.Release_Date} (R${t.Release_Number})</option>`;
    }),
  ].join('');

  document.getElementById('prDetailBody').innerHTML = `
    <div style="display:grid;grid-template-columns:140px 1fr;gap:10px 16px;font-size:13px;margin-bottom:16px">
      ${rows.map(([k,v])=>`
        <div style="color:var(--text2);font-weight:500;padding-top:2px">${k}</div>
        <div>${v}</div>`).join('')}
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:4px">
      <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:12px">UPDATE PR</div>
      <div style="display:grid;grid-template-columns:110px 1fr;gap:8px 10px;align-items:center;margin-bottom:12px">
        <span style="font-size:12px;color:var(--text2)">Status</span>
        <select id="prDetailStatusSel" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:8px;font-size:13px;outline:none">
          ${statusOptions}
        </select>
        <span style="font-size:12px;color:var(--text2)">Target Release</span>
        <select id="prDetailTargetSel" data-original="${currentTarget}" style="background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:8px;font-size:13px;outline:none">
          ${targetOptions}
        </select>
      </div>
      <button class="btn btn-primary btn-sm" onclick="updatePRStatusFromDetail('${pr.id}',${pr.PR})">Update</button>
    </div>
    ${(pr.PR_Comments||[]).length ? `
      <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:14px">
        <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:10px">COMMENTS (${pr.PR_Comments.length})</div>
        ${pr.PR_Comments.map(c=>`
          <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;font-size:12px">
            <div style="display:flex;gap:16px;color:var(--text2);margin-bottom:4px">
              <span>🗨 ${c.Commenter||'—'}</span>
              <span>📅 ${c['Comment Date']||'—'}</span>
              ${c.Response_Dev?`<span>↩ ${c.Response_Dev} on ${c['Response Date']||'—'}</span>`:''}
            </div>
            <div>${c['No of Comments']?`${c['No of Comments']} comment(s)`:''}</div>
          </div>`).join('')}
      </div>` : ''}`;
  document.getElementById('prDetailModal').classList.add('open');
}

async function updatePRStatusFromDetail(id, prNum) {
  const newStatus = document.getElementById('prDetailStatusSel').value;
  if (!newStatus) return showToast('Select a status', 'error');

  const targetSel = document.getElementById('prDetailTargetSel');
  const newTarget = targetSel ? targetSel.value : '';
  const originalTarget = targetSel ? (targetSel.dataset.original || '') : '';
  const targetChanged = newTarget !== originalTarget;

  const body = { Status: newStatus };
  if (targetChanged) body.Target_Release = newTarget || null;

  const res = await authFetch(`${API}/prs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');

  const idx = allPRs.findIndex(p => p.id === id);
  if (idx !== -1) {
    allPRs[idx] = { ...allPRs[idx], Status: newStatus };
    if (targetChanged) allPRs[idx].Target_Release = newTarget || null;
  }

  const sync = json.sync || {};
  if (targetChanged && sync.synced) {
    showToast(`PR #${prNum} updated · Release ${sync.releaseNumber} synced`, 'success');
  } else if (targetChanged && newTarget && sync.reason) {
    showToast(`PR #${prNum} updated · Release sync: ${sync.reason}`, 'error');
  } else {
    showToast(`PR #${prNum} → ${newStatus}`, 'success');
  }

  closeModal('prDetailModal');
  renderReleases();
}

// ── Release Modal (add / edit) ─────────────────────────
let relModuleRows = []; // [{Module, User_Story, Pages:[{Page_Name,PR,Task,Feature_Flag,Feature_Flag_Status}]}]

function getPagesForRelModule(moduleName) {
  if (!moduleName) return [];
  const mod = allModulePages.find(m => m.Module === moduleName);
  return mod ? (mod.Pages || []) : [];
}

function getFFForPage(moduleName, pageName) {
  const pages = getPagesForRelModule(moduleName);
  const found = pages.find(p => p.page_name === pageName);
  return found ? (found.Feature_Flag || '') : '';
}

function getFFStatusForPage(moduleName, pageName) {
  const pages = getPagesForRelModule(moduleName);
  const found = pages.find(p => p.page_name === pageName);
  return found ? (found.Feature_Flag_Status || 'Enabled') : 'N/A';
}

function openAddReleaseModal() {
  editingRelease = null;
  document.getElementById('relModalTitle').textContent = 'Add Release';
  document.getElementById('saveRelBtn').textContent = 'Add Release';
  ['r_number','r_date','r_freeze','r_regression','r_sprint'].forEach(id=>document.getElementById(id).value='');
  relModuleRows = [];
  renderRelModuleRows();
  document.getElementById('releaseModal').classList.add('open');
}

function openEditReleaseModal(releaseNumber) {
  const rel = allReleases.find(r=>String(r.Release_Number)===String(releaseNumber));
  if (!rel) return;
  editingRelease = releaseNumber;
  document.getElementById('relModalTitle').textContent = `Edit Release ${releaseNumber}`;
  document.getElementById('saveRelBtn').textContent = 'Update Release';
  document.getElementById('r_number').value        = rel.Release_Number||'';
  document.getElementById('r_date').value          = rel.Release_Date||'';
  document.getElementById('r_freeze').value        = rel.Code_Freeze||'';
  document.getElementById('r_regression').value    = rel.Regression_Start||'';
  document.getElementById('r_sprint').value        = rel.Sprint||'';
  relModuleRows = JSON.parse(JSON.stringify(rel.Modules||[]));
  renderRelModuleRows();
  document.getElementById('releaseModal').classList.add('open');
}

function onRelModuleChange(mi, selectEl) {
  relModuleRows[mi].Module = selectEl.value;
  relModuleRows[mi].Pages = [];
  renderRelModuleRows();
}

function onRelPageSelect(mi, pi, selectEl) {
  const pageName = selectEl.value;
  const moduleName = relModuleRows[mi].Module;
  relModuleRows[mi].Pages[pi].Page_Name    = pageName;
  relModuleRows[mi].Pages[pi].Feature_Flag = getFFForPage(moduleName, pageName);
  relModuleRows[mi].Pages[pi].Feature_Flag_Status = getFFStatusForPage(moduleName, pageName);
  const ffInput   = document.getElementById(`ff-input-${mi}-${pi}`);
  const ffsSelect = document.getElementById(`ffs-select-${mi}-${pi}`);
  if (ffInput)   ffInput.value = relModuleRows[mi].Pages[pi].Feature_Flag;
  if (ffsSelect) ffsSelect.value = relModuleRows[mi].Pages[pi].Feature_Flag_Status;
}

function onRelFFInput(mi, pi, inputEl) {
  relModuleRows[mi].Pages[pi].Feature_Flag = inputEl.value;
}

function renderRelModuleRows() {
  const container = document.getElementById('r_modules_list');
  if (!relModuleRows.length) {
    container.innerHTML = `<div style="color:var(--text2);font-size:12px;padding:8px 0">No modules added yet.</div>`;
    return;
  }

  container.innerHTML = relModuleRows.map((mod, mi) => {
    const availablePages = getPagesForRelModule(mod.Module);

    const colHeader = (mod.Pages||[]).length ? `
      <div style="display:grid;grid-template-columns:2fr 2fr 80px 90px 1fr auto;gap:5px;margin-bottom:4px;padding:0 2px">
        <span style="font-size:10px;color:var(--text2);font-weight:600;text-transform:uppercase">Page</span>
        <span style="font-size:10px;color:var(--text2);font-weight:600;text-transform:uppercase">Feature Flag</span>
        <span style="font-size:10px;color:var(--text2);font-weight:600;text-transform:uppercase">PR #</span>
        <span style="font-size:10px;color:var(--text2);font-weight:600;text-transform:uppercase">Task #</span>
        <span style="font-size:10px;color:var(--text2);font-weight:600;text-transform:uppercase">FF Status</span>
        <span></span>
      </div>` : '';

    const pageRows = (mod.Pages||[]).map((pg, pi) => {
      const ffVal  = pg.Feature_Flag || getFFForPage(mod.Module, pg.Page_Name) || '';
      const ffsVal = pg.Feature_Flag_Status || getFFStatusForPage(mod.Module, pg.Page_Name) || 'N/A';
      return `
        <div style="display:grid;grid-template-columns:2fr 2fr 80px 90px 1fr auto;gap:5px;margin-bottom:5px;align-items:center">
          <select id="page-sel-${mi}-${pi}"
            style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;font-size:11px;width:100%"
            onchange="onRelPageSelect(${mi},${pi},this)">
            <option value="">— select page —</option>
            ${availablePages.map(p =>
              `<option value="${p.page_name}" ${pg.Page_Name===p.page_name?'selected':''}>${p.page_name}</option>`
            ).join('')}
          </select>
          <input type="text" id="ff-input-${mi}-${pi}"
            value="${ffVal}" placeholder="Auto-filled from page"
            style="background:var(--surface3);border:1px solid var(--border);color:var(--accent2);padding:5px 8px;border-radius:5px;font-size:11px"
            oninput="onRelFFInput(${mi},${pi},this)">
          <input type="text" value="${pg.PR||''}" placeholder="PR #"
            style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;font-size:11px"
            oninput="relModuleRows[${mi}].Pages[${pi}].PR=Number(this.value)||null">
          <input type="text" value="${pg.Task||''}" placeholder="Task #"
            style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;font-size:11px"
            oninput="relModuleRows[${mi}].Pages[${pi}].Task=this.value">
          <select id="ffs-select-${mi}-${pi}"
            style="background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;font-size:11px"
            onchange="relModuleRows[${mi}].Pages[${pi}].Feature_Flag_Status=this.value">
            <option ${ffsVal==='Enabled'?'selected':''}>Enabled</option>
            <option ${ffsVal==='Disabled'?'selected':''}>Disabled</option>
            <option ${ffsVal==='N/A'?'selected':''}>N/A</option>
          </select>
          <button class="btn btn-danger btn-xs" onclick="removeRelPage(${mi},${pi})">✕</button>
        </div>`;
    }).join('');

    return `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:12px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
        <select
          style="flex:1;background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px"
          onchange="onRelModuleChange(${mi},this)">
          <option value="">— select module —</option>
          ${allModulePages.map(m =>
            `<option value="${m.Module}" ${mod.Module===m.Module?'selected':''}>${m.Module}</option>`
          ).join('')}
        </select>
        <input type="text" value="${mod.User_Story||''}" placeholder="US#"
          style="width:100px;background:var(--surface3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:12px"
          oninput="relModuleRows[${mi}].User_Story=this.value">
        <button class="btn btn-danger btn-xs" onclick="removeRelModule(${mi})">✕</button>
      </div>
      <div style="margin-top:4px">
        <div style="font-size:11px;color:var(--text2);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">${mod.Module ? `Pages for ${mod.Module}` : 'Pages'} (${(mod.Pages||[]).length})</span>
          <button class="btn btn-ghost btn-xs" onclick="addRelPageRow(${mi})"
            ${!mod.Module?'disabled title="Select a module first"':''}>＋ Add Page</button>
        </div>
        ${colHeader}
        ${pageRows}
        ${!mod.Module && !(mod.Pages||[]).length ? `<div style="font-size:11px;color:var(--text2);padding:6px 0 2px">Select a module to add pages.</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function addRelModuleRow() {
  relModuleRows.push({ Module:'', User_Story:'', Pages:[] });
  renderRelModuleRows();
}

function removeRelModule(mi) {
  relModuleRows.splice(mi,1);
  renderRelModuleRows();
}

function addRelPageRow(mi) {
  const moduleName = relModuleRows[mi].Module;
  if (!moduleName) return showToast('Select a module first', 'error');
  relModuleRows[mi].Pages.push({ Page_Name:'', Feature_Flag:'', PR:null, Task:'', Feature_Flag_Status:'N/A' });
  renderRelModuleRows();
}

function removeRelPage(mi, pi) {
  relModuleRows[mi].Pages.splice(pi,1);
  renderRelModuleRows();
}

function closeReleaseModal() {
  document.getElementById('releaseModal').classList.remove('open');
  editingRelease = null;
  relModuleRows = [];
}

async function saveRelease() {
  const num = document.getElementById('r_number').value.trim();
  if (!num) return showToast('Release number required','error');
  const body = {
    Release_Number: num,
    Release_Date:       document.getElementById('r_date').value.trim()||null,
    Code_Freeze:        document.getElementById('r_freeze').value.trim()||null,
    Regression_Start:   document.getElementById('r_regression').value.trim()||null,
    Sprint:             document.getElementById('r_sprint').value.trim()||null,
    Modules: relModuleRows,
  };
  const isEdit = !!editingRelease;
  const res = await authFetch(`${API}/releases${isEdit?'/'+editingRelease:''}`, {
    method: isEdit?'PUT':'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');

  // Sync Task # from release page entries to PRDetails
  if (isEdit) {
    const taskByPR = {};
    relModuleRows.forEach(mod => {
      (mod.Pages || []).forEach(pg => {
        if (pg.PR && pg.Task) taskByPR[pg.PR] = pg.Task;
      });
    });
    await Promise.all(Object.entries(taskByPR).map(([prNum, task]) =>
      authFetch(`${API}/prs/by-pr/${prNum}`, {
        method: 'PUT',
        body: JSON.stringify({ Task: task }),
      })
    ));
  }

  showToast(isEdit?`Release ${num} updated`:`Release ${num} created`,'success');
  closeReleaseModal();
  renderReleases();
}

async function deleteRelease(releaseNumber) {
  if (!confirm(`Delete release ${releaseNumber}?`)) return;
  const res = await authFetch(`${API}/releases/${releaseNumber}`,{method:'DELETE'});
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast(`Release ${releaseNumber} deleted`,'success');
  renderReleases();
}

async function completeRelease(releaseNumber) {
  if (!confirm(
    `Mark Release ${releaseNumber} as complete?\n\n` +
    `This will:\n` +
    `• Set Production Deployment Status → Deployed for all release pages\n` +
    `• Update Feature Flag Status per release settings\n` +
    `• Stamp Release_Date on all affected pages\n` +
    `• Update all associated PRs → "Prod Deployed" + stamp Release_Date`
  )) return;
  const res  = await authFetch(`${API}/releases/${releaseNumber}/complete`, { method: 'POST' });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`Release ${releaseNumber} completed — ${json.prCount} PR(s) updated`, 'success');
  renderReleases();
  if (document.getElementById('section-modules').classList.contains('active')) renderModulePages();
}
