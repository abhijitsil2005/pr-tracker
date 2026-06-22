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
  const pctComplete = totalPages ? Math.round(prodDeployed / totalPages * 100) : 0;
  const modulesCompleted = filteredModules.filter(m => {
    const pages = m.Pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name));
    return pages.length > 0 && pages.every(p => (p.Production_Deployment_Status||'').toLowerCase() === 'deployed');
  }).length;

  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card accent"><div class="label">Total Pages</div><div class="value">${totalPages}</div></div>
    <div class="stat-card green"><div class="label">Pages in Production</div><div class="value">${prodDeployed}</div></div>
    <div class="stat-card yellow"><div class="label">% Complete</div><div class="value">${pctComplete}%</div></div>
    <div class="stat-card teal"><div class="label">Modules Completed</div><div class="value">${modulesCompleted} / ${filteredModules.length}</div></div>
    <div class="stat-card accent"><div class="label">Total PRs</div><div class="value">${total}</div></div>
    <div class="stat-card green"><div class="label">PRs Deployed</div><div class="value">${deployed}</div></div>
    <div class="stat-card yellow"><div class="label">PR In Progress / TCR</div><div class="value">${inProg}</div></div>
    <div class="stat-card red"><div class="label">PR In Review</div><div class="value">${review}</div></div>`;

  // ── Module status table ──
  const prByModule = {};
  filteredPRs.forEach(p => {
    const m = p.Module || 'Unknown';
    if (!prByModule[m]) prByModule[m] = { total:0, deployed:0, inProg:0, coveredPages: new Set() };
    prByModule[m].total++;
    if (p.Status?.toLowerCase().includes('prod deployed')) prByModule[m].deployed++;
    else prByModule[m].inProg++;
    const st = (p.Status || '').toLowerCase();
    const isDevType = (p.Type || '').toLowerCase() === 'development';
    const isExcluded = st.includes('development inprogress') || st.includes('closed');
    if (isDevType && !isExcluded) {
      (p.Page || []).forEach(pg => prByModule[m].coveredPages.add(pg));
    }
  });

  document.querySelector('#moduleTable tbody').innerHTML = filteredModules
    .sort((a,b) => a.Module.localeCompare(b.Module))
    .map(m => {
      const pages    = m.Pages.filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name)) || [];
      const prodDep  = pages.filter(p => (p.Production_Deployment_Status||'').toLowerCase() === 'deployed').length;
      const prodPend = pages.length - prodDep;
      const ffDis    = pages.filter(p => (p.Feature_Flag_Status||'').toLowerCase() !== 'enabled').length;
      const prs          = prByModule[m.Module] || { total:0, deployed:0, inProg:0, coveredPages: new Set() };
      const pagesWithPR  = pages.filter(p => (prs.coveredPages||new Set()).has(p.page_name)).length;

      const prodPct  = pages.length ? Math.round(prodDep / pages.length * 100) : 0;
      const devPct   = prodPct === 100 ? 100 : (pages.length ? Math.round(pagesWithPR / pages.length * 100) : 0);
      const barColor = prodPct === 100 ? 'var(--green)' : prodPct > 0 ? 'var(--yellow)' : 'var(--border)';
      const pctColor = prodPct === 100 ? 'var(--green)' : prodPct > 0 ? 'var(--yellow)' : 'var(--text2)';
      const devColor = devPct  === 100 ? 'var(--green)' : devPct  > 0 ? 'var(--yellow)' : 'var(--text2)';

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
        <td style="text-align:center"><span class="badge badge-red">${ffDis}</span></td>
        <td style="text-align:center;color:var(--yellow)">${prs.inProg}</td>
        <td style="text-align:center;font-weight:600;color:${devColor}">${devPct}%</td>
        <td style="text-align:center;font-weight:600;color:${pctColor}">${prodPct}%</td>
      </tr>`;
    }).join('');

}
