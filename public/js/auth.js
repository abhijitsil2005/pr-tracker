// ═══════════════════════════════════════════════════════
// AUTH  — login · logout · project selection · roles
// ═══════════════════════════════════════════════════════
let currentUser   = null;   // decoded JWT payload (set after select-project)
let loginProjects = [];     // projects returned by login (before selection)

function getToken()  { return localStorage.getItem('authToken'); }
function setToken(t) { localStorage.setItem('authToken', t); }
function clearToken(){ localStorage.removeItem('authToken'); }

// ── Role helpers ────────────────────────────────────────
function canWrite() {
  return currentUser && (currentUser.role === 'Admin' || currentUser.role === 'ReadWrite');
}
function isAdmin() {
  return currentUser?.role === 'Admin';
}
function isCompanyAdmin() {
  return currentUser?.company_role === 'CompanyAdmin';
}

// ── Authenticated fetch ─────────────────────────────────
async function authFetch(url, opts = {}) {
  const token = getToken();
  opts.headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, opts);
  if (res.status === 401) {
    currentUser = null;
    clearToken();
    showLoginScreen();
    return res;
  }
  return res;
}

// ── Login screen ────────────────────────────────────────
function showLoginScreen() {
  document.getElementById('loginOverlay').classList.add('open');
  document.getElementById('projectSelectorOverlay').classList.remove('open');
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginEmail').value     = '';
  document.getElementById('loginPassword').value  = '';
  document.getElementById('loginError').textContent = '';
}

function hideLoginScreen() {
  document.getElementById('loginOverlay').classList.remove('open');
}

async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Email and password required'; return; }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in…';

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) { errEl.textContent = json.error || 'Login failed'; return; }

    setToken(json.token);
    loginProjects = json.projects || [];
    hideLoginScreen();

    if (loginProjects.length === 0) {
      errEl.textContent = 'You have no projects assigned. Contact your company admin.';
      clearToken();
      showLoginScreen();
    } else if (loginProjects.length === 1) {
      await selectProject(loginProjects[0].id);
    } else {
      showProjectSelector(loginProjects);
    }
  } catch (e) {
    errEl.textContent = 'Network error — is the server running?';
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}

document.getElementById('loginPassword')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

function doLogout() {
  clearToken();
  currentUser   = null;
  loginProjects = [];
  showLoginScreen();
}

// ── Project Selector ────────────────────────────────────
function showProjectSelector(projects) {
  const list = document.getElementById('projectList');
  list.innerHTML = '';
  projects.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'project-card';
    btn.innerHTML = `
      <div class="project-card-name">${p.name}</div>
      ${p.description ? `<div class="project-card-desc">${p.description}</div>` : ''}
      <span class="badge ${roleBadgeClass(p.role)}" style="margin-top:6px">${p.role}</span>`;
    btn.onclick = () => selectProject(p.id);
    list.appendChild(btn);
  });
  document.getElementById('projectSelectorOverlay').classList.add('open');
}

function hideProjectSelector() {
  document.getElementById('projectSelectorOverlay').classList.remove('open');
}

async function selectProject(projectId) {
  try {
    const res  = await authFetch('/api/auth/select-project', {
      method: 'POST',
      body:   JSON.stringify({ project_id: projectId }),
    });
    const json = await res.json();
    if (!res.ok) { showToast(json.error || 'Failed to select project', 'error'); return; }

    setToken(json.token);
    currentUser = decodeToken(json.token);
    hideProjectSelector();
    document.getElementById('appShell').style.display = 'flex';
    applyRoleUI();
    init();
  } catch (e) {
    showToast('Network error selecting project', 'error');
  }
}

async function switchProject() {
  try {
    const res      = await authFetch('/api/projects');
    if (!res.ok) { doLogout(); return; }
    const projects = await res.json();
    if (!projects.length) { showToast('No projects available', 'error'); return; }

    const roleFor = (p) =>
      currentUser?.company_role === 'CompanyAdmin'    ? 'Admin'    :
      currentUser?.company_role === 'CompanyReadOnly' ? 'ReadOnly' : 'ReadWrite';

    document.getElementById('appShell').style.display = 'none';
    showProjectSelector(projects.map(p => ({
      id: p.id, name: p.name, description: p.description || '', role: roleFor(p),
    })));
  } catch (e) {
    showToast('Failed to load projects', 'error');
  }
}

// ── Token helpers ───────────────────────────────────────
function decodeToken(token) {
  try { return JSON.parse(atob(token.split('.')[1])); }
  catch { return null; }
}

function roleBadgeClass(role) {
  if (role === 'Admin')     return 'badge-purple';
  if (role === 'ReadWrite') return 'badge-blue';
  return 'badge-gray';
}

// ── Role-based UI ───────────────────────────────────────
function applyRoleUI() {
  const body = document.body;
  body.classList.remove('role-admin','role-readwrite','role-readonly','role-companyadmin','role-companyreadonly');
  if (!currentUser) return;

  body.classList.add(`role-${(currentUser.role || '').toLowerCase().replace(/\s/g,'')}`);
  if (currentUser.company_role) {
    body.classList.add(`role-${currentUser.company_role.toLowerCase()}`);
  }

  const el = document.getElementById('headerUser');
  if (el) {
    const initials = (currentUser.name || 'U')
      .split(' ').filter(Boolean)
      .map(w => w[0].toUpperCase())
      .slice(0, 2).join('');
    const firstName = (currentUser.name || '').split(' ')[0];
    const roleCls   = roleBadgeClass(currentUser.role);

    el.innerHTML = `
      ${currentUser.project_name ? `
      <button class="project-pill" onclick="switchProject()" title="Switch project">
        <span class="pp-dot"></span>
        <span class="pp-name">${currentUser.project_name}</span>
        <span class="pp-switch">⇄</span>
      </button>` : ''}
      <div class="user-menu" id="userMenu">
        <button class="user-avatar" onclick="toggleUserMenu()" aria-haspopup="true" aria-expanded="false">
          <span class="ua-initials">${initials}</span>
          <span class="ua-name">${firstName}</span>
          <span class="ua-chevron">▾</span>
        </button>
        <div class="user-dropdown" id="userDropdown">
          <div class="ud-profile">
            <div class="ud-avatar-lg">${initials}</div>
            <div class="ud-info">
              <div class="ud-name">${currentUser.name}</div>
              <div class="ud-email">${currentUser.email || ''}</div>
              <div class="ud-badges">
                ${currentUser.role        ? `<span class="badge ${roleCls} ud-badge">${currentUser.role}</span>` : ''}
                ${currentUser.company_role? `<span class="badge badge-orange ud-badge">${currentUser.company_role}</span>` : ''}
              </div>
            </div>
          </div>
          <div class="ud-divider"></div>
          <button class="ud-item" onclick="switchProject();closeUserMenu()">
            <span class="ud-item-icon">⇄</span>Switch Project
          </button>
          <div class="ud-divider"></div>
          <button class="ud-item" onclick="openChangePassword();closeUserMenu()">
            <span class="ud-item-icon">🔑</span>Change Password
          </button>
          <button class="ud-item ud-item-danger" onclick="doLogout()">
            <span class="ud-item-icon">↩</span>Sign Out
          </button>
        </div>
      </div>`;
  }

  // Show Admin nav only for admins
  const navAdminLi = document.getElementById('navAdminLi');
  if (navAdminLi) navAdminLi.style.display = (isAdmin() || isCompanyAdmin()) ? '' : 'none';
}

// ── User menu dropdown ──────────────────────────────────
function toggleUserMenu() {
  const dd  = document.getElementById('userDropdown');
  const btn = document.querySelector('#userMenu .user-avatar');
  if (!dd) return;
  const open = dd.classList.toggle('open');
  if (btn) btn.setAttribute('aria-expanded', String(open));
}

function closeUserMenu() {
  const dd  = document.getElementById('userDropdown');
  const btn = document.querySelector('#userMenu .user-avatar');
  if (dd)  dd.classList.remove('open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

document.addEventListener('click', e => {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) closeUserMenu();
});

// ── Change password ─────────────────────────────────────
function openChangePassword() {
  ['cpCurrent','cpNew','cpConfirm'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('cpError').textContent = '';
  document.getElementById('changePasswordModal').classList.add('open');
}

async function submitChangePassword() {
  const current = document.getElementById('cpCurrent').value;
  const nw      = document.getElementById('cpNew').value;
  const confirm = document.getElementById('cpConfirm').value;
  const errEl   = document.getElementById('cpError');
  errEl.textContent = '';
  if (!current || !nw || !confirm) { errEl.textContent = 'All fields required'; return; }
  if (nw !== confirm)  { errEl.textContent = 'New passwords do not match'; return; }
  if (nw.length < 6)   { errEl.textContent = 'Password must be at least 6 characters'; return; }

  const res  = await authFetch('/api/auth/change-password', {
    method: 'POST',
    body:   JSON.stringify({ current_password: current, new_password: nw }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('changePasswordModal');
  showToast('Password changed successfully', 'success');
}

// ── Bootstrap ───────────────────────────────────────────
(async function bootstrap() {
  const token = getToken();
  if (!token) { showLoginScreen(); return; }

  try {
    const payload = decodeToken(token);
    if (!payload) { clearToken(); showLoginScreen(); return; }

    if (!payload.project_id) {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { clearToken(); showLoginScreen(); return; }

      const projRes  = await fetch('/api/projects', { headers: { Authorization: `Bearer ${token}` } });
      if (!projRes.ok) { clearToken(); showLoginScreen(); return; }
      const projects = await projRes.json();

      if (projects.length === 0) {
        clearToken(); showLoginScreen();
      } else if (projects.length === 1) {
        await selectProject(projects[0].id);
      } else {
        showProjectSelector(projects.map(p => ({
          id: p.id, name: p.name, description: p.description || '',
          role: payload.company_role === 'CompanyAdmin' ? 'Admin' : 'ReadWrite',
        })));
      }
      return;
    }

    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { clearToken(); showLoginScreen(); return; }

    currentUser = payload;
    document.getElementById('appShell').style.display = 'flex';
    applyRoleUI();
    init();
  } catch {
    showLoginScreen();
  }
})();
