// ═══════════════════════════════════════════════════════
// SYNC
// ═══════════════════════════════════════════════════════
async function syncExcel() {
  const btn = document.getElementById('syncBtn');
  btn.textContent = '⏳ Syncing…'; btn.disabled = true;
  const res = await fetch(`${API}/sync/excel`,{method:'POST'});
  const json = await res.json();
  btn.textContent = '🔄 Run Sync'; btn.disabled = false;
  const el = document.getElementById('syncResult');
  if (!res.ok) { el.innerHTML=`<span style="color:var(--red)">Error: ${json.error}</span>`; el.classList.add('show'); return; }
  el.innerHTML = `
    <div class="row"><span>PRs synced</span><span>${json.prs_synced}</span></div>
    <div class="row"><span>Releases built</span><span>${json.releases_built}</span></div>
    <div class="row"><span>Modules</span><span>${(json.summary?.modules||[]).join(', ')}</span></div>`;
  el.classList.add('show');
  showToast(`Sync complete: ${json.prs_synced} PRs`,'success');
}

async function uploadSync(input) {
  if (!input.files[0]) return;
  const formData = new FormData();
  formData.append('excel', input.files[0]);
  const res = await fetch(`${API}/sync/upload`,{method:'POST',body:formData});
  const json = await res.json();
  const el = document.getElementById('uploadResult');
  if (!res.ok) { el.innerHTML=`<span style="color:var(--red)">Error: ${json.error}</span>`; el.classList.add('show'); return; }
  el.innerHTML = `
    <div class="row"><span>File</span><span>${json.filename}</span></div>
    <div class="row"><span>PRs synced</span><span>${json.prs_synced}</span></div>
    <div class="row"><span>Releases built</span><span>${json.releases_built}</span></div>`;
  el.classList.add('show');
  showToast(`Upload & sync complete: ${json.prs_synced} PRs`,'success');
}

function setupDragDrop() {
  const ua = document.getElementById('uploadArea');
  ua.addEventListener('dragover', e=>{ e.preventDefault(); ua.classList.add('drag'); });
  ua.addEventListener('dragleave', ()=>ua.classList.remove('drag'));
  ua.addEventListener('drop', e=>{
    e.preventDefault(); ua.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) { const dt=new DataTransfer(); dt.items.add(file); document.getElementById('fileInput').files=dt.files; uploadSync(document.getElementById('fileInput')); }
  });
}
