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
  if (active === 'projects') renderProjectsTab();
  else                       renderUsersTab();
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
  if (tab === 'projects') renderProjectsTab();
  else                    renderUsersTab();
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
  const isActive = project.active !== false;
  const canAdmin = isAdmin() || isCompanyAdmin();
  return `
    <div class="project-admin-card">
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
        <button class="btn btn-ghost btn-sm" onclick="openProjectMembersModal('${project.id}')">👥 Members</button>
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
  renderProjectsTab();
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
  showToast(`Project updated`, 'success');
  renderProjectsTab();
}

// ── Delete project ──────────────────────────────────────
async function confirmDeleteProject(projectId) {
  const project = _projMap[projectId];
  if (!project) return;
  if (!confirm(`Delete project "${project.name}"?\n\nThis will NOT delete the project's data in DynamoDB but will remove the project record. This cannot be undone.`)) return;

  const res  = await authFetch(`${API}/projects/${projectId}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok) { showToast(json.error, 'error'); return; }
  showToast(`Project "${project.name}" deleted`, 'success');
  renderProjectsTab();
}

// ── Project Members modal ──────────────────────────────
let _membersProjectId = null;

async function openProjectMembersModal(projectId) {
  _membersProjectId = projectId;
  const project = _projMap[projectId];
  document.getElementById('projMembTitle').textContent = `Members — ${project?.name || ''}`;
  document.getElementById('projMembError').textContent = '';

  // Populate add-user dropdown with company users who don't already have full company access
  await _refreshProjectMembersModal(projectId);
  document.getElementById('projectMembersModal').classList.add('open');
}

async function _refreshProjectMembersModal(projectId) {
  const [membersRes, usersRes] = await Promise.all([
    authFetch(`${API}/projects/${projectId}/members`).then(r => r?.ok ? r.json() : []),
    authFetch(`${API}/users`).then(r => r?.ok ? r.json() : []),
  ]);

  // Render current members
  const membEl = document.getElementById('projMembList');
  if (!membersRes.length) {
    membEl.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 0">No members yet. Add someone below.</div>';
  } else {
    membEl.innerHTML = membersRes.map(m => {
      const isCompanyLevel = m.company_role === 'CompanyAdmin' || m.company_role === 'CompanyReadOnly';
      return `
        <div class="proj-member-row">
          <div class="proj-member-info">
            <span class="proj-member-name">${m.name || m.email}</span>
            <span class="proj-member-email">${m.email}</span>
          </div>
          ${isCompanyLevel
            ? `<span class="badge badge-orange" style="font-size:11px">${m.company_role}</span>`
            : `<select class="proj-member-role-sel" onchange="updateProjectMemberRole('${m.email}',this.value)">
                 <option value="ReadOnly"  ${m.role === 'ReadOnly'  ? 'selected' : ''}>ReadOnly</option>
                 <option value="ReadWrite" ${m.role === 'ReadWrite' ? 'selected' : ''}>ReadWrite</option>
                 <option value="Admin"     ${m.role === 'Admin'     ? 'selected' : ''}>Admin</option>
               </select>`}
          ${!isCompanyLevel
            ? `<button class="btn btn-danger btn-sm" onclick="removeProjectMember('${m.email}')">✕</button>`
            : ''}
        </div>`;
    }).join('');
  }

  // Populate the add-member dropdown with users not already in the project at project level
  const memberEmails  = new Set(membersRes.filter(m => !m.company_role).map(m => m.email));
  const addSel = document.getElementById('pmAddEmail');
  addSel.innerHTML = '<option value="">— select user —</option>';
  usersRes
    .filter(u => u.active && !memberEmails.has(u.email) && !u.company_role)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(u => addSel.add(new Option(`${u.name} (${u.email})`, u.email)));
}

async function updateProjectMemberRole(email, role) {
  const res = await authFetch(`${API}/projects/${_membersProjectId}/members`, {
    method: 'POST',
    body:   JSON.stringify({ email, role }),
  });
  if (!res.ok) {
    const json = await res.json();
    showToast(json.error || 'Failed to update role', 'error');
    await _refreshProjectMembersModal(_membersProjectId);
  }
}

async function removeProjectMember(email) {
  const res = await authFetch(
    `${API}/projects/${_membersProjectId}/members/${encodeURIComponent(email)}`,
    { method: 'DELETE' }
  );
  const json = await res.json();
  if (!res.ok) { showToast(json.error, 'error'); return; }
  showToast(`${email} removed from project`, 'success');
  await _refreshProjectMembersModal(_membersProjectId);
}

async function addProjectMember() {
  const email = document.getElementById('pmAddEmail').value;
  const role  = document.getElementById('pmAddRole').value;
  const errEl = document.getElementById('projMembError');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Select a user to add'; return; }

  const res  = await authFetch(`${API}/projects/${_membersProjectId}/members`, {
    method: 'POST',
    body:   JSON.stringify({ email, role }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  showToast(`${email} added to project`, 'success');
  await _refreshProjectMembersModal(_membersProjectId);
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
    return;
  }

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
