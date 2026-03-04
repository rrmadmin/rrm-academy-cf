/**
 * Airtable Pipeline Simulator
 *
 * Commands:
 *   snapshot  — save src/data/*.json as timestamped baseline
 *   validate  — check data integrity (no snapshot needed)
 *   dry-run   — run fetch scripts with --dry-run flag
 *   report    — diff current data vs latest snapshot
 *   status    — deploy chain health, enrichment counts, automation status
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

// --- Sources Registry ---
// Encodes the full pipeline chain for each data source.

const SOURCES = [
  {
    name: 'Library',
    file: 'articles.json',
    fetchScript: 'src/lib/fetch-data.mjs',
    airtable: {
      greenBaseId: 'appyZWo2G7iByXCgZ',
      greenBaseName: 'BIFID (greenbase)',
      bifidTableId: 'tbloxbruSGmhZ23BC',
      wikiTableId: 'tblQj2nqDpbp2058Z',
      enrichmentField: 'Enrichment Status',
      wikiEnrichField: '🔄 Enrich',
      yellowBaseId: 'app78UTVdeFph9qhL',
      yellowBaseName: 'Library (yellowbase)',
      yellowTableId: 'tblbfEaSKygpzSoSq',
    },
    automation: {
      type: 'webhook_relay',
      chain: [
        'Airtable automation POSTs to CF Worker',
        'CF Worker validates X-Deploy-Secret',
        'CF Worker fires repository_dispatch to GitHub',
      ],
      webhookUrl: 'https://rrmacademy.org/api/library/deploy-record',
      workerFile: 'functions/api/library/deploy-record.js',
      cfSecrets: ['DEPLOY_SECRET', 'GITHUB_DEPLOY_TOKEN'],
      repo: 'rrmadmin/rrm-academy-cf',
      eventType: 'publish',
    },
  },
  {
    name: 'Blog',
    file: 'posts.json',
    fetchScript: 'src/lib/fetch-blog-data.mjs',
    airtable: {
      baseId: 'app1CKV1heL0qH2Oz',
      baseName: 'Blog',
    },
    automation: {
      type: 'repository_dispatch',
      repo: 'rrmadmin/rrm-academy-cf',
      eventType: 'publish',
      airtableSecret: 'gitPAT',
    },
  },
  {
    name: 'FAQs',
    file: 'faqs.json',
    fetchScript: 'src/lib/fetch-faq-data.mjs',
    airtable: {
      baseId: 'appIiligSFffFWwGA',
      baseName: 'FAQs',
    },
    automation: {
      type: 'repository_dispatch',
      repo: 'rrmadmin/rrm-academy-cf',
      eventType: 'publish',
      airtableSecret: 'gitPAT',
    },
  },
  {
    name: 'Courses',
    file: 'courses.json',
    fetchScript: 'src/lib/fetch-courses-data.mjs',
    airtable: {
      baseId: 'app0nohI0WrgFWOE3',
      baseName: 'Courses',
    },
    automation: null, // No automation -- manual deploy only
  },
];

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

// --- Status ---

const STATUS_TIMEOUT_MS = 10000;

async function timedFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), STATUS_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function status() {
  const human = process.argv.includes('--human');
  const result = {
    timestamp: new Date().toISOString(),
    ok: true,
    checks: { pass: 0, fail: 0, skip: 0 },
    sources: [],
    snapshot: null,
    deployChain: {},
    automation: [],
  };

  function pass(key, detail) { result.checks.pass++; return { status: 'pass', detail }; }
  function fail(key, detail) { result.checks.fail++; result.ok = false; return { status: 'fail', detail }; }
  function skip(key, detail) { result.checks.skip++; return { status: 'skip', detail }; }

  // A. Data sources (local only)
  for (const src of SOURCES) {
    const p = join(DATA_DIR, src.file);
    const entry = { name: src.name, file: src.file };
    if (!existsSync(p)) {
      entry.records = 0;
      entry.check = fail('data', `${src.file} missing`);
    } else {
      const data = loadJson(p);
      entry.records = Array.isArray(data) ? data.length : 0;
      entry.check = entry.records > 0
        ? pass('data', `${entry.records} records`)
        : fail('data', 'empty array');
    }
    result.sources.push(entry);
  }

  // Snapshot
  if (existsSync(LATEST_LINK)) {
    const metaPath = join(LATEST_LINK, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = loadJson(metaPath);
      const ageMin = Math.round((Date.now() - new Date(meta.timestamp).getTime()) / 60000);
      result.snapshot = { timestamp: meta.timestamp, ageMinutes: ageMin };
    }
  }

  // B. Deploy chain
  // B1. Workflow file
  const workflowPath = join(PROJECT_ROOT, '.github', 'workflows', 'deploy.yml');
  if (existsSync(workflowPath)) {
    const wf = readFileSync(workflowPath, 'utf-8');
    const hasDispatch = wf.includes('repository_dispatch') && wf.includes('publish');
    result.deployChain.workflow = hasDispatch
      ? pass('workflow', 'repository_dispatch "publish" configured')
      : fail('workflow', 'missing repository_dispatch or publish type');
  } else {
    result.deployChain.workflow = fail('workflow', 'deploy.yml missing');
  }

  // B2. CF Worker file
  const workerPath = join(PROJECT_ROOT, 'functions', 'api', 'library', 'deploy-record.js');
  result.deployChain.workerFile = existsSync(workerPath)
    ? pass('workerFile', 'exists')
    : fail('workerFile', 'missing');

  // B3. CF Worker probe (POST with no auth -> expect 401 = alive)
  try {
    const probeRes = await timedFetch('https://rrmacademy.org/api/library/deploy-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    result.deployChain.workerProbe = probeRes.status === 401
      ? pass('workerProbe', '401 (alive)')
      : fail('workerProbe', `${probeRes.status} (unexpected)`);
  } catch (e) {
    result.deployChain.workerProbe = fail('workerProbe', e.name === 'AbortError' ? 'timeout' : e.message);
  }

  // B4. CF Pages secrets via Cloudflare API (not wrangler -- wrangler can hang on interactive auth)
  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const cfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (cfToken && cfAccount) {
    try {
      const cfRes = await timedFetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/pages/projects/rrm-academy`,
        { headers: { Authorization: `Bearer ${cfToken}` } },
      );
      if (!cfRes.ok) throw new Error(`CF API ${cfRes.status}`);
      const cfBody = await cfRes.json();
      const prodEnv = cfBody.result?.deployment_configs?.production?.env_vars || {};
      const secretNames = Object.keys(prodEnv);
      const hasDeploy = secretNames.includes('DEPLOY_SECRET');
      const hasGithub = secretNames.includes('GITHUB_DEPLOY_TOKEN');
      if (hasDeploy && hasGithub) {
        result.deployChain.cfSecrets = pass('cfSecrets', 'DEPLOY_SECRET + GITHUB_DEPLOY_TOKEN');
      } else {
        const missing = [!hasDeploy && 'DEPLOY_SECRET', !hasGithub && 'GITHUB_DEPLOY_TOKEN'].filter(Boolean);
        result.deployChain.cfSecrets = fail('cfSecrets', `missing: ${missing.join(', ')}`);
      }
    } catch (e) {
      result.deployChain.cfSecrets = fail('cfSecrets', e.message);
    }
  } else {
    result.deployChain.cfSecrets = skip('cfSecrets', 'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set');
  }

  // B5. Last GitHub Actions run
  try {
    const ghJson = execSync(
      'gh api repos/rrmadmin/rrm-academy-cf/actions/runs?per_page=1 --jq ".workflow_runs[0]"',
      { encoding: 'utf-8', timeout: STATUS_TIMEOUT_MS },
    ).trim();
    const run = JSON.parse(ghJson);
    result.deployChain.lastRun = {
      ...pass('lastRun', `#${run.id} ${run.conclusion} via ${run.event}`),
      id: run.id,
      conclusion: run.conclusion,
      event: run.event,
      created_at: run.created_at,
    };
  } catch (e) {
    result.deployChain.lastRun = skip('lastRun', 'gh CLI unavailable');
  }

  // C. Automation summary
  for (const src of SOURCES) {
    const auto = src.automation;
    result.automation.push({
      name: src.name,
      type: auto?.type || null,
      detail: auto
        ? (auto.type === 'webhook_relay'
          ? 'CF Worker -> GitHub dispatch'
          : `repository_dispatch (${auto.airtableSecret} -> GitHub)`)
        : 'no automation (manual deploy)',
    });
  }

  // Output
  if (human) {
    printHuman(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }

  if (!result.ok) process.exit(1);
}

function printHuman(r) {
  console.log('Pipeline Status');
  console.log('===============\n');

  console.log('Data Sources:');
  for (const s of r.sources) {
    const icon = s.check.status === 'pass' ? 'ok' : 'FAIL';
    console.log(`  ${s.name.padEnd(12)} ${s.file.padEnd(20)} ${String(s.records).padStart(5)} records  ${icon}`);
  }

  console.log('\nDeploy Chain:');
  const dc = r.deployChain;
  for (const [key, check] of Object.entries(dc)) {
    if (key === 'lastRun' && check.id) {
      console.log(`  ${key.padEnd(16)} #${check.id} ${check.conclusion} ${check.created_at} via ${check.event}`);
    } else {
      const icon = check.status === 'pass' ? 'ok' : check.status === 'skip' ? 'SKIP' : 'FAIL';
      console.log(`  ${key.padEnd(16)} ${check.detail}  ${icon}`);
    }
  }

  console.log('\nAutomation:');
  for (const a of r.automation) {
    const icon = a.type ? '' : '!!';
    console.log(`  ${a.name.padEnd(12)} ${a.detail}  ${icon}`);
  }

  if (r.snapshot) {
    const ago = r.snapshot.ageMinutes < 60
      ? `${r.snapshot.ageMinutes}m ago`
      : `${Math.round(r.snapshot.ageMinutes / 60)}h ago`;
    console.log(`\nSnapshot:        ${r.snapshot.timestamp} (${ago})`);
  } else {
    console.log('\nSnapshot:        none');
  }

  console.log(`\nResult:          ${r.checks.pass} pass, ${r.checks.fail} fail, ${r.checks.skip} skip${r.ok ? '' : '  EXIT 1'}`);
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
  case 'status':
    await status();
    break;
  default:
    console.error(`Usage: node scripts/pipeline.mjs <snapshot|validate|dry-run|report|status>`);
    process.exit(1);
}
