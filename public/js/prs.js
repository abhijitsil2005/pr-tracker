// ═══════════════════════════════════════════════════════
// PULL REQUESTS
// ═══════════════════════════════════════════════════════
async function renderPRs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.module) params.set('module', filters.module);
  if (filters.developer) params.set('developer', filters.developer);
  if (filters.status) params.set('status', filters.status);
  const data = await api(`prs?${params}`);
  allPRs = (data && data.data) || [];
  const search = (document.getElementById('searchInput').value || '').toLowerCase();
  let rows = allPRs;
  if (search) rows = rows.filter(p =>
    String(p.PR).includes(search) ||
    (p.Developer||'').toLowerCase().includes(search) ||
    (p.Module||'').toLowerCase().includes(search) ||
    (p.Status||'').toLowerCase().includes(search));
  document.getElementById('prTableBody').innerHTML = rows.sort((a,b)=>b.Dev_Sprint-a.Dev_Sprint).map(p => `
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
        <button class="btn btn-ghost btn-sm" onclick="openEditPRModal(${p.PR})">✏️</button>
        <button class="btn btn-danger btn-sm" onclick="deletePR(${p.PR})">🗑</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;color:var(--text2);padding:32px">No PRs found</td></tr>`;
  const statSel = document.getElementById('filterStatus');
  const cur = statSel.value;
  statSel.innerHTML = '<option value="">All Statuses</option>';
  [...new Set(allPRs.map(p=>p.Status).filter(Boolean))].sort().forEach(s=>statSel.add(new Option(s,s)));
  statSel.value = cur;
}

['filterModule','filterDeveloper','filterStatus'].forEach(id => document.getElementById(id).addEventListener('change', applyFilters));
document.getElementById('searchInput').addEventListener('input', applyFilters);
function applyFilters() {
  renderPRs({ module:document.getElementById('filterModule').value, developer:document.getElementById('filterDeveloper').value, status:document.getElementById('filterStatus').value });
}

// ── PR Modal ───────────────────────────────────────────
function populatePRModuleSelect(selectedValue) {
  const sel = document.getElementById('f_module');
  sel.innerHTML = '<option value="">— select —</option>';
  lookupModules.sort((a, b) => a.localeCompare(b)).forEach(m => sel.add(new Option(m, m)));
  if (selectedValue) sel.value = selectedValue;
}

function openAddPRModal() {
  editingPR = null;
  document.getElementById('prModalTitle').textContent = 'Add PR';
  document.getElementById('savePRBtn').textContent = 'Add PR';
  clearPRForm();
  populatePRModuleSelect();
  document.getElementById('prModal').classList.add('open');
}

async function openAddPRModalForPage(moduleName, pageName) {
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

async function openEditPRModal(prNumber) {
  const pr = await api(`prs/${prNumber}`);
  editingPR = pr.PR;
  document.getElementById('prModalTitle').textContent = `Edit PR #${pr.PR}`;
  document.getElementById('savePRBtn').textContent = 'Update PR';
  document.getElementById('f_pr').value = pr.PR;
  document.getElementById('f_pr').disabled = true;
  document.getElementById('f_type').value = pr.Type||'Development';
  populatePRModuleSelect(pr.Module||'');
  document.getElementById('f_developer').value = pr.Developer||'';
  await loadPageOptions();
  const savedPages = new Set(pr.Page||[]);
  document.getElementById('f_pages').querySelectorAll('.page-chip').forEach(chip => {
    if (savedPages.has(chip.dataset.value)) chip.classList.add('selected');
  });
  document.getElementById('f_status').value = pr.Status||'';
  document.getElementById('f_reviewer').value = pr.Reviewer||'';
  document.getElementById('f_raised').value = pr['PR Raised Date']||'';
  document.getElementById('f_firstResponse').value = pr['PR First Response Date']||'';
  document.getElementById('f_approved').value = pr['PR Approved Date']||'';
  document.getElementById('f_merged').value = pr['PR Merged Date']||'';
  document.getElementById('f_devSprint').value = pr.Dev_Sprint||'';
  document.getElementById('f_testSprint').value = pr.Testing_Sprint||'';
  document.getElementById('f_target').value = pr.Target_Release||'';
  document.getElementById('f_deps').value = (pr.Dependent_PRs||[]).join(', ');
  document.getElementById('prModal').classList.add('open');
}

function closePRModal() {
  document.getElementById('prModal').classList.remove('open');
  document.getElementById('f_pr').disabled = false;
  editingPR = null;
}

function clearPRForm() {
  ['f_pr','f_raised','f_firstResponse','f_approved','f_merged','f_devSprint','f_testSprint','f_deps'].forEach(id=>{ document.getElementById(id).value=''; });
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
  pages.forEach(p => {
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
    PR:pr, Type:document.getElementById('f_type').value,
    Module:document.getElementById('f_module').value||null,
    Developer:document.getElementById('f_developer').value||null,
    Page:[...document.getElementById('f_pages').querySelectorAll('.page-chip.selected')].map(c=>c.dataset.value),
    Status:document.getElementById('f_status').value||null,
    Reviewer:document.getElementById('f_reviewer').value||null,
    'PR Raised Date':document.getElementById('f_raised').value||null,
    'PR First Response Date':document.getElementById('f_firstResponse').value||null,
    'PR Approved Date':document.getElementById('f_approved').value||null,
    'PR Merged Date':document.getElementById('f_merged').value||null,
    Dev_Sprint:document.getElementById('f_devSprint').value||null,
    Testing_Sprint:document.getElementById('f_testSprint').value||null,
    Target_Release:document.getElementById('f_target').value||null,
    Dependent_PRs:document.getElementById('f_deps').value.split(',').map(s=>s.trim()).filter(Boolean).map(Number),
  };
  const isEdit = !!editingPR;
  const res = await fetch(`${API}/prs${isEdit?'/'+editingPR:''}`, { method:isEdit?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast(isEdit?`PR #${pr} updated`:`PR #${pr} created`,'success');
  closePRModal();
  renderPRs();
  if (document.getElementById('section-modules').classList.contains('active')) renderModulePages();
}

async function deletePR(prNumber) {
  if (!confirm(`Delete PR #${prNumber}?`)) return;
  const res = await fetch(`${API}/prs/${prNumber}`,{method:'DELETE'});
  const json = await res.json();
  if (!res.ok) return showToast(json.error,'error');
  showToast(`PR #${prNumber} deleted`,'success');
  renderPRs();
}
