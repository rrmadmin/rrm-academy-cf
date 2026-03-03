/**
 * Airtable Pipeline Simulator
 *
 * Commands:
 *   snapshot  — save src/data/*.json as timestamped baseline
 *   validate  — check data integrity (no snapshot needed)
 *   dry-run   — run fetch scripts with --dry-run flag
 *   report    — diff current data vs latest snapshot
 *
 * Usage: node scripts/pipeline.mjs <command>
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, symlinkSync, unlinkSync, statSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DATA_DIR = join(PROJECT_ROOT, 'src', 'data');
const PIPELINE_DIR = join(PROJECT_ROOT, '.pipeline');
const SNAPSHOTS_DIR = join(PIPELINE_DIR, 'snapshots');
const LATEST_LINK = join(SNAPSHOTS_DIR, 'latest');

const DATA_FILES = ['articles.json', 'posts.json', 'faqs.json', 'courses.json'];
const MAX_SNAPSHOTS = 5;

// --- Utilities ---

function sha256(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function timestampDir() {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
}

// --- Snapshot ---

function snapshot() {
  const ts = timestampDir();
  const snapDir = join(SNAPSHOTS_DIR, ts);
  mkdirSync(snapDir, { recursive: true });

  const meta = { timestamp: new Date().toISOString(), files: {} };

  for (const file of DATA_FILES) {
    const src = join(DATA_DIR, file);
    if (!existsSync(src)) {
      console.warn(`  skip: ${file} (not found)`);
      continue;
    }
    const content = readFileSync(src, 'utf-8');
    writeFileSync(join(snapDir, file), content);
    const data = JSON.parse(content);
    const count = Array.isArray(data) ? data.length : Object.keys(data).length;
    const hash = createHash('sha256').update(content).digest('hex');
    meta.files[file] = { count, sha256: hash, bytes: Buffer.byteLength(content) };
    console.log(`  ${file}: ${count} records (${(Buffer.byteLength(content) / 1024).toFixed(0)} KB)`);
  }

  writeFileSync(join(snapDir, 'meta.json'), JSON.stringify(meta, null, 2));

  // Update latest symlink
  try { unlinkSync(LATEST_LINK); } catch {}
  symlinkSync(ts, LATEST_LINK);

  console.log(`\nSnapshot saved: .pipeline/snapshots/${ts}`);

  pruneOldSnapshots(MAX_SNAPSHOTS);
}

function pruneOldSnapshots(keepCount) {
  if (!existsSync(SNAPSHOTS_DIR)) return;
  const entries = readdirSync(SNAPSHOTS_DIR)
    .filter(e => e !== 'latest' && statSync(join(SNAPSHOTS_DIR, e)).isDirectory())
    .sort();

  if (entries.length <= keepCount) return;

  const toRemove = entries.slice(0, entries.length - keepCount);
  for (const dir of toRemove) {
    rmSync(join(SNAPSHOTS_DIR, dir), { recursive: true });
    console.log(`  pruned: ${dir}`);
  }
}

// --- Validate ---

function validate() {
  let errors = 0;
  let warnings = 0;

  function err(msg) { console.error(`  ERROR: ${msg}`); errors++; }
  function warn(msg) { console.warn(`  WARN:  ${msg}`); warnings++; }

  // Check all data files exist and are non-empty arrays
  for (const file of DATA_FILES) {
    const path = join(DATA_DIR, file);
    if (!existsSync(path)) {
      err(`${file} missing`);
      continue;
    }
    const data = loadJson(path);
    if (!Array.isArray(data)) {
      err(`${file} is not an array`);
      continue;
    }
    if (data.length === 0) {
      err(`${file} is empty array (deploy guard will reject)`);
    }
  }

  // Articles validation
  const articlesPath = join(DATA_DIR, 'articles.json');
  if (existsSync(articlesPath)) {
    const articles = loadJson(articlesPath);
    if (Array.isArray(articles)) {
      const slugs = new Set();
      for (const a of articles) {
        if (!a.slug) err(`articles: record ${a.id} missing slug`);
        if (!a.title) err(`articles: record ${a.id} missing title`);
        if (a.slug && slugs.has(a.slug)) err(`articles: duplicate slug "${a.slug}"`);
        if (a.slug) slugs.add(a.slug);
      }
      console.log(`  articles.json: ${articles.length} records, ${slugs.size} unique slugs`);
    }
  }

  // Posts validation
  const postsPath = join(DATA_DIR, 'posts.json');
  if (existsSync(postsPath)) {
    const posts = loadJson(postsPath);
    if (Array.isArray(posts)) {
      const slugs = new Set();
      for (const p of posts) {
        if (!p.slug) err(`posts: record ${p.id} missing slug`);
        if (!p.title) err(`posts: record ${p.id} missing title`);
        if (!p.content) warn(`posts: "${p.slug}" has no content`);
        if (p.slug && slugs.has(p.slug)) err(`posts: duplicate slug "${p.slug}"`);
        if (p.slug) slugs.add(p.slug);
      }
      console.log(`  posts.json: ${posts.length} records, ${slugs.size} unique slugs`);
    }
  }

  // FAQs validation
  const faqsPath = join(DATA_DIR, 'faqs.json');
  if (existsSync(faqsPath)) {
    const faqs = loadJson(faqsPath);
    if (Array.isArray(faqs)) {
      const slugs = new Set();
      for (const f of faqs) {
        if (!f.slug) err(`faqs: record ${f.id} missing slug`);
        if (!f.question) err(`faqs: record ${f.id} missing question`);
        if (f.slug && slugs.has(f.slug)) err(`faqs: duplicate slug "${f.slug}"`);
        if (f.slug) slugs.add(f.slug);
      }

      // Cross-reference: libraryRefs should point to real article slugs
      if (existsSync(articlesPath)) {
        const articles = loadJson(articlesPath);
        const articleSlugs = new Set(articles.map(a => a.slug).filter(Boolean));
        let danglingCount = 0;
        for (const f of faqs) {
          for (const ref of (f.libraryRefs || [])) {
            if (!articleSlugs.has(ref.slug)) {
              warn(`faqs: "${f.faqId}" references unknown article slug "${ref.slug}"`);
              danglingCount++;
            }
          }
        }
        if (danglingCount === 0) {
          console.log(`  faqs.json: all libraryRefs resolve to valid article slugs`);
        }
      }
      console.log(`  faqs.json: ${faqs.length} records, ${slugs.size} unique slugs`);
    }
  }

  // Courses validation
  const coursesPath = join(DATA_DIR, 'courses.json');
  if (existsSync(coursesPath)) {
    const courses = loadJson(coursesPath);
    if (Array.isArray(courses)) {
      for (const c of courses) {
        if (!c.slug) err(`courses: record ${c.id} missing slug`);
        if (!c.title) err(`courses: record ${c.id} missing title`);
        if (!c.comingSoon) {
          const stepCount = (c.sections || []).reduce((sum, s) => sum + (s.steps || []).length, 0);
          if (stepCount === 0) err(`courses: "${c.id}" has 0 steps (not comingSoon)`);
        }
      }
      console.log(`  courses.json: ${courses.length} courses`);
    }
  }

  // Size regression guard (compare to latest snapshot)
  if (existsSync(LATEST_LINK)) {
    const metaPath = join(LATEST_LINK, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = loadJson(metaPath);
      for (const file of DATA_FILES) {
        const current = join(DATA_DIR, file);
        if (!existsSync(current) || !meta.files[file]) continue;
        const currentSize = statSync(current).size;
        const snapSize = meta.files[file].bytes;
        if (snapSize > 0) {
          const ratio = currentSize / snapSize;
          if (ratio < 0.9) {
            err(`${file} shrank ${((1 - ratio) * 100).toFixed(0)}% vs snapshot (${snapSize} -> ${currentSize} bytes)`);
          }
        }
      }
    }
  }

  console.log(`\nValidation: ${errors} error(s), ${warnings} warning(s)`);
  if (errors > 0) process.exit(1);
}

// --- Dry Run ---

function dryRun() {
  const scripts = [
    { name: 'fetch-data', path: 'src/lib/fetch-data.mjs' },
    { name: 'fetch-blog', path: 'src/lib/fetch-blog-data.mjs' },
    { name: 'fetch-faqs', path: 'src/lib/fetch-faq-data.mjs' },
    { name: 'fetch-courses', path: 'src/lib/fetch-courses-data.mjs' },
  ];

  for (const script of scripts) {
    const fullPath = join(PROJECT_ROOT, script.path);
    console.log(`\n--- ${script.name} ---`);
    try {
      execSync(`node "${fullPath}" --dry-run`, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        timeout: 30000,
      });
    } catch (e) {
      console.error(`${script.name} failed: ${e.message}`);
      process.exit(1);
    }
  }

  console.log('\nDry run complete. All 4 scripts ran with fixture data.');
}

// --- Report ---

function diffRecords(oldArr, newArr, idField = 'id') {
  const oldMap = new Map(oldArr.map(r => [r[idField], r]));
  const newMap = new Map(newArr.map(r => [r[idField], r]));

  const added = [];
  const removed = [];
  const modified = [];

  for (const [id, rec] of newMap) {
    if (!oldMap.has(id)) {
      added.push(rec);
    } else {
      const oldRec = oldMap.get(id);
      const changes = {};
      const allKeys = new Set([...Object.keys(oldRec), ...Object.keys(rec)]);
      for (const key of allKeys) {
        const oldVal = JSON.stringify(oldRec[key]);
        const newVal = JSON.stringify(rec[key]);
        if (oldVal !== newVal) {
          changes[key] = { old: oldRec[key], new: rec[key] };
        }
      }
      if (Object.keys(changes).length > 0) {
        modified.push({ id, slug: rec.slug || rec.faqId || id, changes });
      }
    }
  }

  for (const [id, rec] of oldMap) {
    if (!newMap.has(id)) {
      removed.push(rec);
    }
  }

  return { added, removed, modified };
}

function report() {
  if (!existsSync(LATEST_LINK)) {
    console.error('No snapshot found. Run: npm run pipeline:snapshot');
    process.exit(1);
  }

  const reportData = { timestamp: new Date().toISOString(), files: {} };

  for (const file of DATA_FILES) {
    const snapPath = join(LATEST_LINK, file);
    const currentPath = join(DATA_DIR, file);

    if (!existsSync(snapPath)) {
      console.log(`\n${file}: no snapshot (skipped)`);
      continue;
    }
    if (!existsSync(currentPath)) {
      console.log(`\n${file}: MISSING from src/data/`);
      reportData.files[file] = { status: 'missing' };
      continue;
    }

    // Quick hash check
    const snapHash = sha256(snapPath);
    const currentHash = sha256(currentPath);
    if (snapHash === currentHash) {
      console.log(`\n${file}: unchanged`);
      reportData.files[file] = { status: 'unchanged' };
      continue;
    }

    const oldData = loadJson(snapPath);
    const newData = loadJson(currentPath);

    if (!Array.isArray(oldData) || !Array.isArray(newData)) {
      console.log(`\n${file}: changed (non-array, skipping diff)`);
      reportData.files[file] = { status: 'changed' };
      continue;
    }

    const diff = diffRecords(oldData, newData);

    console.log(`\n${file}:`);
    console.log(`  records: ${oldData.length} -> ${newData.length}`);
    if (diff.added.length > 0) {
      console.log(`  + ${diff.added.length} added`);
      for (const r of diff.added.slice(0, 5)) {
        console.log(`    + ${r.slug || r.faqId || r.id}`);
      }
      if (diff.added.length > 5) console.log(`    ... and ${diff.added.length - 5} more`);
    }
    if (diff.removed.length > 0) {
      console.log(`  - ${diff.removed.length} removed`);
      for (const r of diff.removed.slice(0, 5)) {
        console.log(`    - ${r.slug || r.faqId || r.id}`);
      }
      if (diff.removed.length > 5) console.log(`    ... and ${diff.removed.length - 5} more`);
    }
    if (diff.modified.length > 0) {
      console.log(`  ~ ${diff.modified.length} modified`);
      for (const m of diff.modified.slice(0, 5)) {
        const fields = Object.keys(m.changes).join(', ');
        console.log(`    ~ ${m.slug}: [${fields}]`);
      }
      if (diff.modified.length > 5) console.log(`    ... and ${diff.modified.length - 5} more`);
    }

    reportData.files[file] = {
      status: 'changed',
      oldCount: oldData.length,
      newCount: newData.length,
      added: diff.added.length,
      removed: diff.removed.length,
      modified: diff.modified.length,
      details: {
        added: diff.added.map(r => r.slug || r.faqId || r.id),
        removed: diff.removed.map(r => r.slug || r.faqId || r.id),
        modified: diff.modified.map(m => ({ id: m.id, slug: m.slug, fields: Object.keys(m.changes) })),
      },
    };
  }

  mkdirSync(PIPELINE_DIR, { recursive: true });
  writeFileSync(join(PIPELINE_DIR, 'report.json'), JSON.stringify(reportData, null, 2));
  console.log(`\nReport written to .pipeline/report.json`);
}

// --- CLI ---

const command = process.argv[2];

switch (command) {
  case 'snapshot':
    console.log('Creating snapshot...\n');
    snapshot();
    break;
  case 'validate':
    console.log('Validating data...\n');
    validate();
    break;
  case 'dry-run':
    console.log('Running dry-run...');
    dryRun();
    break;
  case 'report':
    console.log('Generating report...');
    report();
    break;
  default:
    console.error(`Usage: node scripts/pipeline.mjs <snapshot|validate|dry-run|report>`);
    process.exit(1);
}
