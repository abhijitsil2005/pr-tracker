const XLSX = require('xlsx');
const path = require('path');
const dataService = require('./dataService');

const SHEET_NAME = 'All Handson WorkShop-May-Sep';
const EXCEL_PATH = path.join(__dirname, '..', 'data', 'Final_Estimation.xlsx');

// ─── Helpers ──────────────────────────────────────────────────
function fmtDate(val) {
  if (!val || val === '' || val === null || val === undefined) return null;
  if (typeof val === 'number') {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    const mm = String(d.m).padStart(2, '0');
    const dd = String(d.d).padStart(2, '0');
    const yyyy = d.y;
    return `${mm}/${dd}/${yyyy}`;
  }
  if (val instanceof Date) {
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    const yyyy = val.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  }
  if (typeof val === 'string') {
    // Try common formats
    const trimmed = val.trim();
    // Already mm/dd/yyyy
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return trimmed;
    // yyyy-mm-dd
    const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  }
  return null;
}

function parseDependentPRs(val) {
  if (!val || val === '' || val === null) return [];
  const str = String(val).trim();
  return str
    .split(/[\n,/\\]+/)
    .map(s => s.trim())
    .filter(s => /^\d+$/.test(s))
    .map(Number);
}

function parsePages(val) {
  if (!val || val === '' || val === null) return [];
  return String(val)
    .trim()
    .split(/[,;]+/)
    .map(p => p.trim().replace(/\\/g, '/'))
    .filter(Boolean);
}

function sprintStr(val) {
  if (val === null || val === undefined || val === '') return null;
  return String(val).trim();
}

// Normalize page path: strip leading module folder prefix and .cs extension
function normalizePage(rawPage) {
  // Remove .cs extension
  let p = rawPage.replace(/\.cs$/i, '');
  // Remove leading module folder (e.g. "assessments/" -> "", "content/" -> "")
  // We want just the relative page within the module
  const parts = p.split('/');
  // If it looks like a module-prefixed path (e.g. assessments/checkMyWork/submissions.aspx)
  // return everything after first segment when first segment is a module folder
  const modulePrefixes = [
    'assessments', 'assessment', 'content', 'communication',
    'enrollment', 'assetaware', 'location', 'library',
    'home', 'gradebook', 'security', 'extendedfield',
    'issueaware', 'addressbook', 'common', 'log', 'external', 'importstatus'
  ];
  if (parts.length > 1 && modulePrefixes.includes(parts[0].toLowerCase())) {
    return parts.slice(1).join('/');
  }
  return parts.join('/');
}

// Match raw page to Module_Pages lookup
function matchPage(rawPage, moduleName) {
  const modulePages = dataService.getPagesForModule(moduleName);
  if (!modulePages.length) return rawPage.replace(/\.cs$/i, '');
  const normalized = normalizePage(rawPage);
  // Exact match on page_name
  const exact = modulePages.find(mp => mp.page_name === normalized);
  if (exact) return exact.page_name;
  // Partial match
  const partial = modulePages.find(
    mp => normalized.includes(mp.page_name) || mp.page_name.includes(normalized)
  );
  if (partial) return partial.page_name;
  // Basename match
  const base = normalized.split('/').pop();
  const baseMatch = modulePages.find(mp => mp.page_name.split('/').pop() === base);
  if (baseMatch) return baseMatch.page_name;
  return normalized;
}

// Determine reviewer from Team.json PR Reviewer list (null if not in sheet)
function inferReviewer() {
  // Reviewer column doesn't exist in the sheet; keep null
  return null;
}

// ─── Main sync function ────────────────────────────────────────
function syncFromExcel(filePath) {
  const excelFile = filePath || EXCEL_PATH;
  const wb = XLSX.readFile(excelFile, { cellDates: true });

  if (!wb.SheetNames.includes(SHEET_NAME)) {
    throw new Error(`Sheet "${SHEET_NAME}" not found in workbook`);
  }

  const ws = wb.Sheets[SHEET_NAME];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

  const grouped = new Map(); // keyed by PR number

  for (const row of rows) {
    const prRaw = row['PR'];
    if (!prRaw) continue;

    // Handle multi-PR cells like "8917\n9059"
    const prKeys = String(prRaw)
      .split(/[\n,/\\]+/)
      .map(s => s.trim())
      .filter(s => /\d+/.test(s))
      .map(s => Number(s.match(/(\d+)/)[1]));

    for (const prNum of prKeys) {
      const pageRaw = row['Modules/ Pages'] || '';
      const moduleName = row['Module'] ? String(row['Module']).trim() : null;
      const pages = parsePages(pageRaw).map(p => matchPage(p, moduleName));

      if (!grouped.has(prNum)) {
        grouped.set(prNum, {
          PR: prNum,
          Type: 'Development',
          Developer: row['POC'] ? String(row['POC']).trim() : null,
          Module: moduleName,
          Page: pages,
          Status: row['Status'] ? String(row['Status']).trim() : null,
          'PR Raised Date': fmtDate(row['PR Raised Date']),
          Reviewer: inferReviewer(),
          'PR First Response Date': fmtDate(row['First PR Response Date']),
          'PR Approved Date': fmtDate(row['PR Approved Date']),
          'PR Merged Date': fmtDate(row['PR Merged Date']),
          Dev_Sprint: sprintStr(row['Sprint']),
          Testing_Sprint: null,
          Dependent_PRs: parseDependentPRs(row['Dependency PR Number']),
          Target_Release: fmtDate(row['Planned Release Date']),
          PR_Comments: [],
        });
      } else {
        // Merge pages for same PR across multiple rows
        const existing = grouped.get(prNum);
        for (const p of pages) {
          if (!existing.Page.includes(p)) existing.Page.push(p);
        }
      }
    }
  }

  const prList = Array.from(grouped.values());
  return prList;
}

// Build Prod_Releases from merged PR data + Release_Timeline
function buildProdReleases(prList) {
  const timeline = dataService.getReleaseTimeline();

  // Group PRs by Target_Release date
  const byRelease = new Map();
  for (const pr of prList) {
    const rd = pr.Target_Release;
    if (!rd) continue;
    if (!byRelease.has(rd)) byRelease.set(rd, []);
    byRelease.get(rd).push(pr.PR);
  }

  const releases = [];
  for (const [releaseDate, prNums] of byRelease.entries()) {
    const tlEntry = timeline.find(t => t.Release_Date === releaseDate);
    releases.push({
      Release_Number: tlEntry ? tlEntry.Release_Number : null,
      Release_Date: releaseDate,
      Code_Freeze: tlEntry ? tlEntry['Code Freeze'] : null,
      Regression_Start: tlEntry ? tlEntry['Regression Start Date'] : null,
      PRs: prNums,
      PR_Count: prNums.length,
    });
  }

  // Sort by release date
  releases.sort((a, b) => {
    const toMs = d => d ? new Date(d).getTime() : 0;
    return toMs(a.Release_Date) - toMs(b.Release_Date);
  });

  return releases;
}

// ─── Full sync: read Excel → write both JSON files ────────────
function fullSync(filePath) {
  const prList = syncFromExcel(filePath);
  const prodReleases = buildProdReleases(prList);

  // Overwrite PR_Details.json
  const fs = require('fs');
  fs.writeFileSync(dataService.FILES.PR_DETAILS, JSON.stringify(prList, null, 2));
  fs.writeFileSync(dataService.FILES.PROD_RELEASES, JSON.stringify(prodReleases, null, 2));

  return {
    prs_synced: prList.length,
    releases_built: prodReleases.length,
    pr_list: prList,
    prod_releases: prodReleases,
  };
}

module.exports = { fullSync, syncFromExcel, buildProdReleases, fmtDate };
