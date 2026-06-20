#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const { randomUUID } = require('crypto');
const { DynamoDBClient, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const JSON_FILE = path.join(__dirname, '..', 'PR-List-new.json');

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const docClient = DynamoDBDocumentClient.from(client);

// ── Date normalisation ─────────────────────────────────────────────
const MONTH = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };

function normalizeDate(s) {
  if (!s || !s.trim()) return null;
  s = s.trim();

  // Already m/d/yyyy
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;

  // d-Mon[-yy] e.g. "27-Feb", "5-May", "7-Apr-26"
  const parts = s.split('-');
  if (parts.length >= 2) {
    const day   = parseInt(parts[0], 10);
    const abbr  = parts[1].replace(/[^A-Za-z]/g, '').toLowerCase().slice(0, 3);
    const month = MONTH[abbr];
    if (month && day) return `${month}/${day}/2026`;
  }

  return s; // return as-is if format unknown
}

// ── Scan all existing PRDetails records ────────────────────────────
async function scanAllPRs() {
  const items = [];
  let lastKey;
  do {
    const resp = await docClient.send(new ScanCommand({
      TableName: 'PRDetails',
      ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
    }));
    items.push(...(resp.Items || []));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  // Verify table is on new schema (id PK)
  const desc = await client.send(new DescribeTableCommand({ TableName: 'PRDetails' }));
  const pkName = desc.Table.KeySchema.find(k => k.KeyType === 'HASH')?.AttributeName;
  if (pkName !== 'id') {
    console.error(`ERROR: PRDetails table uses "${pkName}" as PK. Run the server once to migrate to the "id" schema first.`);
    process.exit(1);
  }

  const incoming = require(JSON_FILE);
  console.log(`Loaded ${incoming.length} records from PR-List-new.json`);

  // Build a lookup of existing records keyed by "PR|Module" (case-insensitive module)
  const existing = await scanAllPRs();
  console.log(`Found ${existing.length} existing records in PRDetails`);

  const existingMap = new Map();
  for (const rec of existing) {
    const key = `${rec.PR}|${(rec.Module || '').toLowerCase()}`;
    existingMap.set(key, rec);
  }

  let inserted = 0, updated = 0, skipped = 0;
  const duplicatesInFile = new Map(); // track dupes within the JSON itself

  for (const row of incoming) {
    const prNum  = Number(row['PR Number']);
    const module = (row['Module'] || '').trim();
    const key    = `${prNum}|${module.toLowerCase()}`;

    // Deduplicate within the JSON file itself (keep first occurrence)
    if (duplicatesInFile.has(key)) {
      console.log(`  SKIP (duplicate in file): PR #${prNum} / ${module}`);
      skipped++;
      continue;
    }
    duplicatesInFile.set(key, true);

    const item = {
      PR:               prNum,
      Module:           module || null,
      Developer:        row['Developer'] || null,
      Status:           row['Status'] || null,
      'PR Raised Date': normalizeDate(row['PR Raised Date']),
      'PR Merged Date': normalizeDate(row['PR Merged Date']),
      Target_Release:   row['Target Release Date'] || null,
      Type:             'Development',
      Page:             [],
      Reviewer:         null,
      'PR Approved Date': null,
      Dev_Sprint:       null,
      Testing_Sprint:   null,
      Dependent_PRs:    [],
      PR_Comments:      [],
    };

    const existing_rec = existingMap.get(key);
    if (existing_rec) {
      // Update: preserve id, PR_Comments, and any fields not in the JSON
      const updated_item = {
        ...existing_rec,
        Developer:        item.Developer,
        Status:           item.Status,
        'PR Raised Date': item['PR Raised Date'],
        'PR Merged Date': item['PR Merged Date'],
        Target_Release:   item.Target_Release,
      };
      await docClient.send(new PutCommand({ TableName: 'PRDetails', Item: updated_item }));
      console.log(`  UPDATE: PR #${prNum} / ${module}`);
      updated++;
    } else {
      // Insert new record with fresh UUID
      await docClient.send(new PutCommand({
        TableName: 'PRDetails',
        Item: { ...item, id: randomUUID() },
      }));
      console.log(`  INSERT: PR #${prNum} / ${module}`);
      inserted++;
    }
  }

  console.log(`\nDone. Inserted: ${inserted}  Updated: ${updated}  Skipped (dupes in file): ${skipped}`);
}

main().catch(err => { console.error('Import failed:', err.message); process.exit(1); });
