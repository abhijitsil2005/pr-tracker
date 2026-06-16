// ═══════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════
function prodStatusBadge(s) {
  const l = (s||'').toLowerCase();
  if (l === 'deployed')    return `<span class="badge badge-green">Deployed</span>`;
  if (l === 'in progress') return `<span class="badge badge-yellow">In Progress</span>`;
  if (l === 'blocked')     return `<span class="badge badge-red">Blocked</span>`;
  return `<span class="badge badge-gray">${s||'Pending'}</span>`;
}

function demoStatusBadge(s) {
  const l = (s||'').toLowerCase();
  if (l === 'done')      return `<span class="badge badge-green">Done</span>`;
  if (l === 'scheduled') return `<span class="badge badge-blue">Scheduled</span>`;
  if (l === 'n/a')       return `<span class="badge badge-gray">N/A</span>`;
  return `<span class="badge badge-gray">${s||'Pending'}</span>`;
}

// Excluded from ALL stats (PRs, pages, module table, developer table)
const EXCLUDED_FROM_MODULE   = new Set(['Shared Controls']);
// Excluded from page-count stats and module table only (PRs still counted)
const EXCLUDED_FROM_PAGES = new Set(['Infrastructure Pages']);

async function renderDashboard() {
  const [prData, mpData] = await Promise.all([api('prs'), api('modules')]);
  allPRs         = (prData && prData.data) || [];
  allModulePages = mpData || [];

  const filteredPRs     = allPRs.filter(p => !EXCLUDED_FROM_MODULE.has(p.Module));
  const filteredModules = allModulePages.filter(m => !EXCLUDED_FROM_MODULE.has(m.Module));

  const total    = filteredPRs.length;
  const deployed = filteredPRs.filter(p => p.Status?.toLowerCase().includes('prod deployed')).length;
  const inProg   = filteredPRs.filter(p => p.Status?.toLowerCase().includes('progress')).length;
  const review   = filteredPRs.filter(p => p.Status?.toLowerCase().includes('review')).length;

  // Page-level counts from Module_Pages (excludes Infrastructure Pages + Shared Control)
  const totalPages  = filteredModules.reduce((s, m) => s + (m.Pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name))||[]).length, 0);
  const prodDeployed = filteredModules.reduce((s, m) =>
    s + (m.Pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name))||[]).filter(p => (p.Production_Deployment_Status||'').toLowerCase() === 'deployed').length, 0);
  const demoComplete = filteredModules.reduce((s, m) =>
    s + (m.Pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name))||[]).filter(p => (p.Client_Demo_Status||'').toLowerCase() === 'done').length, 0);
  const ffEnabled = filteredModules.reduce((s, m) =>
    s + (m.Pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name))||[]).filter(p => (p.Feature_Flag_Status||'').toLowerCase() === 'enabled').length, 0);

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card accent"><div class="label">Total Pages</div><div class="value">${totalPages}</div></div>
    <div class="stat-card green"><div class="label">Pages in Production</div><div class="value">${prodDeployed}</div></div>
    <div class="stat-card yellow"><div class="label">Demo Complete</div><div class="value">${demoComplete}</div></div>
    <div class="stat-card red"><div class="label">FF Enabled</div><div class="value">${ffEnabled}</div></div>  
    <div class="stat-card accent"><div class="label">Total PRs</div><div class="value">${total}</div></div>
    <div class="stat-card green"><div class="label">PRs Deployed</div><div class="value">${deployed}</div></div>
    <div class="stat-card yellow"><div class="label">PR In Progress / TCR</div><div class="value">${inProg}</div></div>
    <div class="stat-card red"><div class="label">PR In Review</div><div class="value">${review}</div></div>`;

  // ── Module status table ──
  const prByModule = {};
  filteredPRs.forEach(p => {
    const m = p.Module || 'Unknown';
    if (!prByModule[m]) prByModule[m] = { total:0, deployed:0, inProg:0 };
    prByModule[m].total++;
    if (p.Status?.toLowerCase().includes('prod deployed')) prByModule[m].deployed++;
    else prByModule[m].inProg++;
  });

  document.querySelector('#moduleTable tbody').innerHTML = filteredModules
    .sort((a,b) => a.Module.localeCompare(b.Module))
    .map(m => {
      const pages      = m.Pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name)) || [];
      const prodDep    = pages.filter(p => (p.Production_Deployment_Status||'').toLowerCase() === 'deployed').length;
      const prodPend   = pages.length - prodDep;
      const ffEn       = pages.filter(p => (p.Feature_Flag_Status||'').toLowerCase() === 'enabled').length;
      const ffDis      = pages.length - ffEn;
      const demoDone   = pages.filter(p => (p.Client_Demo_Status||'').toLowerCase() === 'done').length;
      const demoPend   = pages.filter(p => (p.Client_Demo_Status||'').toLowerCase() !== 'done').length;
      const prs        = prByModule[m.Module] || { total:0, deployed:0, inProg:0 };

      const prodPct = pages.length ? Math.round(prodDep / pages.length * 100) : 0;
      const barColor = prodPct === 100 ? 'var(--green)' : prodPct > 0 ? 'var(--yellow)' : 'var(--border)';

      return `<tr>
        <td>
          <strong>${m.Module}</strong>
          <div style="margin-top:4px;height:3px;border-radius:2px;background:var(--surface3);width:100%">
            <div style="height:100%;width:${prodPct}%;background:${barColor};border-radius:2px;transition:width .3s"></div>
          </div>
        </td>
        <td style="text-align:center"><strong>${pages.length}</strong></td>
        <td style="text-align:center;color:var(--green)"><strong>${prodDep}</strong></td>
        <td style="text-align:center;color:var(--text2)">${prodPend}</td>
        <td style="text-align:center"><span class="badge badge-green">${ffEn}</span></td>
        <td style="text-align:center"><span class="badge badge-red">${ffDis}</span></td>
        <!-- <td style="text-align:center"><span class="badge badge-teal">${demoDone}</span></td>
         <td style="text-align:center;color:var(--text2)">${demoPend}</td> -->
        <td style="text-align:center"><strong>${prs.total}</strong></td>
        <td style="text-align:center;color:var(--green)">${prs.deployed}</td>
        <td style="text-align:center;color:var(--yellow)">${prs.inProg}</td>
      </tr>`;
    }).join('');

  // ── Developer table ──
  const devMap = {};
  filteredPRs.forEach(p => {
    const d = p.Developer || 'Unknown';
    if (!devMap[d]) devMap[d] = { prs:0, modules:new Set() };
    devMap[d].prs++;
    if (p.Module) devMap[d].modules.add(p.Module);
  });
  document.querySelector('#devTable tbody').innerHTML = Object.entries(devMap)
    .sort((a,b) => b[1].prs - a[1].prs)
    .map(([d,v]) => `<tr>
      <td>${d}</td>
      <td><strong>${v.prs}</strong></td>
      <td><div class="tag-list">${[...v.modules].map(m=>`<span class="tag">${m}</span>`).join('')}</div></td>
    </tr>`).join('');
}
