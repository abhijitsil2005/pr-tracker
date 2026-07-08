// ═══════════════════════════════════════════════════════
// ADMIN PAGE  — Projects + Users
// ═══════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────
let adminProjects = [];   // all company projects
let adminUsers    = [];   // all company users
const _projMap    = {};   // id → project (for modal lookups)
let _companyData  = null; // current company object

// ── Entry point (called by showSection) ────────────────
async function renderAdminPage() {
  _loadAdminCompanyName();
  const active = document.querySelector('.admin-tab.active')?.dataset.tab || 'projects';
  await Promise.all([_fetchProjects(), _fetchUsers()]);
  if (active === 'projects')        renderProjectsTab();
  else if (active === 'users')      renderUsersTab();
  else if (active === 'exclusions') renderExclusionsTab();
}

async function _fetchProjects() {
  const res = await authFetch(`${API}/projects`);
  adminProjects = res?.ok ? (await res.json()) : [];
  adminProjects.forEach(p => (_projMap[p.id] = p));
}

async function _fetchUsers() {
  const res = await authFetch(`${API}/users`);
  adminUsers = res?.ok ? (await res.json()) : [];
}

async function _loadAdminCompanyName() {
  const res = await authFetch(`${API}/companies/my`);
  if (res?.ok) {
    _companyData = await res.json();
    _renderCompanyBar();
  }
}

function _renderCompanyBar() {
  const bar = document.getElementById('adminCompanyBar');
  if (!bar || !_companyData) return;
  const canEdit = isCompanyAdmin();
  bar.innerHTML = `
    <span class="admin-company-label">Company</span>
    <span class="admin-company-name">${_companyData.name || ''}</span>
    ${canEdit ? `<button class="co-edit-btn" onclick="editCompanyName()" title="Edit company name">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    </button>` : ''}`;
}

function editCompanyName() {
  const bar = document.getElementById('adminCompanyBar');
  if (!bar || !_companyData) return;
  bar.innerHTML = `
    <span class="admin-company-label">Company</span>
    <input id="coNameInput" class="co-name-input" value="${_companyData.name || ''}" placeholder="Company name" />
    <button class="btn btn-primary btn-sm" onclick="saveCompanyName()">Save</button>
    <button class="btn btn-ghost btn-sm" onclick="_renderCompanyBar()">Cancel</button>`;
  const inp = document.getElementById('coNameInput');
  inp.focus();
  inp.select();
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  saveCompanyName();
    if (e.key === 'Escape') _renderCompanyBar();
  });
}

async function saveCompanyName() {
  const inp  = document.getElementById('coNameInput');
  const name = inp?.value.trim();
  if (!name) { showToast('Company name cannot be empty', 'error'); return; }
  const res  = await authFetch(`${API}/companies/my`, {
    method: 'PUT',
    body:   JSON.stringify({ name }),
  });
  const json = await res.json();
  if (!res.ok) { showToast(json.error || 'Failed to update', 'error'); return; }
  _companyData.name = name;
  _renderCompanyBar();
  showToast('Company name updated', 'success');
}

// ── Tab switching ──────────────────────────────────────
function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.admin-panel').forEach(p => {
    p.style.display = p.dataset.panel === tab ? '' : 'none';
  });
  if (tab === 'projects')        renderProjectsTab();
  else if (tab === 'users')      renderUsersTab();
  else if (tab === 'exclusions') renderExclusionsTab();
}

// ══════════════════════════════════════════════════════
// PROJECTS TAB
// ══════════════════════════════════════════════════════

async function renderProjectsTab() {
  await _fetchProjects();
  const grid = document.getElementById('projectsGrid');
  if (!grid) return;

  if (!adminProjects.length) {
    grid.innerHTML = '<div class="empty-state">No projects yet. Create one to get started.</div>';
    return;
  }

  // Fetch member counts per project in parallel
  const memberCountResults = await Promise.all(
    adminProjects.map(p =>
      authFetch(`${API}/projects/${p.id}/members`)
        .then(r => r?.ok ? r.json() : [])
        .then(members => ({ id: p.id, count: members.length }))
        .catch(() => ({ id: p.id, count: 0 }))
    )
  );
  const countMap = Object.fromEntries(memberCountResults.map(r => [r.id, r.count]));

  grid.innerHTML = adminProjects.map(p => buildProjectCard(p, countMap[p.id] ?? 0)).join('');
}

function buildProjectCard(project, memberCount) {
  const isActive  = project.active !== false;
  const canAdmin  = isAdmin() || isCompanyAdmin();
  const isSetup   = project.id === _setupProjectId;
  return `
    <div class="project-admin-card${isSetup ? ' setup-selected' : ''}" data-project-id="${project.id}">
      <div class="project-admin-card-top">
        <div style="flex:1;min-width:0">
          <div class="project-admin-card-name">${project.name}</div>
          ${project.description ? `<div class="project-admin-card-desc">${project.description}</div>` : ''}
        </div>
        <span class="badge ${isActive ? 'badge-green' : 'badge-red'}" style="flex-shrink:0">${isActive ? 'Active' : 'Inactive'}</span>
      </div>
      <div class="project-admin-card-meta">
        <span>👥 <strong>${memberCount}</strong> member${memberCount !== 1 ? 's' : ''}</span>
      </div>
      ${canAdmin ? `
      <div class="project-admin-card-actions">
        <button class="btn btn-ghost btn-sm" onclick="openEditProjectModal('${project.id}')">✏️ Edit</button>
        <button class="btn btn-primary btn-sm" onclick="selectSetupProject('${project.id}')">⚙ Set Up</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteProject('${project.id}')">🗑 Delete</button>
      </div>` : ''}
    </div>`;
}

// ── Add project ─────────────────────────────────────────
function openAddProjectModal() {
  document.getElementById('pmName').value        = '';
  document.getElementById('pmDescription').value = '';
  document.getElementById('pmError').textContent = '';
  document.getElementById('projectModalTitle').textContent = 'Add Project';
  document.getElementById('pmSaveBtn').onclick = saveNewProject;
  document.getElementById('projectModal').classList.add('open');
}

async function saveNewProject() {
  const name        = document.getElementById('pmName').value.trim();
  const description = document.getElementById('pmDescription').value.trim();
  const errEl       = document.getElementById('pmError');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Project name is required'; return; }

  const res  = await authFetch(`${API}/projects`, {
    method: 'POST',
    body:   JSON.stringify({ name, description }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('projectModal');
  showToast(`Project "${name}" created`, 'success');
  await renderProjectsTab();
  selectSetupProject(json.data.id);
}

// ── Edit project ────────────────────────────────────────
function openEditProjectModal(projectId) {
  const project = _projMap[projectId];
  if (!project) return;
  document.getElementById('pmName').value        = project.name;
  document.getElementById('pmDescription').value = project.description || '';
  document.getElementById('pmError').textContent = '';
  document.getElementById('projectModalTitle').textContent = 'Edit Project';
  document.getElementById('pmSaveBtn').onclick = () => saveEditProject(projectId);
  document.getElementById('projectModal').classList.add('open');
}

async function saveEditProject(projectId) {
  const name        = document.getElementById('pmName').value.trim();
  const description = document.getElementById('pmDescription').value.trim();
  const errEl       = document.getElementById('pmError');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Project name is required'; return; }

  const res  = await authFetch(`${API}/projects/${projectId}`, {
    method: 'PUT',
    body:   JSON.stringify({ name, description }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('projectModal');
  showToast('Project updated', 'success');
  await renderProjectsTab();
  // Keep the setup area title in sync if this project is selected
  if (_setupProjectId === projectId) {
    const nameEl = document.getElementById('setupAreaProjectName');
    if (nameEl) nameEl.textContent = _projMap[projectId]?.name || '';
  }
}

// ── Delete project ──────────────────────────────────────
async function confirmDeleteProject(projectId) {
  const project = _projMap[projectId];
  if (!project) return;
  if (!confirm(`Delete project "${project.name}"?\n\nThis will remove the project record but will NOT delete the project's PR and release data. This cannot be undone.`)) return;

  const res  = await authFetch(`${API}/projects/${projectId}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok) { showToast(json.error, 'error'); return; }
  showToast(`Project "${project.name}" deleted`, 'success');
  if (_setupProjectId === projectId) closeProjectSetup();
  renderProjectsTab();
}

// ── Select project for setup (inline below grid) ───────
async function selectSetupProject(projectId) {
  _setupProjectId = projectId;
  document.querySelectorAll('.project-admin-card').forEach(card => {
    card.classList.toggle('setup-selected', card.dataset.projectId === projectId);
  });
  const project = _projMap[projectId];
  document.getElementById('setupAreaProjectName').textContent = project?.name || '';
  const area = document.getElementById('projectSetupArea');
  area.style.display = '';
  area.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  ['setupReleaseError','setupSprintError','setupAccessError']
    .forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  await _setupLoadAll(projectId);
}

function closeProjectSetup() {
  _setupProjectId = null;
  document.getElementById('projectSetupArea').style.display = 'none';
  document.querySelectorAll('.project-admin-card.setup-selected').forEach(c => c.classList.remove('setup-selected'));
}

// ══════════════════════════════════════════════════════
// USERS TAB
// ══════════════════════════════════════════════════════

async function renderUsersTab() {
  await _fetchUsers();
  await _fetchProjects();

  const tbody = document.querySelector('#userTable tbody');
  if (!tbody) return;

  if (!adminUsers.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:32px">No users found</td></tr>';
  } else {
    tbody.innerHTML = adminUsers.sort((a, b) => a.email.localeCompare(b.email)).map(u => {
      const companyRoleBadge = u.company_role
        ? `<span class="badge ${u.company_role === 'CompanyAdmin' ? 'badge-purple' : 'badge-orange'}">${u.company_role}</span>`
        : '<span class="badge badge-gray">—</span>';

      const projectBadges = (u.project_memberships || []).map(m => {
        const proj = adminProjects.find(p => p.id === m.project_id);
        const label = proj ? proj.name : m.project_id.slice(0, 8) + '…';
        const cls   = m.role === 'Admin' ? 'badge-purple' : m.role === 'ReadWrite' ? 'badge-blue' : 'badge-gray';
        return `<span class="badge ${cls}" style="font-size:10px">${label}: ${m.role}</span>`;
      }).join(' ') || '<span style="color:var(--text2);font-size:12px">No project access</span>';

      const isSelf = u.email === currentUser?.email;
      return `<tr>
        <td>${u.email}</td>
        <td>${u.name}</td>
        <td>${companyRoleBadge}</td>
        <td style="max-width:260px;overflow:hidden">${projectBadges}</td>
        <td><span class="badge ${u.active ? 'badge-green' : 'badge-red'}">${u.active ? 'Active' : 'Inactive'}</span></td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="openEditUserModal('${u.email}','${escAttr(u.name)}','${u.company_role || ''}',${u.active})">✏️ Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="openManageProjectsModal('${u.email}')">🔑 Projects</button>
          <button class="btn btn-ghost btn-sm" onclick="toggleUserActive('${u.email}',${u.active})">${u.active ? 'Deactivate' : 'Activate'}</button>
          ${!isSelf ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.email}')">🗑</button>` : ''}
        </td>
      </tr>`;
    }).join('');
  }

  // Populate the project selector for the team members section
  const sel = document.getElementById('teamProjectSel');
  if (sel) {
    sel.innerHTML = '<option value="">— select a project —</option>';
    adminProjects.forEach(p => sel.add(new Option(p.name, p.id)));
    if (_teamMgmtProjectId && adminProjects.find(p => p.id === _teamMgmtProjectId)) {
      sel.value = _teamMgmtProjectId;
      document.getElementById('teamMembersArea').style.display = '';
    }
  }
}

// ── Team project selector ───────────────────────────────
async function onTeamProjectChanged(projectId) {
  _teamMgmtProjectId = projectId || null;
  const area  = document.getElementById('teamMembersArea');
  const badge = document.getElementById('teamBadge');
  if (!area) return;
  if (!_teamMgmtProjectId) {
    area.style.display = 'none';
    if (badge) badge.textContent = '0';
    return;
  }
  area.style.display = '';
  const errEl = document.getElementById('setupTeamError');
  if (errEl) errEl.textContent = '';
  const data = await authFetch(`${API}/onboard/${_teamMgmtProjectId}/team`).then(r => r?.ok ? r.json() : []);
  _setupRenderTeam(Array.isArray(data) ? data : []);
}

// ── Add user ────────────────────────────────────────────
function openAddUserModal() {
  ['umEmail','umName','umPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('umCompanyRole').value = '';
  document.getElementById('umError').textContent = '';
  document.getElementById('umModalTitle').textContent = 'Add User';
  document.getElementById('umEmailRow').style.display = '';
  const pwRow = document.getElementById('umPasswordRow');
  pwRow.style.display = '';
  pwRow.querySelector('label').textContent = 'Password *';
  document.getElementById('umSaveBtn').onclick = saveNewUser;
  document.getElementById('userModal').classList.add('open');
}

async function saveNewUser() {
  const email       = document.getElementById('umEmail').value.trim();
  const name        = document.getElementById('umName').value.trim();
  const companyRole = document.getElementById('umCompanyRole').value || null;
  const password    = document.getElementById('umPassword').value;
  const errEl       = document.getElementById('umError');
  errEl.textContent = '';
  if (!email || !name || !password) { errEl.textContent = 'Email, name and password are required'; return; }

  const res  = await authFetch(`${API}/users`, {
    method: 'POST',
    body:   JSON.stringify({ email, name, company_role: companyRole, password }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('userModal');
  showToast(`User ${email} created`, 'success');
  renderUsersTab();
}

// ── Edit user ───────────────────────────────────────────
function openEditUserModal(email, name, companyRole, active) {
  document.getElementById('umEmail').value        = email;
  document.getElementById('umName').value         = name;
  document.getElementById('umCompanyRole').value  = companyRole || '';
  document.getElementById('umPassword').value     = '';
  document.getElementById('umError').textContent  = '';
  document.getElementById('umModalTitle').textContent = 'Edit User';
  document.getElementById('umEmailRow').style.display = 'none';
  const pwRow = document.getElementById('umPasswordRow');
  pwRow.style.display = '';
  pwRow.querySelector('label').textContent = 'New Password (leave blank to keep)';
  document.getElementById('umSaveBtn').onclick = () => saveEditUser(email);
  document.getElementById('userModal').classList.add('open');
}

async function saveEditUser(email) {
  const name        = document.getElementById('umName').value.trim();
  const companyRole = document.getElementById('umCompanyRole').value || null;
  const password    = document.getElementById('umPassword').value;
  const errEl       = document.getElementById('umError');
  errEl.textContent = '';

  const body = { name, company_role: companyRole };
  if (password) body.password = password;

  const res  = await authFetch(`${API}/users/${encodeURIComponent(email)}`, {
    method: 'PUT',
    body:   JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('userModal');
  showToast(`User ${email} updated`, 'success');
  renderUsersTab();
}

async function toggleUserActive(email, currentlyActive) {
  const res  = await authFetch(`${API}/users/${encodeURIComponent(email)}`, {
    method: 'PUT',
    body:   JSON.stringify({ active: !currentlyActive }),
  });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`${email} ${!currentlyActive ? 'activated' : 'deactivated'}`, 'success');
  renderUsersTab();
}

async function deleteUser(email) {
  if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
  const res  = await authFetch(`${API}/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`User ${email} deleted`, 'success');
  renderUsersTab();
}

// ── Manage project access for a user ───────────────────
let _managingEmail = null;

async function openManageProjectsModal(email) {
  _managingEmail = email;
  document.getElementById('manageProjectsEmail').textContent = email;
  document.getElementById('mpError').textContent = '';

  await _fetchProjects();

  const usersRes = await authFetch(`${API}/users`);
  const users    = usersRes?.ok ? await usersRes.json() : [];
  const user     = users.find(u => u.email === email);
  const memberships = user?.project_memberships || [];

  const list = document.getElementById('projectMembershipList');
  if (!adminProjects.length) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px">No projects in this company.</div>';
  } else {
    list.innerHTML = adminProjects.map(p => {
      const existing = memberships.find(m => m.project_id === p.id);
      return `
        <div class="form-group" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span style="flex:1;font-size:13px">${p.name}</span>
          <select id="pmRole_${p.id}" style="width:150px">
            <option value="">No Access</option>
            <option value="ReadOnly"  ${existing?.role === 'ReadOnly'  ? 'selected' : ''}>ReadOnly</option>
            <option value="ReadWrite" ${existing?.role === 'ReadWrite' ? 'selected' : ''}>ReadWrite</option>
            <option value="Admin"     ${existing?.role === 'Admin'     ? 'selected' : ''}>Admin</option>
          </select>
        </div>`;
    }).join('');
  }

  document.getElementById('manageProjectsModal').classList.add('open');
}

async function saveProjectMemberships() {
  if (!_managingEmail) return;
  const errEl = document.getElementById('mpError');
  errEl.textContent = '';

  const memberships = adminProjects.map(p => {
    const role = document.getElementById(`pmRole_${p.id}`)?.value;
    return role ? { project_id: p.id, role } : null;
  }).filter(Boolean);

  const res  = await authFetch(`${API}/users/${encodeURIComponent(_managingEmail)}`, {
    method: 'PUT',
    body:   JSON.stringify({ project_memberships: memberships }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('manageProjectsModal');
  showToast('Project access updated', 'success');
  renderUsersTab();
}

// ══════════════════════════════════════════════════════
// EXCLUSIONS TAB
// ══════════════════════════════════════════════════════

let _exclPages   = [];  // page names excluded from page-count stats
let _exclModules = [];  // module names excluded from all stats (PRs + pages)

async function renderExclusionsTab() {
  const panel = document.getElementById('exclusionsPanel');
  if (!panel) return;
  panel.innerHTML = `<div style="color:var(--text2);font-size:13px;padding:32px;text-align:center">Loading…</div>`;

  const proj = currentUser?.project_id ? await api(`projects/${currentUser.project_id}`) : null;
  _exclPages   = [...(proj?.excluded_pages   ?? _DEFAULT_EXCL_PAGES)];
  _exclModules = [...(proj?.excluded_modules ?? _DEFAULT_EXCL_MODULES)];
  _renderExclusionsPanel();
}

function _renderExclusionsPanel() {
  const panel  = document.getElementById('exclusionsPanel');
  if (!panel) return;
  const canEdit = isAdmin() || isCompanyAdmin();

  panel.innerHTML = `
    <div class="excl-desc">
      Configure which pages and modules are skipped in all calculations — dashboard stats, module completion counts, and report charts.
    </div>
    <div class="excl-two-col">
      ${_exclGroup('pages',   'Excluded Pages',
        'Page names excluded from page-count and completion stats.',
        _exclPages, _DEFAULT_EXCL_PAGES, canEdit)}
      ${_exclGroup('modules', 'Excluded Modules',
        'Module names excluded from all stats including PR counts.',
        _exclModules, _DEFAULT_EXCL_MODULES, canEdit)}
    </div>`;
}

function _exclGroup(key, title, subtitle, list, defaults, canEdit) {
  const rows = list.map((item, i) => `
    <div class="excl-row">
      <span class="excl-name">${item}</span>
      ${canEdit ? `<button class="btn btn-danger btn-sm" onclick="_removeExclItem('${key}',${i})">✕</button>` : ''}
    </div>`).join('') ||
    `<div class="excl-empty">None configured — defaults apply: ${defaults.join(', ')}.</div>`;

  return `
    <div class="excl-group">
      <div class="excl-group-title">${title}</div>
      <div class="excl-group-sub">${subtitle}</div>
      <div class="excl-list">${rows}</div>
      ${canEdit ? `
      <div class="excl-add-row">
        <input id="exclInput_${key}" class="excl-input" placeholder="Add name…"
               onkeydown="if(event.key==='Enter')_addExclItem('${key}')" />
        <button class="btn btn-primary btn-sm" onclick="_addExclItem('${key}')">＋ Add</button>
      </div>
      <div id="exclError_${key}" class="excl-error"></div>` : ''}
    </div>`;
}

function _removeExclItem(key, index) {
  (key === 'pages' ? _exclPages : _exclModules).splice(index, 1);
  _renderExclusionsPanel();
  _saveExclusions();
}

function _addExclItem(key) {
  const list = key === 'pages' ? _exclPages : _exclModules;
  const inp  = document.getElementById(`exclInput_${key}`);
  const err  = document.getElementById(`exclError_${key}`);
  const name = inp?.value.trim();
  if (err) err.textContent = '';
  if (!name) { if (err) err.textContent = 'Enter a name'; return; }
  if (list.some(e => e.toLowerCase() === name.toLowerCase())) {
    if (err) err.textContent = `"${name}" is already in the list`;
    return;
  }
  list.push(name);
  if (inp) inp.value = '';
  _renderExclusionsPanel();
  _saveExclusions();
}

async function _saveExclusions() {
  if (!currentUser?.project_id) return;
  const res  = await authFetch(`${API}/projects/${currentUser.project_id}`, {
    method: 'PUT',
    body:   JSON.stringify({ excluded_pages: _exclPages, excluded_modules: _exclModules }),
  });
  const json = await res.json();
  if (!res.ok) { showToast(json.error || 'Failed to save', 'error'); return; }
  _applyProjectExclusions({ excluded_pages: _exclPages, excluded_modules: _exclModules });
  showToast('Exclusions saved', 'success');
}

// ══════════════════════════════════════════════════════
// PROJECT SETUP (inline in Projects tab)
// ══════════════════════════════════════════════════════

let _setupProjectId   = null;
let _teamMgmtProjectId = null;

async function _setupLoadAll(projectId) {
  const [sprintData, releaseData, memberData, usersData] = await Promise.all([
    authFetch(`${API}/onboard/${projectId}/sprints`).then(r => r?.ok ? r.json() : []),
    authFetch(`${API}/onboard/${projectId}/releases`).then(r => r?.ok ? r.json() : []),
    authFetch(`${API}/projects/${projectId}/members`).then(r => r?.ok ? r.json() : []),
    authFetch(`${API}/users`).then(r => r?.ok ? r.json() : []),
  ]);
  _setupRenderSprints(Array.isArray(sprintData) ? sprintData : []);
  _setupRenderReleases(Array.isArray(releaseData) ? releaseData : []);
  _setupRenderAccess(
    Array.isArray(memberData) ? memberData : [],
    Array.isArray(usersData)  ? usersData  : []
  );
}

// ── Team Members ───────────────────────────────────────
function _setupRenderTeam(members) {
  const list  = document.getElementById('setupTeamList');
  const badge = document.getElementById('teamBadge');
  if (!list) return;
  badge.textContent = members.length;

  if (!members.length) {
    list.innerHTML = '<div class="setup-empty">No team members yet. Add names below.</div>';
    return;
  }
  // Group by role for display
  const byRole = {};
  members.forEach(m => (byRole[m.role] = byRole[m.role] || []).push(m));
  list.innerHTML = Object.entries(byRole).map(([role, people]) =>
    `<div class="setup-role-group">
      <div class="setup-role-label">${role}</div>
      <div class="setup-role-members">
        ${people.map(m => `
          <div class="setup-member-chip">
            <span>${m.name}</span>
            <button class="setup-chip-del" onclick="removeSetupTeamMember('${escAttr(m.name)}')" title="Remove">✕</button>
          </div>`).join('')}
      </div>
    </div>`
  ).join('');
}

async function addSetupTeamMember() {
  const role  = document.getElementById('setupTeamRole').value;
  const name  = document.getElementById('setupTeamName').value.trim();
  const errEl = document.getElementById('setupTeamError');
  errEl.textContent = '';
  if (!name) { errEl.textContent = 'Enter a name'; return; }

  const res  = await authFetch(`${API}/onboard/${_teamMgmtProjectId}/team`, {
    method: 'POST',
    body:   JSON.stringify({ role, name }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  document.getElementById('setupTeamName').value = '';
  showToast(`${name} added to team`, 'success');
  const data = await authFetch(`${API}/onboard/${_teamMgmtProjectId}/team`).then(r => r.json());
  _setupRenderTeam(Array.isArray(data) ? data : []);
}

async function removeSetupTeamMember(name) {
  const res  = await authFetch(
    `${API}/onboard/${_teamMgmtProjectId}/team/${encodeURIComponent(name)}`,
    { method: 'DELETE' }
  );
  const json = await res.json();
  if (!res.ok) { showToast(json.error, 'error'); return; }
  showToast(`${name} removed`, 'success');
  const data = await authFetch(`${API}/onboard/${_teamMgmtProjectId}/team`).then(r => r.json());
  _setupRenderTeam(Array.isArray(data) ? data : []);
}

// ── Release Calendar ───────────────────────────────────
function _setupRenderReleases(releases) {
  const list   = document.getElementById('setupReleaseList');
  const header = document.getElementById('setupReleaseHeader');
  const badge  = document.getElementById('releaseBadge');
  if (!list) return;
  badge.textContent = releases.length;
  header.style.display = releases.length ? '' : 'none';

  if (!releases.length) {
    list.innerHTML = '<div class="setup-empty">No releases yet. Add the first release below.</div>';
    return;
  }
  list.innerHTML = releases.map(r => {
    const completed = r.Completed
      ? '<span class="badge badge-green" style="font-size:10px">Done</span>'
      : '<span class="badge badge-gray"  style="font-size:10px">Upcoming</span>';
    return `
      <div class="setup-rel-item">
        <span class="setup-rel-num">R${r.Release_Number}</span>
        <span>${r.Release_Date  || '—'}</span>
        <span>${r.Code_Freeze   || '—'}</span>
        <span>${r.Regression_Start || '—'}</span>
        <span>${completed}</span>
        <button class="btn btn-danger btn-sm" onclick="removeSetupRelease('${r.Release_Number}')">✕</button>
      </div>`;
  }).join('');
}

async function addSetupRelease() {
  const num        = document.getElementById('setupRelNum').value.trim();
  const date       = document.getElementById('setupRelDate').value;
  const freeze     = document.getElementById('setupRelFreeze').value;
  const regression = document.getElementById('setupRelRegression').value;
  const errEl      = document.getElementById('setupReleaseError');
  errEl.textContent = '';
  if (!num || !date) { errEl.textContent = 'Release number and date are required'; return; }

  const res  = await authFetch(`${API}/onboard/${_setupProjectId}/releases`, {
    method: 'POST',
    body:   JSON.stringify({
      Release_Number: num, Release_Date: date,
      Code_Freeze: freeze || null, Regression_Start: regression || null,
    }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  ['setupRelNum','setupRelDate','setupRelFreeze','setupRelRegression']
    .forEach(id => { document.getElementById(id).value = ''; });
  showToast(`Release ${num} added`, 'success');
  const data = await authFetch(`${API}/onboard/${_setupProjectId}/releases`).then(r => r.json());
  _setupRenderReleases(Array.isArray(data) ? data : []);
}

async function removeSetupRelease(number) {
  if (!confirm(`Remove release ${number} from this project?`)) return;
  const res  = await authFetch(
    `${API}/onboard/${_setupProjectId}/releases/${encodeURIComponent(number)}`,
    { method: 'DELETE' }
  );
  const json = await res.json();
  if (!res.ok) { showToast(json.error, 'error'); return; }
  showToast(`Release ${number} removed`, 'success');
  const data = await authFetch(`${API}/onboard/${_setupProjectId}/releases`).then(r => r.json());
  _setupRenderReleases(Array.isArray(data) ? data : []);
}

// ── Sprint Dates ───────────────────────────────────────
function _setupRenderSprints(sprints) {
  const list  = document.getElementById('setupSprintList');
  const badge = document.getElementById('sprintBadge');
  if (!list) return;
  badge.textContent = sprints.length;

  if (!sprints.length) {
    list.innerHTML = '<div class="setup-empty">No sprint date ranges yet.</div>';
    return;
  }
  list.innerHTML = sprints.map(s => `
    <div class="setup-list-row">
      <span class="setup-sprint-name">${s.Sprint}</span>
      <span class="setup-sprint-dates">${s.StartDate} → ${s.EndDate}</span>
      <button class="btn btn-danger btn-sm" onclick="removeSetupSprint('${escAttr(s.Sprint)}')">✕</button>
    </div>`).join('');
}

async function addSetupSprint() {
  const name  = document.getElementById('setupSprintName').value.trim();
  const start = document.getElementById('setupSprintStart').value;
  const end   = document.getElementById('setupSprintEnd').value;
  const errEl = document.getElementById('setupSprintError');
  errEl.textContent = '';
  if (!name || !start || !end) { errEl.textContent = 'Sprint name, start and end dates are required'; return; }
  if (start > end) { errEl.textContent = 'Start date must be before end date'; return; }

  const res  = await authFetch(`${API}/onboard/${_setupProjectId}/sprints`, {
    method: 'POST',
    body:   JSON.stringify({ sprint_name: name, start_date: start, end_date: end }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  ['setupSprintName','setupSprintStart','setupSprintEnd']
    .forEach(id => { document.getElementById(id).value = ''; });
  showToast(`Sprint ${name} added`, 'success');
  const data = await authFetch(`${API}/onboard/${_setupProjectId}/sprints`).then(r => r.json());
  _setupRenderSprints(Array.isArray(data) ? data : []);
}

async function removeSetupSprint(name) {
  const res  = await authFetch(
    `${API}/onboard/${_setupProjectId}/sprints/${encodeURIComponent(name)}`,
    { method: 'DELETE' }
  );
  const json = await res.json();
  if (!res.ok) { showToast(json.error, 'error'); return; }
  showToast(`Sprint ${name} removed`, 'success');
  const data = await authFetch(`${API}/onboard/${_setupProjectId}/sprints`).then(r => r.json());
  _setupRenderSprints(Array.isArray(data) ? data : []);
}

// ── User Access ────────────────────────────────────────
function _setupRenderAccess(members, allUsers) {
  const list  = document.getElementById('setupAccessList');
  const badge = document.getElementById('accessBadge');
  if (!list) return;
  badge.textContent = members.length;

  if (!members.length) {
    list.innerHTML = '<div class="setup-empty">No users assigned yet.</div>';
  } else {
    list.innerHTML = members.map(m => {
      const isCompany = !!m.company_role;
      return `
        <div class="setup-list-row">
          <div class="setup-access-info">
            <span class="setup-item-name">${m.name || m.email}</span>
            <span class="setup-email">${m.email}</span>
          </div>
          ${isCompany
            ? `<span class="badge badge-orange" style="font-size:11px">${m.company_role}</span>`
            : `<select class="proj-member-role-sel" onchange="updateSetupAccess('${escAttr(m.email)}',this.value)">
                 <option value="ReadOnly"  ${m.role === 'ReadOnly'  ? 'selected':''}>ReadOnly</option>
                 <option value="ReadWrite" ${m.role === 'ReadWrite' ? 'selected':''}>ReadWrite</option>
                 <option value="Admin"     ${m.role === 'Admin'     ? 'selected':''}>Admin</option>
               </select>
               <button class="btn btn-danger btn-sm" onclick="removeSetupAccess('${escAttr(m.email)}')">✕</button>`
          }
        </div>`;
    }).join('');
  }

  // Populate add-user dropdown (exclude already-added and company-level users)
  const memberEmails = new Set(members.filter(m => !m.company_role).map(m => m.email));
  const sel = document.getElementById('setupAccessEmail');
  sel.innerHTML = '<option value="">— select user to add —</option>';
  allUsers
    .filter(u => u.active && !memberEmails.has(u.email) && !u.company_role)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(u => sel.add(new Option(`${u.name} (${u.email})`, u.email)));
}

async function addSetupAccess() {
  const email = document.getElementById('setupAccessEmail').value;
  const role  = document.getElementById('setupAccessRole').value;
  const errEl = document.getElementById('setupAccessError');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Select a user'; return; }

  const res  = await authFetch(`${API}/projects/${_setupProjectId}/members`, {
    method: 'POST',
    body:   JSON.stringify({ email, role }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  showToast(`${email} added to project`, 'success');
  await _refreshSetupAccess();
}

async function updateSetupAccess(email, role) {
  const res = await authFetch(`${API}/projects/${_setupProjectId}/members`, {
    method: 'POST',
    body:   JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const json = await res.json();
    showToast(json.error || 'Failed to update role', 'error');
    await _refreshSetupAccess();
  }
}

async function removeSetupAccess(email) {
  const res  = await authFetch(
    `${API}/projects/${_setupProjectId}/members/${encodeURIComponent(email)}`,
    { method: 'DELETE' }
  );
  const json = await res.json();
  if (!res.ok) { showToast(json.error, 'error'); return; }
  showToast(`${email} removed from project`, 'success');
  await _refreshSetupAccess();
}

async function _refreshSetupAccess() {
  const [memberData, usersData] = await Promise.all([
    authFetch(`${API}/projects/${_setupProjectId}/members`).then(r => r?.ok ? r.json() : []),
    authFetch(`${API}/users`).then(r => r?.ok ? r.json() : []),
  ]);
  _setupRenderAccess(
    Array.isArray(memberData) ? memberData : [],
    Array.isArray(usersData)  ? usersData  : []
  );
}

