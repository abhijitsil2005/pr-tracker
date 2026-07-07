// ═══════════════════════════════════════════════════════
// MODULE PAGES
// ═══════════════════════════════════════════════════════
async function renderModulePages() {
  const [data, prsData] = await Promise.all([api('modules'), api('prs')]);
  allModulePages = data || [];
  allPRs = (prsData && prsData.data) || [];
  const search = (document.getElementById('mpSearch').value||'').toLowerCase();
  const container = document.getElementById('mpContainer');

  let modules = allModulePages;
  if (search) {
    modules = modules
      .map(m => {
        const modMatch = m.Module.toLowerCase().includes(search);
        const filtPages = m.Pages.filter(p =>
          modMatch ||
          p.page_name.toLowerCase().includes(search) ||
          (p.Feature_Flag||'').toLowerCase().includes(search)
        );
        const filtOOS = m.OutOfScope ? m.OutOfScope.filter(p => modMatch || p.toLowerCase().includes(search)) : [];
        if (!modMatch && !filtPages.length && !filtOOS.length) return null;
        return { ...m, Pages: filtPages, OutOfScope: filtOOS };
      })
      .filter(Boolean);
  }

  if (!modules.length) {
    container.innerHTML = `<div class="empty"><div class="e-icon">📦</div><p>No modules found.</p></div>`;
    return;
  }

  const prsByPage = {};
  allPRs.forEach(pr => (pr.Page||[]).forEach(pg => {
    const key = `${pr.Module}::${pg}`;
    (prsByPage[key] = prsByPage[key]||[]).push(pr);
  }));

  const openIds = getOpenAccordions();
  container.innerHTML = modules
    .sort((a, b) => {
      if (!!a.IsOutOfScope !== !!b.IsOutOfScope) return a.IsOutOfScope ? 1 : -1;
      return a.Module.localeCompare(b.Module);
    })
    .map(m => buildModuleAccordion(m, prsByPage)).join('');
  reopenAccordions(openIds);
}

document.getElementById('mpSearch').addEventListener('input', renderModulePages);

function getOpenAccordions() {
  return [...document.querySelectorAll('.mp-acc-body.open')]
    .map(el => el.id.replace(/^b-/, ''));
}

function reopenAccordions(ids) {
  ids.forEach(id => {
    const body = document.getElementById(`b-${id}`);
    const chev = document.getElementById(`c-${id}`);
    if (body) body.classList.add('open');
    if (chev) chev.classList.add('open');
  });
}

function buildModuleAccordion(mod, prsByPage = {}) {
  const accId   = `mp-${mod.Module.replace(/\s+/g,'_')}`;
  const pages   = mod.Pages || [];

  const countablePages = pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name));
  const prodDep  = countablePages.filter(p => (p.Production_Deployment_Status||'').toLowerCase() === 'deployed').length;
  const ffEn     = countablePages.filter(p => (p.Feature_Flag_Status||'').toLowerCase() === 'enabled').length;
  const demoDone = countablePages.filter(p => (p.Client_Demo_Status||'').toLowerCase() === 'done').length;

  const pagesHtml = [...pages].sort((a, b) => {
    const aInfra = a.page_name === 'Infrastructure Pages';
    const bInfra = b.page_name === 'Infrastructure Pages';
    if (aInfra !== bInfra) return aInfra ? 1 : -1;
    return a.page_name.localeCompare(b.page_name, undefined, { sensitivity: 'base' });
  }).map(p => {
    const prodStatus = p.Production_Deployment_Status || 'Pending';
    const demoStatus = p.Client_Demo_Status || 'Pending';
    const linkedPRs  = prsByPage[`${mod.Module}::${p.page_name}`] || [];
    const prPills    = linkedPRs.map(pr => `<span class="pr-pill" onclick="openEditPRModal('${pr.id}')">#${pr.PR}</span>`).join('');
    return `<tr>
      <td style="font-family:monospace;font-size:11px" title="${p.page_name}">${p.page_name}</td>
      <td style="font-size:11px" title="${p.Feature_Flag||''}">${p.Feature_Flag||'—'}</td>
      <td>${ffBadge(p.Feature_Flag_Status)}</td>
      <td>${demoStatusBadge(demoStatus)}</td>
      <td>${prodStatusBadge(prodStatus)}</td>
      <td style="font-size:11px;color:var(--text2)">${p.Release_Date||'—'}</td>
      <td class="mp-prs-cell">${prPills || '<span style="color:var(--text2);font-size:11px">—</span>'}</td>
      <td style="white-space:nowrap">
        ${canWrite() ? `<button class="btn btn-ghost btn-xs" onclick="openEditPageModal('${mod.Module}','${escAttr(p.page_name)}')">✏️</button>
        <button class="btn btn-danger btn-xs" onclick="deletePageFromMod('${mod.Module}','${escAttr(p.page_name)}')">🗑</button>` : ''}
        <button class="btn btn-primary btn-xs" onclick="openPagePRModal('${mod.Module}','${escAttr(p.page_name)}')">🔗</button>
      </td>
    </tr>`;
  }).join('');

  const modulePages = countablePages;
  const prodPct   = modulePages.length ? Math.round(prodDep / modulePages.length * 100) : 0;
  const barColor  = prodPct === 100 ? 'var(--green)' : prodPct > 0 ? 'var(--yellow)' : 'var(--border)';

  const allFullyReleased = modulePages.length > 0 && prodDep === modulePages.length;
  const releaseBadge = allFullyReleased && mod.Actual_Release_Date
    ? `<span class="badge badge-green" title="Actual Release Date">✅ ${mod.Actual_Release_Date}</span>`
    : mod.Planned_Release_Date
    ? `<span class="badge badge-blue" title="Planned Release Date">📅 ${mod.Planned_Release_Date}</span>`
    : '';

  return `
    <div class="mp-accordion" id="${accId}">
      <div class="mp-acc-header" onclick="toggleAcc('${accId}')">
        <div class="mp-acc-left">
          <span class="chevron" id="c-${accId}">▼</span>
          <span class="mp-acc-name">📦 ${mod.Module}</span>
          <div class="mp-acc-counts">
            ${mod.IsOutOfScope ? `<span class="badge badge-red">MODULE OUT OF SCOPE</span>` : `
            <span class="badge badge-blue">${modulePages.length} page${modulePages.length!==1?'s':''}</span>
            <span class="badge badge-green" title="Prod Deployed">${prodDep} prod</span>
            <span class="badge badge-teal" title="Demo Done">${demoDone} demo</span>
            <span class="badge ${ffEn===modulePages.length&&modulePages.length?'badge-green':'badge-yellow'}" title="FF Enabled">${ffEn}/${modulePages.length} FF</span>
            ${releaseBadge}`}
          </div>
          <div style="width:80px;height:4px;border-radius:2px;background:var(--surface3);margin-left:4px" title="${prodPct}% deployed">
            <div style="height:100%;width:${prodPct}%;background:${barColor};border-radius:2px"></div>
          </div>
        </div>
        ${canWrite() ? `<div onclick="event.stopPropagation()" style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" onclick="openAddPageModal('${mod.Module}')">＋ Page</button>
          <button class="btn btn-ghost btn-sm" onclick="promptAddOOS('${mod.Module}')">＋ Out-of-scope</button>
          <button class="btn btn-ghost btn-sm" onclick="openEditModuleModal('${mod.Module}')">✏️ Edit</button>
          <button class="btn ${mod.IsOutOfScope ? 'btn-ghost' : 'btn-warning'} btn-sm" onclick="toggleModuleOOS('${mod.Module}', ${!!mod.IsOutOfScope})">${mod.IsOutOfScope ? '✓ Mark In Scope' : '⊘ Mark Out of Scope'}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteModule('${mod.Module}')">🗑 Module</button>
        </div>` : ''}
      </div>
      <div class="mp-acc-body" id="b-${accId}">
        ${mod.IsOutOfScope
          ? `<div style="padding:16px 20px;color:var(--text2);font-size:13px">This module is out of scope.</div>`
          : `<table class="mp-pages-table">
          <colgroup>
            <col class="mpc-page"><col class="mpc-ff"><col class="mpc-ffs">
            <col class="mpc-demo"><col class="mpc-prod">
            <col class="mpc-releasedate"><col class="mpc-prs"><col class="mpc-actions">
          </colgroup>
          <thead>
            <tr>
              <th>Page Name</th><th>Feature Flag</th><th>FF Status</th>
              <th>Demo Status</th><th>Prod Status</th>
              <th>Release Date</th><th>PRs</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>${pagesHtml || '<tr><td colspan="8" style="color:var(--text2);text-align:center;padding:16px">No pages defined</td></tr>'}</tbody>
        </table>
        ${(() => {
          const oos = mod.OutOfScope || [];
          if (!oos.length) return '';
          return `<div class="mp-oos-section">
            <div class="mp-oos-header">Out-of-Scope Pages <span class="badge badge-yellow" style="font-size:10px">${oos.length}</span></div>
            ${oos.map(p => `<div class="mp-oos-row">
              <span class="mp-oos-name">${p}</span>
              ${canWrite() ? `<button class="btn btn-danger btn-xs" onclick="removeOOS('${escAttr(mod.Module)}','${escAttr(p)}')">Remove</button>` : ''}
            </div>`).join('')}
          </div>`;
        })()}`}
      </div>
    </div>`;
}

function toggleAcc(id) {
  const body = document.getElementById(`b-${id}`);
  const chev = document.getElementById(`c-${id}`);
  body.classList.toggle('open');
  chev.classList.toggle('open');
}

// ── Add Module ─────────────────────────────────────────
function openAddModuleModal() {
  document.getElementById('nm_name').value = '';
  document.getElementById('addModuleModal').classList.add('open');
}

async function saveNewModule() {
  const name = document.getElementById('nm_name').value.trim();
  if (!name) return showToast('Module name required','error');
  const res = await authFetch(`${API}/modules`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ Module:name }) });
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast(`Module "${name}" created`,'success');
  closeModal('addModuleModal');
  await loadLookups();
  renderModulePages();
}

async function deleteModule(moduleName) {
  if (!confirm(`Delete module "${moduleName}" and all its pages?`)) return;
  const res = await authFetch(`${API}/modules/${encodeURIComponent(moduleName)}`,{method:'DELETE'});
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast(`Module "${moduleName}" deleted`,'success');
  renderModulePages();
}

async function toggleModuleOOS(moduleName, currentlyOOS) {
  const res = await authFetch(`${API}/modules/${encodeURIComponent(moduleName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ IsOutOfScope: !currentlyOOS }),
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`Module "${moduleName}" marked as ${!currentlyOOS ? 'out of scope' : 'in scope'}`, 'success');
  renderModulePages();
}

// ── Edit Module Modal ──────────────────────────────────
let _editModuleName = null;

function openEditModuleModal(moduleName) {
  const mod = allModulePages.find(m => m.Module === moduleName);
  if (!mod) return;
  _editModuleName = moduleName;
  document.getElementById('editModuleTitle').textContent = `Edit Module — ${moduleName}`;
  const sorted = [...lookupTimeline].sort((a, b) => Number(a.Release_Number) - Number(b.Release_Number));
  ['mod_plannedRelease', 'mod_actualRelease'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="">— select —</option>';
    sorted.forEach(t => sel.add(new Option(`${t.Release_Date} (R${t.Release_Number})`, t.Release_Date)));
  });
  document.getElementById('mod_plannedRelease').value = mod.Planned_Release_Date || '';
  document.getElementById('mod_actualRelease').value  = mod.Actual_Release_Date  || '';
  document.getElementById('editModuleModal').classList.add('open');
}

async function saveModuleDetails() {
  if (!_editModuleName) return;
  const body = {
    Planned_Release_Date: document.getElementById('mod_plannedRelease').value || null,
    Actual_Release_Date:  document.getElementById('mod_actualRelease').value  || null,
  };
  const res  = await authFetch(`${API}/modules/${encodeURIComponent(_editModuleName)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast('Module updated', 'success');
  closeModal('editModuleModal');
  renderModulePages();
}

// ── Page modal ─────────────────────────────────────────

function openEditPageModal(moduleName, pageName) {
  const mod  = allModulePages.find(m => m.Module === moduleName);
  const page = mod ? mod.Pages.find(p => p.page_name === pageName) : null;
  if (!page) return;
  pageModalCtx = { moduleName, pageName };
  document.getElementById('pageModalTitle').textContent = `Edit Page in ${moduleName}`;
  document.getElementById('savePageBtn').textContent    = 'Update Page';
  document.getElementById('pg_name').value       = page.page_name;
  document.getElementById('pg_name').disabled    = true;
  document.getElementById('pg_flag').value       = page.Feature_Flag || '';
  document.getElementById('pg_flagStatus').value = page.Feature_Flag_Status || 'N/A';
  document.getElementById('pg_demoStatus').value   = page.Client_Demo_Status || 'Pending';
  document.getElementById('pg_demoDate').value     = page.Client_Demo_Date  || '';
  document.getElementById('pg_prodStatus').value   = page.Production_Deployment_Status || 'Pending';
  document.getElementById('pg_releaseDate').value  = page.Release_Date || '';
  document.getElementById('pagePRSection').style.display = 'block';
  loadPageModalPRs(pageName);
  document.getElementById('pageModal').classList.add('open');
}

function openAddPageModal(moduleName) {
  pageModalCtx = { moduleName, pageName: null };
  document.getElementById('pageModalTitle').textContent = `Add Page to ${moduleName}`;
  document.getElementById('savePageBtn').textContent    = 'Add Page';
  document.getElementById('pg_name').value       = '';
  document.getElementById('pg_name').disabled    = false;
  document.getElementById('pg_flag').value       = '';
  document.getElementById('pg_flagStatus').value = 'N/A';
  document.getElementById('pg_demoStatus').value  = 'Pending';
  document.getElementById('pg_demoDate').value    = '';
  document.getElementById('pg_prodStatus').value  = 'Pending';
  document.getElementById('pg_releaseDate').value = '';
  document.getElementById('pagePRSection').style.display = 'none';
  document.getElementById('pageModalPRList').innerHTML = '';
  document.getElementById('pageModalPRSelect').innerHTML = '<option value="">— link existing PR —</option>';
  document.getElementById('pageModal').classList.add('open');
}

async function savePage() {
  if (!pageModalCtx) return;
  const { moduleName, pageName } = pageModalCtx;
  const isEdit = !!pageName;
  const body = {
    page_name:                    document.getElementById('pg_name').value.trim(),
    Feature_Flag:                 document.getElementById('pg_flag').value.trim(),
    Feature_Flag_Status:          document.getElementById('pg_flagStatus').value,
    Client_Demo_Status:           document.getElementById('pg_demoStatus').value,
    Client_Demo_Date:             document.getElementById('pg_demoDate').value.trim(),
    Production_Deployment_Status: document.getElementById('pg_prodStatus').value,
    Release_Date:                 document.getElementById('pg_releaseDate').value.trim() || null,
  };
  if (!body.page_name) return showToast('Page name required', 'error');
  const url = isEdit
    ? `${API}/modules/${encodeURIComponent(moduleName)}/pages/${encodeURIComponent(pageName)}`
    : `${API}/modules/${encodeURIComponent(moduleName)}/pages`;
  const res  = await authFetch(url, { method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(isEdit ? 'Page updated' : 'Page added', 'success');
  document.getElementById('pg_name').disabled = false;
  closeModal('pageModal');
  renderModulePages();
  if (document.getElementById('section-dashboard').classList.contains('active')) renderDashboard();
}

async function deletePageFromMod(moduleName, pageName) {
  if (!confirm(`Delete page "${pageName}" from ${moduleName}?`)) return;
  const res = await authFetch(`${API}/modules/${encodeURIComponent(moduleName)}/pages/${encodeURIComponent(pageName)}`,{method:'DELETE'});
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast('Page deleted','success');
  renderModulePages();
}

// ── Out-of-scope ───────────────────────────────────────
async function promptAddOOS(moduleName) {
  const pn = prompt(`Add out-of-scope page name for "${moduleName}":`);
  if (!pn || !pn.trim()) return;
  const res = await authFetch(`${API}/modules/${encodeURIComponent(moduleName)}/out-of-scope`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({page_name:pn.trim()}) });
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast('Out-of-scope page added','success');
  renderModulePages();
}

async function removeOOS(moduleName, pageName) {
  const res = await authFetch(`${API}/modules/${encodeURIComponent(moduleName)}/out-of-scope/${encodeURIComponent(pageName)}`,{method:'DELETE'});
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast('Removed from out-of-scope','success');
  renderModulePages();
}

// ── Page PR Management ─────────────────────────────────
async function openPagePRModal(moduleName, pageName) {
  pagePRCtx = { moduleName, pageName };
  document.getElementById('pagePRTitle').textContent = `PRs — ${pageName}`;
  document.getElementById('pagePRModal').classList.add('open');
  await refreshPagePRModal();
}

async function refreshPagePRModal() {
  const { moduleName, pageName } = pagePRCtx;
  const prsData = await api('prs');
  allPRs = (prsData && prsData.data) || [];

  const linked   = allPRs.filter(p => p.Module === moduleName && (p.Page||[]).includes(pageName));
  const unlinked = allPRs.filter(p => p.Module === moduleName && !(p.Page||[]).includes(pageName));

  const linkedDiv = document.getElementById('pagePRLinked');
  linkedDiv.innerHTML = linked.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>PR #</th><th>Module</th><th>Developer</th><th>Status</th><th>Target Release</th><th></th></tr></thead>
        <tbody>${linked.map(p => `<tr>
          <td><strong style="color:var(--accent)">#${p.PR}</strong></td>
          <td>${p.Module||'—'}</td>
          <td>${p.Developer||'—'}</td>
          <td>${statusBadge(p.Status)}</td>
          <td>${p.Target_Release||'—'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-xs" onclick="closeModal('pagePRModal');openEditPRModal('${p.id}')">✏️ Edit</button>
            <button class="btn btn-danger btn-xs" onclick="unlinkPRFromPage('${p.id}', ${p.PR})">Unlink</button>
          </td>
        </tr>`).join('')}</tbody>
      </table></div>`
    : `<p style="color:var(--text2);font-size:13px;padding:8px 0">No PRs linked to this page yet.</p>`;

  const sel = document.getElementById('prLinkSelect');
  sel.innerHTML = '<option value="">— select a PR to link —</option>';
  unlinked.sort((a,b) => b.PR - a.PR).forEach(p => sel.add(new Option(
    `#${p.PR} — ${p.Developer||'?'} (${p.Status||'?'})`, p.id
  )));

  renderModulePages();
}

async function linkSelectedPR() {
  const prId = document.getElementById('prLinkSelect').value;
  if (!prId) return showToast('Select a PR first', 'error');
  const { pageName } = pagePRCtx;

  const pr = await api(`prs/by-id/${prId}`);
  if (!pr) return showToast('PR not found', 'error');
  const pages = [...new Set([...(pr.Page||[]), pageName])];
  const res = await authFetch(`${API}/prs/${prId}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...pr, Page: pages})
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`PR #${pr.PR} linked to page`, 'success');
  await refreshPagePRModal();
}

async function unlinkPRFromPage(prId, prNumber) {
  if (!confirm(`Unlink PR #${prNumber} from this page?`)) return;
  const { pageName } = pagePRCtx;

  const pr = await api(`prs/by-id/${prId}`);
  if (!pr) return showToast('PR not found', 'error');
  const pages = (pr.Page||[]).filter(pg => pg !== pageName);
  const res = await authFetch(`${API}/prs/${prId}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...pr, Page: pages})
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`PR #${prNumber} unlinked`, 'success');
  await refreshPagePRModal();
}

function openNewPRForPage() {
  const { moduleName, pageName } = pagePRCtx;
  closeModal('pagePRModal');
  openAddPRModalForPage(moduleName, pageName);
}

// ── PR management inside Edit Page modal ───────────────
function loadPageModalPRs(pageName) {
  const { moduleName } = pageModalCtx;
  const linked   = allPRs.filter(p => p.Module === moduleName && (p.Page||[]).includes(pageName));
  const unlinked = allPRs.filter(p => p.Module === moduleName && !(p.Page||[]).includes(pageName));

  const listDiv = document.getElementById('pageModalPRList');
  if (!linked.length) {
    listDiv.innerHTML = '<span style="color:var(--text2);font-size:12px">No PRs linked yet.</span>';
  } else {
    listDiv.innerHTML = linked.map(p => `
      <span class="pr-pill">
        #${p.PR}
        <span style="color:var(--text2);font-weight:400;margin-left:2px">${p.Developer||''}</span>
        ${statusBadge(p.Status)}
        <button onclick="unlinkPRFromPageModal('${p.id}', ${p.PR})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:13px;line-height:1;padding:0 0 0 4px" title="Unlink">✕</button>
      </span>`).join('');
  }

  const sel = document.getElementById('pageModalPRSelect');
  sel.innerHTML = '<option value="">— link existing PR —</option>';
  unlinked.sort((a,b) => b.PR - a.PR).forEach(p => sel.add(new Option(
    `#${p.PR} — ${p.Developer||'?'} (${p.Status||'?'})`, p.id
  )));
}

async function linkPRFromPageModal() {
  const prId = document.getElementById('pageModalPRSelect').value;
  if (!prId) return showToast('Select a PR first', 'error');
  const { pageName } = pageModalCtx;

  const pr = await api(`prs/by-id/${prId}`);
  if (!pr) return showToast('PR not found', 'error');
  const pages = [...new Set([...(pr.Page||[]), pageName])];
  const res = await authFetch(`${API}/prs/${prId}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...pr, Page: pages})
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');

  const idx = allPRs.findIndex(p => p.id === prId);
  if (idx >= 0) allPRs[idx] = {...allPRs[idx], Page: pages};
  else allPRs.push({...pr, Page: pages});

  showToast(`PR #${pr.PR} linked`, 'success');
  loadPageModalPRs(pageName);
}

async function unlinkPRFromPageModal(prId, prNumber) {
  if (!confirm(`Unlink PR #${prNumber} from this page?`)) return;
  const { pageName } = pageModalCtx;

  const pr = await api(`prs/by-id/${prId}`);
  if (!pr) return showToast('PR not found', 'error');
  const pages = (pr.Page||[]).filter(pg => pg !== pageName);
  const res = await authFetch(`${API}/prs/${prId}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({...pr, Page: pages})
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');

  const idx = allPRs.findIndex(p => p.id === prId);
  if (idx >= 0) allPRs[idx] = {...allPRs[idx], Page: pages};

  showToast(`PR #${prNumber} unlinked`, 'success');
  loadPageModalPRs(pageName);
}

function createPRFromPageModal() {
  const { moduleName, pageName } = pageModalCtx;
  closeModal('pageModal');
  document.getElementById('pg_name').disabled = false;
  openAddPRModalForPage(moduleName, pageName);
}
