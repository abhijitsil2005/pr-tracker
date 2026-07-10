// ═══════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════
// Theme hex values (must match CSS :root vars)
const _C = {
  bg:      '#0f1117', surface: '#1a1d27', s2: '#22263a', s3: '#2a2f47',
  border:  '#2e3250', accent:  '#4f7ef8', green: '#22c55e',
  yellow:  '#eab308', red:     '#ef4444', orange: '#f97316',
  text:    '#e2e8f0', text2:   '#94a3b8',
};

const _FONT = "13px 'Segoe UI',system-ui,sans-serif";

let _rptModules  = [];
let _rptTimeline = [];
let _rptPRs      = [];
let _rptSprints  = [];

async function renderReports() {
  document.getElementById('rptContainer').innerHTML =
    `<div style="text-align:center;padding:48px;color:${_C.text2};font-size:13px">Loading…</div>`;

  const [mpData, tlData, prData, spData] = await Promise.all([
    api('modules'),
    api('lookup/timeline'),
    api('prs'),
    api('import/sprints'),
  ]);

  _rptModules  = Array.isArray(mpData) ? mpData : [];
  _rptTimeline = [...(Array.isArray(tlData) ? tlData : [])].sort((a, b) => Number(a.Release_Number) - Number(b.Release_Number));
  _rptPRs      = (prData && prData.data) || [];
  _rptSprints  = [...(Array.isArray(spData) ? spData : [])].sort((a, b) => (a.StartDate || '').localeCompare(b.StartDate || ''));

  const sel  = document.getElementById('rptReleaseFilter');
  const prev = sel.value;
  sel.innerHTML = '<option value="">All Releases</option>';
  _rptTimeline.forEach(t =>
    sel.add(new Option(`${t.Release_Date}  (R${t.Release_Number})`, t.Release_Date))
  );
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;

  _renderReportView();
}

function _modStats(mod) {
  const pages    = (mod.Pages || []).filter(p => !EXCLUDED_FROM_PAGES.has(p.page_name));
  const total    = pages.length;
  const deployed = pages.filter(p => (p.Production_Deployment_Status || '').toLowerCase() === 'deployed').length;
  const demo     = pages.filter(p => (p.Client_Demo_Status || '').toLowerCase() === 'done').length;
  const ff       = pages.filter(p => (p.Feature_Flag_Status || '').toLowerCase() === 'enabled').length;
  const pct      = total ? Math.round(deployed / total * 100) : 0;
  const status   = total === 0 ? 'empty'
                 : deployed === total ? 'complete'
                 : deployed > 0 ? 'progress'
                 : 'none';
  return { total, deployed, demo, ff, pct, status };
}

function _parseDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  const [m, d, y] = s.split('/').map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : null;
}

function _svgEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Normalise date string to ISO (YYYY-MM-DD), handles both ISO and mm/dd/yyyy ──
function _normDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parts = s.split('/');
  if (parts.length === 3) {
    const [m, d, y] = parts.map(Number);
    const year = y < 100 ? 2000 + y : y;
    return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}

// ── Chart 3: PRs Created vs Approved/Deployed per Sprint ──
function _buildPRSprintChart(prs, sprints) {
  // Deliberately NOT filtering out infra/API/Shared-Controls-only PRs here
  // (unlike the module/page completion charts) — this chart counts PR
  // throughput per sprint, and a PR that only touches those placeholder
  // "pages" was still raised/approved like any other and should still count.
  let BARS, chartData, subtitle;

  if (sprints && sprints.length) {
    // Sprint date ranges available: group by raised/approved date within range
    BARS = [
      { key: 'created',  color: _C.orange, label: 'Created'  },
      { key: 'approved', color: _C.accent,  label: 'Approved' },
    ];
    subtitle = 'Created = PR Raised Date within sprint range · Approved = PR Approved Date within sprint range';
    chartData = sprints.map(s => {
      const start = s.StartDate, end = s.EndDate;
      const created  = prs.filter(pr => { const d = _normDate(pr['PR Raised Date']);   return d && d >= start && d <= end; }).length;
      const approved = prs.filter(pr => { const d = _normDate(pr['PR Approved Date']); return d && d >= start && d <= end; }).length;
      return { sprint: String(s.Sprint), start, end, created, approved };
    }).filter(d => d.created > 0 || d.approved > 0);
  } else {
    // No sprint date ranges — group directly by Dev_Sprint field on PRs.
    // "Deployed" = status is flagged as such in Project Setup > PR Status.
    const DEPLOYED = new Set(lookupPRStatuses.filter(s => s.IsDeployed).map(s => s.Name));
    BARS = [
      { key: 'created',  color: _C.orange, label: 'Created'  },
      { key: 'approved', color: _C.green,  label: 'Deployed' },
    ];
    subtitle = 'Grouped by Dev Sprint field · Deployed = status is flagged Deployed in PR Status setup';

    const sprintMap = new Map();
    prs.forEach(pr => {
      const sprint = pr.Dev_Sprint;
      if (!sprint) return;
      if (!sprintMap.has(sprint)) sprintMap.set(sprint, { created: 0, approved: 0 });
      sprintMap.get(sprint).created++;
      if (DEPLOYED.has(pr.Status)) sprintMap.get(sprint).approved++;
    });

    // Sort sprint names numerically (e.g. "1.5" < "2.3" < "3.6")
    chartData = [...sprintMap.entries()]
      .sort(([a], [b]) => {
        const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const d = (pa[i] || 0) - (pb[i] || 0);
          if (d !== 0) return d;
        }
        return 0;
      })
      .map(([sprint, counts]) => ({ sprint, ...counts }));
  }

  if (!chartData.length) {
    return `<div class="rpt-chart-card">
      <div class="rpt-chart-title">PRs by Sprint — Created vs Approved</div>
      <div class="rpt-chart-subtitle">${subtitle}</div>
      <p style="color:${_C.text2};text-align:center;padding:40px 20px;font-size:13px">No PRs with sprint data found.</p>
    </div>`;
  }

  const W = 900, H = 300;
  const ML = 40, MR = 20, MT = 24, MB = 60;
  const CW = W - ML - MR, CH = H - MT - MB;

  const maxVal = Math.max(...chartData.map(d => Math.max(d.created, d.approved)), 1);
  const ticks  = _niceTicks(maxVal, 5);
  const yMax   = ticks[ticks.length - 1];

  const nG        = chartData.length;
  const groupW    = CW / nG;
  const totalBarW = Math.min(groupW * 0.72, 44);
  const barW      = totalBarW / 2;
  const rotate    = nG > 10;

  // Grid
  let grid = '';
  ticks.forEach(v => {
    const y = (MT + CH - (v / yMax) * CH).toFixed(1);
    grid += `<line x1="${ML}" y1="${y}" x2="${W - MR}" y2="${y}" stroke="${_C.border}" stroke-width="1"/>
      <text x="${ML - 6}" y="${(+y + 3.5).toFixed(1)}" text-anchor="end" fill="${_C.text2}" font-size="10" font-family="Segoe UI,system-ui,sans-serif">${v}</text>`;
  });
  grid += `<text transform="rotate(-90)" x="${-(MT + CH / 2)}" y="11" text-anchor="middle" fill="${_C.text2}" font-size="10" font-family="Segoe UI,system-ui,sans-serif">PRs</text>`;

  // Bars + dashed trend lines
  let bars = '', lines = '';
  BARS.forEach(b => {
    const pts = chartData.map((d, i) => {
      const cx = (ML + i * groupW + groupW / 2).toFixed(1);
      const cy = (MT + CH - (d[b.key] / yMax) * CH).toFixed(1);
      return `${cx},${cy}`;
    }).join(' ');
    lines += `<polyline points="${pts}" fill="none" stroke="${b.color}" stroke-width="1.5" stroke-dasharray="5,3" opacity="0.45"/>`;
    chartData.forEach((d, i) => {
      const cx = ML + i * groupW + groupW / 2;
      const cy = MT + CH - (d[b.key] / yMax) * CH;
      lines += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${b.color}" opacity="0.85"/>`;
    });
  });

  chartData.forEach((d, i) => {
    const cx     = ML + i * groupW + groupW / 2;
    const xStart = cx - totalBarW / 2;
    const base   = MT + CH;

    BARS.forEach((b, bi) => {
      const v = d[b.key];
      const x = xStart + bi * barW;
      const h = v > 0 ? (v / yMax) * CH : 0;
      const y = base - h;

      if (h > 0) {
        bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${b.color}" rx="2">
          <title>Sprint ${_svgEsc(d.sprint)}${d.start ? ` (${d.start} – ${d.end})` : ''} · ${b.label}: ${v}</title></rect>`;
      }
      if (h > 18) {
        bars += `<text x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y + h / 2 + 4).toFixed(1)}"
          text-anchor="middle" fill="#fff" font-size="9" font-weight="600"
          font-family="Segoe UI,system-ui,sans-serif" pointer-events="none">${v}</text>`;
      } else if (v > 0 && h > 0) {
        bars += `<text x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}"
          text-anchor="middle" fill="${b.color}" font-size="9" font-weight="700"
          font-family="Segoe UI,system-ui,sans-serif">${v}</text>`;
      }
    });

    // Sprint label
    if (rotate) {
      bars += `<text x="${cx.toFixed(1)}" y="${base + 7}" text-anchor="end" fill="${_C.text2}" font-size="9"
        font-family="Segoe UI,system-ui,sans-serif"
        transform="rotate(-40,${cx.toFixed(1)},${base + 7})">${_svgEsc(d.sprint)}</text>`;
    } else {
      bars += `<text x="${cx.toFixed(1)}" y="${(base + 17).toFixed(1)}" text-anchor="middle" fill="${_C.text2}"
        font-size="10" font-family="Segoe UI,system-ui,sans-serif">${_svgEsc(d.sprint)}</text>`;
    }
  });

  // Legend
  const LY = H - 9;
  let legend = '';
  let lx = ML;
  BARS.forEach(b => {
    legend += `<rect x="${lx}" y="${LY - 8}" width="10" height="10" fill="${b.color}" rx="2"/>
      <text x="${lx + 13}" y="${LY + 1}" fill="${_C.text2}" font-size="10" font-family="Segoe UI,system-ui,sans-serif">${b.label}</text>`;
    lx += 88;
  });

  return `
    <div class="rpt-chart-card">
      <div class="rpt-chart-title">PRs by Sprint — Created vs Approved</div>
      <div class="rpt-chart-subtitle">${subtitle}</div>
      <div class="rpt-chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;overflow:visible">
          ${grid}
          ${bars}
          ${lines}
          ${legend}
          <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + CH}" stroke="${_C.border}" stroke-width="1.5"/>
          <line x1="${ML}" y1="${MT + CH}" x2="${W - MR}" y2="${MT + CH}" stroke="${_C.border}" stroke-width="1.5"/>
        </svg>
      </div>
    </div>`;
}

function _niceTicks(max, n) {
  if (max <= 0) return [0, 1];
  const raw  = max / n;
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(1, Math.ceil(raw / mag) * mag);
  const ticks = [];
  for (let v = 0; v <= max + step; v += step) { ticks.push(v); if (v > max) break; }
  return ticks;
}

function _renderReportView() {
  const report     = document.getElementById('rptReportSel').value;
  const container  = document.getElementById('rptContainer');

  // Show module filters only for reports that use them
  const useModFilters = report === 'completion' || report === 'timeline';
  document.getElementById('rptModuleFilters').style.display = useModFilters ? 'flex' : 'none';

  if (report === 'sprints') {
    container.innerHTML = _buildPRSprintChart(_rptPRs, _rptSprints);
    return;
  }

  // ── Shared setup for module-based reports ──────────
  const filterDate = document.getElementById('rptReleaseFilter').value;
  const showOOS    = document.getElementById('rptShowOOS').checked;
  const modules    = _rptModules
    .filter(m => !EXCLUDED_FROM_MODULE.has(m.Module))
    .filter(m => showOOS || !m.IsOutOfScope);

  const dateToRel = {};
  _rptTimeline.forEach(t => { dateToRel[t.Release_Date] = t; });

  const groups = {};
  modules.forEach(m => {
    const d = m.Target_Release_Date;
    if (d) (groups[d] = groups[d] || []).push(m);
  });
  const allSortedDates = Object.keys(groups).sort((a, b) => (_parseDate(a) || 0) - (_parseDate(b) || 0));
  const scopedMods     = filterDate ? (groups[filterDate] || []) : modules;

  // Summary stats (shared across module reports)
  let totMods = 0, totComplete = 0, totProgress = 0, totNone = 0, totPages = 0, totDeployed = 0;
  scopedMods.forEach(m => {
    const s = _modStats(m);
    totMods++;
    if (s.status === 'complete')      totComplete++;
    else if (s.status === 'progress') totProgress++;
    else if (s.status === 'none')     totNone++;
    totPages    += s.total;
    totDeployed += s.deployed;
  });
  const overallPct   = totPages ? Math.round(totDeployed / totPages * 100) : 0;
  const overallColor = overallPct === 100 ? _C.green : overallPct > 0 ? _C.accent : _C.border;

  const summaryHtml = `
    <div class="rpt-overview">
      <div class="rpt-stat">
        <div class="rpt-stat-value">${totMods}</div>
        <div class="rpt-stat-label">Total Modules</div>
      </div>
      <div class="rpt-stat rpt-stat-complete">
        <div class="rpt-stat-value">${totComplete}</div>
        <div class="rpt-stat-label">Fully Released</div>
      </div>
      <div class="rpt-stat rpt-stat-progress">
        <div class="rpt-stat-value">${totProgress}</div>
        <div class="rpt-stat-label">In Progress</div>
      </div>
      <div class="rpt-stat rpt-stat-none">
        <div class="rpt-stat-value">${totNone}</div>
        <div class="rpt-stat-label">Not Started</div>
      </div>
      <div class="rpt-stat">
        <div class="rpt-stat-value">${totDeployed}<span class="rpt-stat-denom"> / ${totPages}</span></div>
        <div class="rpt-stat-label">Pages Deployed</div>
      </div>
    </div>
    <div class="rpt-overall-row">
      <span class="rpt-overall-label">Overall Deployment</span>
      <div class="rpt-progress-bar" style="flex:1">
        <div class="rpt-progress-fill" style="width:${overallPct}%;background:${overallColor}"></div>
      </div>
      <span class="rpt-overall-pct">${overallPct}%</span>
    </div>`;

  if (report === 'completion') {
    const chart1Data = allSortedDates.map(d => {
      const mods = groups[d] || [];
      let complete = 0, progress = 0, none = 0, empty = 0;
      mods.forEach(m => {
        const s = _modStats(m);
        if (s.status === 'complete')      complete++;
        else if (s.status === 'progress') progress++;
        else if (s.status === 'none')     none++;
        else                              empty++;
      });
      const rel = dateToRel[d];
      return { date: d, label: rel ? `R${rel.Release_Number}` : d, sublabel: d, complete, progress, none, empty, total: mods.length, focused: filterDate === d };
    });
    container.innerHTML = summaryHtml + _buildBarChart(chart1Data, filterDate);
    return;
  }

  if (report === 'timeline') {
    const chart2Mods = scopedMods
      .filter(m => m.Target_Release_Date || m.Actual_Release_Date)
      .map(m => ({
        name: m.Module, planned: _parseDate(m.Target_Release_Date), actual: _parseDate(m.Actual_Release_Date),
        plannedStr: m.Target_Release_Date || '', actualStr: m.Actual_Release_Date || '',
        stats: _modStats(m), oos: !!m.IsOutOfScope,
      }))
      .sort((a, b) => {
        const da = a.planned || a.actual || 0, db = b.planned || b.actual || 0;
        return (da || 0) - (db || 0) || a.name.localeCompare(b.name);
      });
    const chartHtml = chart2Mods.length
      ? _buildTimelineChart(chart2Mods)
      : `<div class="rpt-chart-card"><p style="color:${_C.text2};text-align:center;padding:40px 20px;font-size:13px">No modules have Planned or Actual Release Dates set.</p></div>`;
    container.innerHTML = summaryHtml + chartHtml;
    return;
  }
}

// ── Chart 1: Stacked bar — module completion by release ──
function _buildBarChart(data, focusDate) {
  if (!data.length) {
    return `<div class="rpt-chart-card"><p style="color:${_C.text2};text-align:center;padding:40px 20px;font-size:13px">No release data — assign modules a Planned Release Date to see them here.</p></div>`;
  }

  const W = 900, H = 300;
  const ML = 40, MR = 20, MT = 24, MB = 60;
  const CW = W - ML - MR, CH = H - MT - MB;

  const maxMods  = Math.max(...data.map(d => d.total), 1);
  const yMax     = _niceTicks(maxMods, 5).slice(-1)[0];
  const ticks    = _niceTicks(maxMods, 5);
  const yScale   = v => CH - (v / yMax) * CH;

  const nBars = data.length;
  const barW  = Math.min(68, Math.max(20, (CW / nBars) * 0.55));
  const xStep = CW / nBars;

  // Grid lines + Y-axis labels
  let grid = '';
  ticks.forEach(v => {
    const y = MT + yScale(v);
    grid += `<line x1="${ML}" y1="${y.toFixed(1)}" x2="${W - MR}" y2="${y.toFixed(1)}" stroke="${_C.border}" stroke-width="1"/>
      <text x="${ML - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" fill="${_C.text2}" font-size="10" font-family="Segoe UI,system-ui,sans-serif">${v}</text>`;
  });

  // Y-axis label (rotated)
  grid += `<text transform="rotate(-90)" x="${-(MT + CH / 2)}" y="11" text-anchor="middle" fill="${_C.text2}" font-size="10" font-family="Segoe UI,system-ui,sans-serif">Modules</text>`;

  // Bars
  let bars = '';
  data.forEach((d, i) => {
    const cx   = ML + i * xStep + xStep / 2;
    const x    = cx - barW / 2;
    const base = MT + CH;
    const dim  = focusDate && !d.focused;

    // Stacked segments: bottom = none, mid = progress, top = complete
    const segs = [
      { val: d.none,     color: _C.s3,    label: 'Not Started' },
      { val: d.progress, color: _C.accent, label: 'In Progress' },
      { val: d.complete, color: _C.green,  label: 'Complete'    },
    ];
    let yOff = 0;
    segs.forEach(seg => {
      if (seg.val <= 0) return;
      const segH = (seg.val / yMax) * CH;
      const y    = base - yOff - segH;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${segH.toFixed(1)}"
        fill="${seg.color}" rx="3" opacity="${dim ? '0.28' : '1'}">
        <title>${_svgEsc(d.label)} · ${seg.val} ${seg.label}</title>
      </rect>`;
      if (segH > 18) {
        const textFill = seg.color === _C.s3 ? _C.text2 : '#fff';
        bars += `<text x="${cx.toFixed(1)}" y="${(y + segH / 2 + 4).toFixed(1)}" text-anchor="middle"
          fill="${textFill}" font-size="10" font-weight="600" font-family="Segoe UI,system-ui,sans-serif"
          opacity="${dim ? '0.3' : '1'}" pointer-events="none">${seg.val}</text>`;
      }
      yOff += segH;
    });

    // Total label on top of bar
    if (d.total > 0) {
      const topY = base - yOff - 6;
      bars += `<text x="${cx.toFixed(1)}" y="${topY.toFixed(1)}" text-anchor="middle"
        fill="${_C.text}" font-size="10" font-weight="700" font-family="Segoe UI,system-ui,sans-serif"
        opacity="${dim ? '0.3' : '1'}">${d.total}</text>`;
    }

    // Focus ring
    if (d.focused && yOff > 0) {
      const totalH = (d.total / yMax) * CH;
      bars += `<rect x="${(x - 3).toFixed(1)}" y="${(base - yOff - 3).toFixed(1)}"
        width="${barW + 6}" height="${(totalH + 6).toFixed(1)}"
        fill="none" stroke="${_C.accent}" stroke-width="2" rx="5" opacity="0.7"/>`;
    }

    // X-axis labels
    const labelY = base + 17;
    bars += `<text x="${cx.toFixed(1)}" y="${labelY}" text-anchor="middle"
      fill="${dim ? _C.border : _C.text}" font-size="10" font-weight="600"
      font-family="Segoe UI,system-ui,sans-serif">${_svgEsc(d.label)}</text>`;
    bars += `<text x="${cx.toFixed(1)}" y="${labelY + 13}" text-anchor="middle"
      fill="${dim ? _C.border : _C.text2}" font-size="9"
      font-family="Segoe UI,system-ui,sans-serif">${_svgEsc(d.sublabel)}</text>`;
  });

  // Legend
  const LY = H - 9;
  const legendItems = [
    { color: _C.green,  label: 'Complete'    },
    { color: _C.accent, label: 'In Progress' },
    { color: _C.s3,     label: 'Not Started' },
  ];
  let legend = '';
  let lx = ML;
  legendItems.forEach(li => {
    legend += `<rect x="${lx}" y="${LY - 8}" width="10" height="10" fill="${li.color}" rx="2"/>
      <text x="${lx + 13}" y="${LY + 1}" fill="${_C.text2}" font-size="10" font-family="Segoe UI,system-ui,sans-serif">${li.label}</text>`;
    lx += 96;
  });

  return `
    <div class="rpt-chart-card">
      <div class="rpt-chart-title">Module Completion Progress by Release</div>
      <div class="rpt-chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;overflow:visible">
          ${grid}
          ${bars}
          ${legend}
          <line x1="${ML}" y1="${MT}" x2="${ML}" y2="${MT + CH}" stroke="${_C.border}" stroke-width="1.5"/>
          <line x1="${ML}" y1="${MT + CH}" x2="${W - MR}" y2="${MT + CH}" stroke="${_C.border}" stroke-width="1.5"/>
        </svg>
      </div>
    </div>`;
}

// ── Chart 2: Planned vs Actual timeline ──────────────────
function _buildTimelineChart(mods) {
  const ROW_H = 26;
  const ML    = 155, MR = 30, MT = 42, MB = 28;
  const W     = 900;
  const H     = MT + mods.length * ROW_H + MB;
  const CW    = W - ML - MR;

  // Date range: span of all planned/actual dates
  const allDates = mods.flatMap(m => [m.planned, m.actual].filter(Boolean));
  if (!allDates.length) return '';

  let minD = new Date(Math.min(...allDates));
  let maxD = new Date(Math.max(...allDates));
  // Round to month boundaries with padding
  minD = new Date(minD.getFullYear(), minD.getMonth() - 1, 1);
  maxD = new Date(maxD.getFullYear(), maxD.getMonth() + 2, 1);

  const span   = maxD - minD;
  const xForD  = d => ML + ((d - minD) / span) * CW;

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // Month grid lines
  let grid = '';
  let cur = new Date(minD.getFullYear(), minD.getMonth(), 1);
  while (cur < maxD) {
    const x = xForD(cur).toFixed(1);
    grid += `<line x1="${x}" y1="${MT - 10}" x2="${x}" y2="${MT + mods.length * ROW_H}" stroke="${_C.border}" stroke-width="1" stroke-dasharray="4,4"/>`;
    grid += `<text x="${x}" y="${MT - 15}" text-anchor="middle" fill="${_C.text2}" font-size="9" font-family="Segoe UI,system-ui,sans-serif">${cur.toLocaleDateString('en-US',{month:'short'})} '${String(cur.getFullYear()).slice(2)}</text>`;
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }

  // Today line
  if (today >= minD && today <= maxD) {
    const tx = xForD(today).toFixed(1);
    grid += `<line x1="${tx}" y1="${MT - 20}" x2="${tx}" y2="${MT + mods.length * ROW_H}" stroke="${_C.red}" stroke-width="1.5" stroke-dasharray="5,3"/>`;
    grid += `<text x="${tx}" y="${MT - 24}" text-anchor="middle" fill="${_C.red}" font-size="9" font-weight="700" font-family="Segoe UI,system-ui,sans-serif">Today</text>`;
  }

  // Rows
  let rows = '';
  mods.forEach((m, i) => {
    const cy  = MT + i * ROW_H + ROW_H / 2;
    const bg  = i % 2 === 0 ? `rgba(42,47,71,0.35)` : 'transparent';

    rows += `<rect x="0" y="${MT + i * ROW_H}" width="${W}" height="${ROW_H}" fill="${bg}"/>`;

    // Module name — truncate at ~22 chars
    const label = m.name.length > 22 ? m.name.slice(0, 20) + '…' : m.name;
    const nameColor = m.oos ? _C.text2 : _C.text;
    rows += `<text x="${ML - 10}" y="${cy + 3.5}" text-anchor="end" fill="${nameColor}"
      font-size="10" font-family="Segoe UI,system-ui,sans-serif"><title>${_svgEsc(m.name)}</title>${_svgEsc(label)}</text>`;

    if (m.planned && m.actual) {
      const px      = xForD(m.planned);
      const ax      = xForD(m.actual);
      const isLate  = m.actual > m.planned;
      const onTime  = m.actual.getTime() === m.planned.getTime();
      const lColor  = onTime ? _C.green : isLate ? _C.red : _C.green;
      const days    = Math.round(Math.abs(m.actual - m.planned) / 86400000);
      const offTxt  = onTime ? 'On time' : isLate ? `+${days}d` : `-${days}d`;

      rows += `<line x1="${px.toFixed(1)}" y1="${cy}" x2="${ax.toFixed(1)}" y2="${cy}" stroke="${lColor}" stroke-width="2" opacity="0.45"/>`;
      // Planned dot (hollow circle)
      rows += `<circle cx="${px.toFixed(1)}" cy="${cy}" r="6" fill="${_C.surface}" stroke="${_C.accent}" stroke-width="2">
        <title>Planned: ${_svgEsc(m.plannedStr)}</title></circle>`;
      // Actual dot (filled)
      rows += `<circle cx="${ax.toFixed(1)}" cy="${cy}" r="6" fill="${lColor}" stroke="${lColor}" stroke-width="1.5">
        <title>Actual: ${_svgEsc(m.actualStr)} (${offTxt})</title></circle>`;
      // Off-label centred between the two dots
      const midX = (px + ax) / 2;
      rows += `<text x="${midX.toFixed(1)}" y="${(cy - 9).toFixed(1)}" text-anchor="middle" fill="${lColor}"
        font-size="9" font-weight="700" font-family="Segoe UI,system-ui,sans-serif">${offTxt}</text>`;

    } else if (m.planned) {
      const px    = xForD(m.planned);
      const color = m.stats.status === 'complete' ? _C.green : _C.accent;
      // Dashed line from planned toward today
      const todayX = today >= minD && today <= maxD ? xForD(today) : null;
      if (todayX !== null && m.planned > today) {
        rows += `<line x1="${todayX.toFixed(1)}" y1="${cy}" x2="${px.toFixed(1)}" y2="${cy}" stroke="${color}" stroke-width="1.5" stroke-dasharray="5,4" opacity="0.3"/>`;
      }
      rows += `<circle cx="${px.toFixed(1)}" cy="${cy}" r="6" fill="${_C.surface}" stroke="${color}" stroke-width="2">
        <title>Planned: ${_svgEsc(m.plannedStr)} — no actual date yet</title></circle>`;

    } else if (m.actual) {
      const ax = xForD(m.actual);
      rows += `<circle cx="${ax.toFixed(1)}" cy="${cy}" r="6" fill="${_C.green}" stroke="${_C.green}" stroke-width="1.5">
        <title>Actual: ${_svgEsc(m.actualStr)} (no planned date)</title></circle>`;
    }
  });

  // Legend
  const LY = H - 7;
  const legendItems = [
    { type: 'hollow', color: _C.accent, label: 'Planned date'     },
    { type: 'filled', color: _C.green,  label: 'Actual — on time / early' },
    { type: 'filled', color: _C.red,    label: 'Actual — late'    },
  ];
  let legend = '';
  let lx = ML;
  legendItems.forEach(li => {
    if (li.type === 'hollow') {
      legend += `<circle cx="${lx + 5}" cy="${LY - 3}" r="5" fill="${_C.surface}" stroke="${li.color}" stroke-width="2"/>`;
    } else {
      legend += `<circle cx="${lx + 5}" cy="${LY - 3}" r="5" fill="${li.color}"/>`;
    }
    legend += `<text x="${lx + 14}" y="${LY + 1}" fill="${_C.text2}" font-size="10" font-family="Segoe UI,system-ui,sans-serif">${li.label}</text>`;
    lx += li.label.length * 6.8 + 26;
  });

  return `
    <div class="rpt-chart-card">
      <div class="rpt-chart-title">Planned vs Actual Release Timeline</div>
      <div class="rpt-chart-wrap">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block;overflow:visible">
          ${grid}
          ${rows}
          <line x1="${ML}" y1="${MT - 10}" x2="${ML}" y2="${MT + mods.length * ROW_H}" stroke="${_C.border}" stroke-width="1.5"/>
          ${legend}
        </svg>
      </div>
    </div>`;
}
