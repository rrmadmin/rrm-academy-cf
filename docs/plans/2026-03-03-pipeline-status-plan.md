# Pipeline Status Command — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `npm run pipeline:status` that answers "will my Airtable change auto-deploy?" by verifying the full deploy chain from Airtable through CF Worker through GitHub Actions to Cloudflare Pages.

**Architecture:** A `SOURCES` registry encodes institutional knowledge about all 4 data sources (Library, Blog, FAQs, Courses) and their deploy automation chains. An async `status()` function runs local checks first, then live probes (CF Worker endpoint, CF Pages secrets via Cloudflare API, GitHub Actions last run, Airtable enrichment counts). Every external check is wrapped in try/catch for graceful degradation.

**Tech Stack:** Node.js ESM, native `fetch()` (Node 20+), `child_process.execSync` for `gh` CLI, Cloudflare API for Pages secrets.

---

## Background Context

### The 4 Deploy Chains

**Library (7 hops — most fragile):**
```
Wiki (Add) table → Airtable automation creates BIFID shell
  → Enrichment pipeline (metadata + AI, runs in ~/iCode/scripts/rrm-library/)
  → Editor sets "Sync to RRM Library" = "Synced" on BIFID record
  → Green-to-yellow Airtable base-to-base sync
  → Yellowbase automation POSTs to CF Worker at /api/library/deploy-record
  → CF Worker validates X-Deploy-Secret header, fires repository_dispatch
  → GitHub Actions: fetch-all → build → wrangler pages deploy
```

The CF Worker relay is at `functions/api/library/deploy-record.js`. It needs two CF Pages secrets: `DEPLOY_SECRET` (auth from Airtable) and `GITHUB_DEPLOY_TOKEN` (auth to GitHub API).

**Blog (2 hops):** Airtable automation (Status='Published') fires `repository_dispatch` via `gitPAT` workspace secret directly to GitHub.

**FAQs (2 hops):** Same pattern as Blog. Airtable automation (Answer Status='Published') fires `repository_dispatch` via `gitPAT`.

**Courses (0 hops):** No automation configured. Manual deploy only.

### Airtable Base IDs

| Source | Base ID | Base Name |
|--------|---------|-----------|
| Library (green/enrichment) | `appyZWo2G7iByXCgZ` | BIFID greenbase |
| Library (yellow/public) | `app78UTVdeFph9qhL` | ⚡️ Library yellowbase |
| Blog | `app1CKV1heL0qH2Oz` | Editorial Commentary Blog |
| FAQs | `appIiligSFffFWwGA` | FAQ Knowledge Base |
| Courses | `app0nohI0WrgFWOE3` | RRM Courses |

### Airtable Table IDs (for enrichment queries)

| Table | ID | Base |
|-------|----|------|
| BIFID | `tbloxbruSGmhZ23BC` | greenbase |
| Wiki (Add) | `tblQj2nqDpbp2058Z` | greenbase |
| ⚡️ Synced Literature | `tblbfEaSKygpzSoSq` | yellowbase |

### Key Fields for Enrichment Queries

- BIFID `Enrichment Status` — single select: `3-tertiary`, `2-secondary`, `1-primary`, `non-journal-source`, `napro-chapter`, `incomplete`, `failed`, `duplicate-detected`
- BIFID `Sync to RRM Library` — single select: `Synced` (means published to yellow)
- Wiki `🔄 Enrich` — single select: `Queued`, `Running`, `Done`, `Error`

### GitHub and CF Details

- Repo: `rrmadmin/rrm-academy-cf`
- CF Pages project: `rrm-academy`
- CF Account ID: `ecf2c5bc8b5ebd634bcb587b3890910a`
- Workflow file: `.github/workflows/deploy.yml` — accepts `repository_dispatch types: [publish]`
- CF Worker endpoint: `https://rrmacademy.org/api/library/deploy-record`

---

## Task 1: Add SOURCES Registry

**Files:**
- Modify: `scripts/pipeline.mjs:1-27` (add registry after existing constants)

**Step 1: Add the SOURCES array after line 27 (after `const MAX_SNAPSHOTS = 5;`)**

Insert this block at `scripts/pipeline.mjs` between the existing constants and the `// --- Utilities ---` comment:

```javascript
// --- Source Registry ---
// Encodes the full deploy chain for each Airtable data source.
// Used by the `status` command to verify deploy readiness.

const SOURCES = [
  {
    name: 'Library',
    file: 'articles.json',
    fetchScript: 'src/lib/fetch-data.mjs',
    airtable: {
      greenBaseId: 'appyZWo2G7iByXCgZ',
      bifidTableId: 'tbloxbruSGmhZ23BC',
      wikiTableId: 'tblQj2nqDpbp2058Z',
      yellowBaseId: 'app78UTVdeFph9qhL',
      yellowTableId: 'tblbfEaSKygpzSoSq',
      publishField: 'Sync to RRM Library',
      publishValue: 'Synced',
    },
    automation: {
      type: 'webhook_relay',
      chain: [
        'Airtable → CF Worker /api/library/deploy-record',
        'CF Worker validates X-Deploy-Secret',
        'CF Worker → GitHub repository_dispatch "publish"',
      ],
      probeUrl: 'https://rrmacademy.org/api/library/deploy-record',
      workerFile: 'functions/api/library/deploy-record.js',
      cfSecrets: ['DEPLOY_SECRET', 'GITHUB_DEPLOY_TOKEN'],
    },
  },
  {
    name: 'Blog',
    file: 'posts.json',
    fetchScript: 'src/lib/fetch-blog-data.mjs',
    airtable: {
      baseId: 'app1CKV1heL0qH2Oz',
      publishField: 'Status',
      publishValue: 'Published',
    },
    automation: {
      type: 'repository_dispatch',
      chain: ['Airtable → GitHub repository_dispatch "publish" via gitPAT'],
    },
  },
  {
    name: 'FAQs',
    file: 'faqs.json',
    fetchScript: 'src/lib/fetch-faq-data.mjs',
    airtable: {
      baseId: 'appIiligSFffFWwGA',
      publishField: 'Answer Status',
      publishValue: 'Published',
    },
    automation: {
      type: 'repository_dispatch',
      chain: ['Airtable → GitHub repository_dispatch "publish" via gitPAT'],
    },
  },
  {
    name: 'Courses',
    file: 'courses.json',
    fetchScript: 'src/lib/fetch-courses-data.mjs',
    airtable: {
      baseId: 'app0nohI0WrgFWOE3',
      publishField: 'Status',
      publishValue: 'Published',
    },
    automation: null,
  },
];

const GITHUB_REPO = 'rrmadmin/rrm-academy-cf';
const CF_PAGES_PROJECT = 'rrm-academy';
const CF_ACCOUNT_ID = 'ecf2c5bc8b5ebd634bcb587b3890910a';
```

**Step 2: Verify no syntax errors**

Run: `node -c scripts/pipeline.mjs`
Expected: no output (clean parse)

**Step 3: Verify existing commands still work**

Run: `npm run pipeline:validate`
Expected: same output as before, no regressions

---

## Task 2: Add status() Function — Local Checks

**Files:**
- Modify: `scripts/pipeline.mjs` (add `status()` function before `// --- CLI ---` section at line 382)

**Step 1: Add the status function skeleton with local data checks**

Insert before the `// --- CLI ---` comment:

```javascript
// --- Status ---

async function status() {
  console.log('Pipeline Status');
  console.log('===============\n');

  // --- A. Local data health ---
  console.log('Data Sources:');
  for (const src of SOURCES) {
    const filePath = join(DATA_DIR, src.file);
    let count = '?';
    if (existsSync(filePath)) {
      const data = loadJson(filePath);
      count = Array.isArray(data) ? data.length : '?';
    } else {
      count = 'MISSING';
    }
    const autoLabel = src.automation
      ? (src.automation.type === 'webhook_relay' ? 'webhook relay' : 'repository_dispatch')
      : 'NO AUTOMATION';
    const marker = src.automation ? '' : ' !!';
    console.log(`  ${src.name.padEnd(12)} ${src.file.padEnd(18)} ${String(count).padStart(5)} records   ${autoLabel}${marker}`);
  }

  // Snapshot age
  if (existsSync(LATEST_LINK)) {
    const metaPath = join(LATEST_LINK, 'meta.json');
    if (existsSync(metaPath)) {
      const meta = loadJson(metaPath);
      const age = Date.now() - new Date(meta.timestamp).getTime();
      const ageStr = age < 3600000
        ? `${Math.round(age / 60000)}m ago`
        : `${Math.round(age / 3600000)}h ago`;
      console.log(`\n  Snapshot:      ${meta.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '')} (${ageStr})`);
    }
  } else {
    console.log('\n  Snapshot:      none (run: npm run pipeline:snapshot)');
  }
```

**Step 2: Add deploy chain verification (workflow file check)**

Continue the function:

```javascript
  // --- B. Deploy chain ---
  console.log('\nDeploy Chain:');

  // Check deploy.yml
  const workflowPath = join(PROJECT_ROOT, '.github', 'workflows', 'deploy.yml');
  if (existsSync(workflowPath)) {
    const yml = readFileSync(workflowPath, 'utf-8');
    const hasDispatch = yml.includes('repository_dispatch');
    const hasPublish = yml.includes('publish');
    if (hasDispatch && hasPublish) {
      console.log('  Workflow:      .github/workflows/deploy.yml  (repository_dispatch "publish" OK)');
    } else {
      console.log('  Workflow:      .github/workflows/deploy.yml  !! missing repository_dispatch or publish type');
    }
  } else {
    console.log('  Workflow:      !! deploy.yml not found');
  }

  // Check CF Worker file exists (Library relay)
  const libSource = SOURCES.find(s => s.name === 'Library');
  if (libSource && libSource.automation?.workerFile) {
    const workerPath = join(PROJECT_ROOT, libSource.automation.workerFile);
    if (existsSync(workerPath)) {
      console.log(`  CF Worker:     ${libSource.automation.workerFile}  (exists)`);
    } else {
      console.log(`  CF Worker:     !! ${libSource.automation.workerFile} NOT FOUND`);
    }
  }
```

**Step 3: Add CF Worker probe (live HTTP check)**

```javascript
  // Probe CF Worker endpoint — POST without secret, expect 401
  if (libSource?.automation?.probeUrl) {
    try {
      const probeRes = await fetch(libSource.automation.probeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10000),
      });
      if (probeRes.status === 401) {
        console.log(`  Worker probe:  ${libSource.automation.probeUrl}  -> 401 (alive, auth OK)`);
      } else if (probeRes.status === 500) {
        console.log(`  Worker probe:  -> 500 !! (DEPLOY_SECRET may not be configured)`);
      } else {
        console.log(`  Worker probe:  -> ${probeRes.status} !! (unexpected)`);
      }
    } catch (e) {
      console.log(`  Worker probe:  !! failed (${e.message})`);
    }
  }
```

**Step 4: Add CF Pages secrets check via Cloudflare API**

```javascript
  // Check CF Pages secrets via wrangler
  if (libSource?.automation?.cfSecrets) {
    try {
      const secretsOut = execSync(
        `npx wrangler pages secret list --project-name ${CF_PAGES_PROJECT} 2>/dev/null`,
        { encoding: 'utf-8', timeout: 15000 }
      ).trim();
      const missing = [];
      for (const secret of libSource.automation.cfSecrets) {
        if (secretsOut.includes(secret)) {
          console.log(`  CF Secret:     ${secret}  (set)`);
        } else {
          console.log(`  CF Secret:     ${secret}  !! NOT FOUND`);
          missing.push(secret);
        }
      }
    } catch (e) {
      console.log('  CF Secrets:    (skipped — wrangler not available)');
    }
  }
```

**Step 5: Add GitHub Actions last run check**

```javascript
  // GitHub Actions last run
  try {
    const ghOut = execSync(
      `gh api repos/${GITHUB_REPO}/actions/runs?per_page=1 --jq '.workflow_runs[0] | "id=\\(.id) status=\\(.status) event=\\(.event) created=\\(.created_at)"'`,
      { encoding: 'utf-8', timeout: 10000 }
    ).trim();
    if (ghOut) {
      const parts = Object.fromEntries(ghOut.split(' ').map(p => p.split('=')));
      const age = Date.now() - new Date(parts.created).getTime();
      const ageStr = age < 3600000
        ? `${Math.round(age / 60000)}m ago`
        : `${Math.round(age / 3600000)}h ago`;
      console.log(`  Last GH run:   #${parts.id} ${parts.status} via ${parts.event} (${ageStr})`);
    }
  } catch (e) {
    console.log('  Last GH run:   (skipped — gh CLI not available)');
  }
```

**Step 6: Verify the function runs**

Run: `node scripts/pipeline.mjs status`
Expected: Output showing data sources, deploy chain checks (should show actual results for workflow, CF Worker probe, secrets, GH Actions)

---

## Task 3: Add Airtable Enrichment Checks (Library-specific)

**Files:**
- Modify: `scripts/pipeline.mjs` (extend `status()` function)

**Step 1: Add enrichment status query**

Continue the `status()` function, after the deploy chain section:

```javascript
  // --- C. Library enrichment status (requires AIRTABLE_PAT) ---
  const pat = process.env.AIRTABLE_PAT;
  if (pat && libSource) {
    console.log('\nLibrary Enrichment:');
    const at = libSource.airtable;
    const headers = { Authorization: `Bearer ${pat}` };

    // Count BIFID records by Enrichment Status
    try {
      const statusCounts = {};
      let syncedCount = 0;
      let totalBifid = 0;
      let offset;
      do {
        const url = `https://api.airtable.com/v0/${at.greenBaseId}/${at.bifidTableId}?fields[]=Enrichment+Status&fields[]=Sync+to+RRM+Library&pageSize=100${offset ? '&offset=' + offset : ''}`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
        if (!res.ok) throw new Error(`Airtable ${res.status}`);
        const data = await res.json();
        offset = data.offset;
        for (const rec of data.records) {
          totalBifid++;
          const es = rec.fields['Enrichment Status'] || 'blank';
          statusCounts[es] = (statusCounts[es] || 0) + 1;
          if (rec.fields['Sync to RRM Library'] === 'Synced') syncedCount++;
        }
      } while (offset);

      console.log(`  BIFID:         ${totalBifid} total`);
      const order = ['3-tertiary', '2-secondary', 'non-journal-source', 'napro-chapter', '1-primary', 'incomplete', 'failed'];
      for (const s of order) {
        if (statusCounts[s]) {
          console.log(`    ${s.padEnd(20)} ${statusCounts[s]}`);
        }
      }
      // Show any statuses not in the standard order
      for (const [s, c] of Object.entries(statusCounts)) {
        if (!order.includes(s) && s !== 'blank') {
          console.log(`    ${s.padEnd(20)} ${c}`);
        }
      }

      console.log(`  Synced:        ${syncedCount} (of ${totalBifid})`);

      // Compare to local articles.json count
      const articlesPath = join(DATA_DIR, 'articles.json');
      if (existsSync(articlesPath)) {
        const localCount = loadJson(articlesPath).length;
        const diff = syncedCount - localCount;
        if (diff === 0) {
          console.log(`  Sync lag:      0 (in sync with articles.json)`);
        } else if (diff > 0) {
          console.log(`  Sync lag:      ${diff} records synced in Airtable but not yet in articles.json`);
        } else {
          console.log(`  Sync lag:      ${Math.abs(diff)} fewer synced than in articles.json !!`);
        }
      }
    } catch (e) {
      console.log(`  BIFID:         !! query failed (${e.message})`);
    }

    // Wiki enrichment queue
    try {
      const wikiUrl = `https://api.airtable.com/v0/${at.greenBaseId}/${at.wikiTableId}?filterByFormula=${encodeURIComponent("{🔄 Enrich}='Queued'")}&fields[]=🔄+Enrich&pageSize=1`;
      const res = await fetch(wikiUrl, { headers, signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        const queuedCount = data.records.length + (data.offset ? '+' : '');
        console.log(`  Wiki queue:    ${queuedCount} record(s) queued for enrichment`);
      }
    } catch (e) {
      console.log(`  Wiki queue:    !! query failed (${e.message})`);
    }
  } else if (!pat) {
    console.log('\nLibrary Enrichment:  (skipped — set AIRTABLE_PAT for enrichment status)');
  }
```

**Step 2: Add automation summary table**

```javascript
  // --- D. Automation summary ---
  console.log('\nAutomation Status:');
  for (const src of SOURCES) {
    if (!src.automation) {
      console.log(`  ${src.name.padEnd(12)} !! NO AUTOMATION — manual deploy only`);
    } else if (src.automation.type === 'webhook_relay') {
      console.log(`  ${src.name.padEnd(12)} webhook relay (CF Worker -> GitHub dispatch)`);
    } else {
      console.log(`  ${src.name.padEnd(12)} repository_dispatch (Airtable -> GitHub)`);
    }
  }

  console.log('');
}
```

**Step 3: Test with AIRTABLE_PAT**

Run: `source ~/.zshrc && AIRTABLE_PAT=$(op read 'op://Automation/<redacted>/credential') node scripts/pipeline.mjs status`
Expected: Full output including enrichment counts from greenbase

**Step 4: Test without AIRTABLE_PAT**

Run: `node scripts/pipeline.mjs status`
Expected: Enrichment section shows "(skipped)" message, everything else works

---

## Task 4: Wire CLI and Package.json

**Files:**
- Modify: `scripts/pipeline.mjs:382-406` (CLI switch)
- Modify: `package.json:20-24` (add script)

**Step 1: Update CLI switch to handle `status` command**

In `scripts/pipeline.mjs`, update the switch statement and make it async-aware:

Change the CLI section from:
```javascript
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
```

To:
```javascript
const command = process.argv[2];

async function main() {
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
      console.error('Usage: node scripts/pipeline.mjs <snapshot|validate|dry-run|report|status>');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

**Step 2: Update the header comment**

Change lines 3-8:
```javascript
 * Commands:
 *   snapshot  — save src/data/*.json as timestamped baseline
 *   validate  — check data integrity (no snapshot needed)
 *   dry-run   — run fetch scripts with --dry-run flag
 *   report    — diff current data vs latest snapshot
 *   status    — verify full deploy chain readiness
```

**Step 3: Add pipeline:status script to package.json**

Add after the `pipeline:validate` line:
```json
"pipeline:status": "node scripts/pipeline.mjs status",
```

**Step 4: Verify all existing commands still work**

Run:
```bash
npm run pipeline:validate
npm run pipeline:status
```

Expected: validate unchanged, status shows full output

---

## Task 5: Commit

**Step 1: Review changes**

Run: `git diff scripts/pipeline.mjs package.json`

**Step 2: Commit**

```bash
git add scripts/pipeline.mjs package.json docs/plans/2026-03-03-pipeline-status-design.md docs/plans/2026-03-03-pipeline-status-plan.md
git commit -m "feat: add pipeline:status command with deploy chain verification

Adds SOURCES registry encoding all 4 Airtable data source deploy chains.
New status command verifies: data health, deploy.yml config, CF Worker
endpoint, CF Pages secrets, GitHub Actions last run, and Library
enrichment counts (when AIRTABLE_PAT is set).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Verification Checklist

After all tasks complete:

1. `npm run pipeline:status` — full output, all sections
2. `AIRTABLE_PAT=xxx npm run pipeline:status` — enrichment section populated
3. `npm run pipeline:validate` — unchanged, no regressions
4. `npm run pipeline:snapshot` — unchanged
5. `npm run pipeline:report` — unchanged
6. `npm run pipeline:dry-run` — unchanged
7. `node -c scripts/pipeline.mjs` — no syntax errors
