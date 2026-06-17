// ═══════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════
let currentUser = null;

function getToken()  { return localStorage.getItem('authToken'); }
function setToken(t) { localStorage.setItem('authToken', t); }
function clearToken(){ localStorage.removeItem('authToken'); }

function canWrite() {
  return currentUser && (currentUser.role === 'Admin' || currentUser.role === 'ReadWrite');
}
function isAdmin() {
  return currentUser && currentUser.role === 'Admin';
}

// Fetch wrapper that injects the Bearer token and handles 401
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
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginEmail').value    = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').textContent = '';
}

function hideLoginScreen() {
  document.getElementById('loginOverlay').classList.remove('open');
  document.getElementById('appShell').style.display = 'flex';
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
    currentUser = json.user;
    hideLoginScreen();
    applyRoleUI();
    init();
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
  currentUser = null;
  showLoginScreen();
}

// ── Role-based UI ───────────────────────────────────────
function applyRoleUI() {
  const body = document.body;
  body.classList.remove('role-admin', 'role-readwrite', 'role-readonly');
  if (!currentUser) return;
  body.classList.add(`role-${currentUser.role.toLowerCase().replace(/\s/g, '')}`);

  // Update user info in header
  const el = document.getElementById('headerUser');
  if (el) el.innerHTML = `
    <span style="color:var(--text2);font-size:13px">${currentUser.name}</span>
    <span class="badge badge-blue" style="font-size:10px">${currentUser.role}</span>
    <button class="btn btn-ghost btn-sm" onclick="openChangePassword()">🔑</button>
    <button class="btn btn-ghost btn-sm" onclick="doLogout()">Sign Out</button>`;

  // Show Users nav item only for Admin
  const usersNavLi = document.getElementById('navUsersLi');
  if (usersNavLi) usersNavLi.style.display = isAdmin() ? '' : 'none';
}

// ── Change password modal ───────────────────────────────
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
  if (nw !== confirm) { errEl.textContent = 'New passwords do not match'; return; }
  if (nw.length < 6)  { errEl.textContent = 'Password must be at least 6 characters'; return; }

  const res  = await authFetch('/api/auth/change-password', {
    method: 'POST',
    body:   JSON.stringify({ current_password: current, new_password: nw }),
  });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('changePasswordModal');
  showToast('Password changed successfully', 'success');
}

// ── User management ─────────────────────────────────────
async function renderUsers() {
  const res   = await authFetch('/api/users');
  const users = await res.json();
  const tbody = document.querySelector('#userTable tbody');
  if (!tbody) return;
  if (!Array.isArray(users) || !users.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:32px">No users found</td></tr>';
    return;
  }
  tbody.innerHTML = users.sort((a, b) => a.email.localeCompare(b.email)).map(u => `
    <tr>
      <td>${u.email}</td>
      <td>${u.name}</td>
      <td><span class="badge ${u.role==='Admin'?'badge-purple':u.role==='ReadWrite'?'badge-blue':'badge-gray'}">${u.role}</span></td>
      <td><span class="badge ${u.active?'badge-green':'badge-red'}">${u.active?'Active':'Inactive'}</span></td>
      <td style="white-space:nowrap">
        <button class="btn btn-ghost btn-sm" onclick="openEditUserModal('${u.email}','${u.name}','${u.role}',${u.active})">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="toggleUserActive('${u.email}',${u.active})">${u.active?'Deactivate':'Activate'}</button>
        ${u.email !== currentUser?.email ? `<button class="btn btn-danger btn-sm" onclick="deleteUser('${u.email}')">🗑</button>` : ''}
      </td>
    </tr>`).join('');
}

function openAddUserModal() {
  ['umEmail','umName','umPassword'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('umRole').value = 'ReadWrite';
  document.getElementById('umError').textContent = '';
  document.getElementById('umModalTitle').textContent = 'Add User';
  document.getElementById('umEmailRow').style.display = '';
  document.getElementById('umPasswordRow').style.display = '';
  document.getElementById('umSaveBtn').onclick = saveNewUser;
  document.getElementById('userModal').classList.add('open');
}

function openEditUserModal(email, name, role, active) {
  document.getElementById('umEmail').value = email;
  document.getElementById('umName').value  = name;
  document.getElementById('umRole').value  = role;
  document.getElementById('umPassword').value = '';
  document.getElementById('umError').textContent = '';
  document.getElementById('umModalTitle').textContent = 'Edit User';
  document.getElementById('umEmailRow').style.display = 'none';
  document.getElementById('umPasswordRow').querySelector('label').textContent = 'New Password (leave blank to keep)';
  document.getElementById('umSaveBtn').onclick = () => saveEditUser(email);
  document.getElementById('userModal').classList.add('open');
}

async function saveNewUser() {
  const email    = document.getElementById('umEmail').value.trim();
  const name     = document.getElementById('umName').value.trim();
  const role     = document.getElementById('umRole').value;
  const password = document.getElementById('umPassword').value;
  const errEl    = document.getElementById('umError');
  errEl.textContent = '';
  if (!email || !name || !password) { errEl.textContent = 'All fields required'; return; }

  const res  = await authFetch('/api/users', { method: 'POST', body: JSON.stringify({ email, name, role, password }) });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('userModal');
  showToast(`User ${email} created`, 'success');
  renderUsers();
}

async function saveEditUser(email) {
  const name     = document.getElementById('umName').value.trim();
  const role     = document.getElementById('umRole').value;
  const password = document.getElementById('umPassword').value;
  const errEl    = document.getElementById('umError');
  errEl.textContent = '';

  const body = { name, role };
  if (password) body.password = password;

  const res  = await authFetch(`/api/users/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) { errEl.textContent = json.error; return; }
  closeModal('userModal');
  showToast(`User ${email} updated`, 'success');
  renderUsers();
}

async function toggleUserActive(email, currentlyActive) {
  const res  = await authFetch(`/api/users/${encodeURIComponent(email)}`, { method: 'PUT', body: JSON.stringify({ active: !currentlyActive }) });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`${email} ${!currentlyActive ? 'activated' : 'deactivated'}`, 'success');
  renderUsers();
}

async function deleteUser(email) {
  if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
  const res  = await authFetch(`/api/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok) return showToast(json.error, 'error');
  showToast(`User ${email} deleted`, 'success');
  renderUsers();
}

// ── Bootstrap ───────────────────────────────────────────
(async function bootstrap() {
  const token = getToken();
  if (!token) { showLoginScreen(); return; }

  try {
    const res  = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { clearToken(); showLoginScreen(); return; }
    const json = await res.json();
    currentUser = json.user;
    hideLoginScreen();
    applyRoleUI();
    init();
  } catch {
    showLoginScreen();
  }
})();
