# Ecosystem SSOT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a single `rrm-academy-ecosystem.json` that maps the entire RRM Academy system, stored in git + D1 + API endpoint.

**Architecture:** A manually-maintained JSON file in the repo is the source of truth. A sync script pushes it to D1 `system_config` table. A read-only admin API endpoint serves it to remote agents. No auto-generation, no new dependencies.

**Tech Stack:** D1 (SQL migration), CF Pages Functions (endpoint), Node.js (sync script), JSON

**Spec:** `docs/superpowers/specs/2026-04-04-ecosystem-ssot-design.md`

---

### Task 1: Create D1 migration for `system_config` table

**Files:**
- Create: `migrations/013-system-config.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 013-system-config.sql
-- Key-value store for system configuration (ecosystem map, future config)
CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Apply the migration to remote D1**

Run: `cd ~/iCode/projects/rrm-academy-cf && npx wrangler d1 execute rrm-auth --remote --file=migrations/013-system-config.sql`

Expected: `Executed 1 command` with no errors.

- [ ] **Step 3: Verify table exists**

Run: `npx wrangler d1 execute rrm-auth --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name='system_config'"`

Expected: One result with `name: "system_config"`.

- [ ] **Step 4: Update schema.sql with the new table**

Add to the end of `schema.sql` (before any trailing comments):

```sql
-- System configuration (ecosystem map, future config)

CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);
```

- [ ] **Step 5: Commit**

```bash
git add migrations/013-system-config.sql schema.sql
git commit -m "feat: add system_config table for ecosystem SSOT

Migration 013. Key-value store for system configuration.
First use: ecosystem-map JSON document.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Write the fully populated ecosystem JSON

**Files:**
- Create: `docs/rrm-academy-ecosystem.json`

This is the largest task. The JSON is assembled from the spec sections 1-14. All data is already defined in the spec -- this task assembles it into valid JSON.

- [ ] **Step 1: Create the JSON file**

Create `docs/rrm-academy-ecosystem.json` with the full content from the spec. Assemble all 14 sections into a single valid JSON document. The spec has each section as a code block -- combine them under the top-level keys defined in the spec's "Top-Level Keys" section.

Key things to verify while assembling:
- All JSON is valid (no trailing commas, proper quoting)
- The `last_updated` field is `"2026-04-04"`
- The `staleness_note` is present at top level
- All 14 sections are present: `organization`, `infrastructure`, `databases`, `contact_model`, `deploy_pipelines`, `projects`, `workers`, `sites`, `credentials`, `people`, `finances`, `calendar`, `timeline`

- [ ] **Step 2: Validate the JSON**

Run: `python3 -c "import json; json.load(open('docs/rrm-academy-ecosystem.json')); print('Valid JSON')"` from the project root.

Expected: `Valid JSON` with no errors.

- [ ] **Step 3: Check file size**

Run: `wc -c docs/rrm-academy-ecosystem.json`

Expected: Approximately 15-25 KB. If over 50 KB, review for unnecessary verbosity.

- [ ] **Step 4: Commit**

```bash
git add docs/rrm-academy-ecosystem.json
git commit -m "feat: add RRM Academy ecosystem SSOT JSON

Fully populated map of the entire RRM Academy system:
13 sections covering organization, infrastructure, databases,
contact model, deploy pipelines, projects, workers, sites,
credentials, people, finances, calendar, and timeline.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create the sync script

**Files:**
- Create: `scripts/sync-ecosystem.mjs`

- [ ] **Step 1: Write the sync script**

```javascript
#!/usr/bin/env node
/**
 * sync-ecosystem.mjs
 *
 * Reads docs/rrm-academy-ecosystem.json and writes it to D1 system_config table.
 * Run manually after editing the JSON:
 *   node scripts/sync-ecosystem.mjs
 *
 * Requires: wrangler CLI authenticated with Cloudflare.
 *
 * Uses --file (not --command) to avoid shell expansion of $, backticks, etc.
 * in the JSON content (e.g. "$9/mo" would be corrupted by shell interpolation).
 *
 * INSERT OR REPLACE is intentional here -- this is a single-row KV store
 * where overwrite is the desired behavior. Not a multi-row data-loss risk.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const jsonPath = join(projectRoot, 'docs', 'rrm-academy-ecosystem.json');

// Read and validate JSON
let jsonStr;
try {
  jsonStr = readFileSync(jsonPath, 'utf-8');
  JSON.parse(jsonStr); // validate
} catch (err) {
  console.error(`Failed to read/parse ${jsonPath}: ${err.message}`);
  process.exit(1);
}

// Escape single quotes for SQL, write to temp file to avoid shell expansion
const escaped = jsonStr.replace(/'/g, "''");
const sql = `INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('ecosystem-map', '${escaped}', datetime('now'));`;
const tmpFile = join(tmpdir(), `sync-ecosystem-${Date.now()}.sql`);
writeFileSync(tmpFile, sql);

console.log(`Syncing ecosystem JSON (${jsonStr.length} bytes) to D1 rrm-auth...`);

try {
  execSync(
    `npx wrangler d1 execute rrm-auth --remote --file="${tmpFile}"`,
    { cwd: projectRoot, stdio: 'inherit' }
  );
  console.log('Done.');
} catch (err) {
  console.error('Sync failed. Is wrangler authenticated?');
  process.exit(1);
} finally {
  try { unlinkSync(tmpFile); } catch {}
}
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/sync-ecosystem.mjs`

- [ ] **Step 3: Test the sync**

Run: `cd ~/iCode/projects/rrm-academy-cf && node scripts/sync-ecosystem.mjs`

Expected: `Syncing ecosystem JSON (XXXXX bytes) to D1 rrm-auth...` followed by wrangler output and `Done.`

- [ ] **Step 4: Verify the data landed in D1**

Run: `npx wrangler d1 execute rrm-auth --remote --command "SELECT key, length(value) as size, updated_at FROM system_config WHERE key = 'ecosystem-map'"`

Expected: One row with `key: "ecosystem-map"`, `size` matching the file size, and `updated_at` close to now.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync-ecosystem.mjs
git commit -m "feat: add ecosystem SSOT sync script

Reads docs/rrm-academy-ecosystem.json and writes to D1 system_config.
Run: node scripts/sync-ecosystem.mjs

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Create the API endpoint

**Files:**
- Create: `functions/api/admin/ecosystem.js`

**IMPORTANT:** This endpoint MUST be created via the `coder` subagent (`subagent_type: "coder"`). The coder agent reads sibling files in `functions/api/admin/` before writing and validates against 13 proof gates (G1-G13).

- [ ] **Step 1: Dispatch coder agent to create the endpoint**

Prompt for coder agent:

> Create `functions/api/admin/ecosystem.js` -- a GET endpoint that returns the ecosystem SSOT JSON from D1 `system_config` table.
>
> Requirements:
> - GET only (onRequestGet). Also export onRequestOptions for CORS.
> - Auth: ADMIN_API_SECRET Bearer token (same pattern as cleanup.js -- constant-time comparison)
> - Query: `SELECT value FROM system_config WHERE key = 'ecosystem-map' LIMIT 1`
> - If no row found, return `{ ok: false, error: 'Ecosystem map not configured' }` with 404
> - If DB binding missing, return 503
> - Return the raw JSON string from the `value` column with Content-Type application/json
> - Import `json` and `optionsResponse` from `../auth/_shared.js`
> - Import `log` from `../_log.js`
> - Log the access: `log(env, waitUntil, 'admin', 'ecosystem_read', 'ok', '')`

- [ ] **Step 2: Test the endpoint locally**

Run: `npx wrangler pages dev dist --d1=DB=rrm-auth --port 8788`

Then: `curl -H "Authorization: Bearer test-secret" http://localhost:8788/api/admin/ecosystem`

Expected: 401 (since local ADMIN_API_SECRET won't match). Confirms the endpoint is wired and auth is checked.

- [ ] **Step 3: Test against production**

Run: `curl -s -H "Authorization: Bearer $(op read 'op://Automation/RRM Admin API Secret/credential' 2>/dev/null)" https://rrmacademy.org/api/admin/ecosystem | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('name', d.get('error', 'unknown')))"`

Expected: `RRM Academy Ecosystem` (the `name` field from the JSON).

Note: This test only works after deployment. Skip if testing locally only.

- [ ] **Step 4: Commit**

```bash
git add functions/api/admin/ecosystem.js
git commit -m "feat: add GET /api/admin/ecosystem endpoint

Returns ecosystem SSOT JSON from D1 system_config table.
ADMIN_API_SECRET Bearer auth (same pattern as cleanup.js).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Update guard manifest

The new endpoint file needs to be acknowledged by the security guard if it touches admin patterns.

**Files:**
- Modify: `scripts/guard.mjs` (only if the new endpoint is in a guarded directory)

- [ ] **Step 1: Run guard to check for warnings**

Run: `npm run guard`

If guard warns about an unguarded file in `admin/`, proceed to Step 2. If guard passes clean, skip to Step 3.

Note: `cleanup.js` in `admin/` is guarded. The new `ecosystem.js` is read-only and low-risk, but guard may warn about it.

- [ ] **Step 2: Update guard manifest (if warned)**

Run: `npm run guard:update`

Expected: Manifest regenerated with the new file hash.

- [ ] **Step 3: Commit (if manifest changed)**

```bash
git add scripts/guard-manifest.json
git commit -m "chore: update guard manifest for ecosystem endpoint

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Add npm script for convenience

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add sync-ecosystem script**

Add to `"scripts"` in `package.json`:

```json
"sync-ecosystem": "node scripts/sync-ecosystem.mjs"
```

- [ ] **Step 2: Verify it runs**

Run: `npm run sync-ecosystem`

Expected: Same output as Task 3 Step 3.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add npm run sync-ecosystem convenience script

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Update CLAUDE.md to reference the ecosystem JSON

**Files:**
- Modify: `CLAUDE.md` (site-level, in rrm-academy-cf)

- [ ] **Step 1: Add ecosystem reference to Local Reference table**

In the `## Local Reference` table in CLAUDE.md, add a row:

```markdown
| Ecosystem SSOT | `docs/rrm-academy-ecosystem.json` |
```

- [ ] **Step 2: Add a note near the top of CLAUDE.md**

After the opening blockquote, add:

```markdown
> **Ecosystem map:** `docs/rrm-academy-ecosystem.json` is the structured map of the entire RRM Academy system -- infrastructure, databases, contact model, deploy pipelines, workers, projects, people, finances, calendar, and timeline. Read it for system-wide context. Also available via `GET /api/admin/ecosystem` (ADMIN_API_SECRET auth) and D1 `system_config` table (`key = 'ecosystem-map'`).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: reference ecosystem SSOT in CLAUDE.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Update iCode-level CLAUDE.md

**Files:**
- Modify: `~/iCode/CLAUDE.md`

- [ ] **Step 1: Add ecosystem reference to the project routing table**

In the `## Project Routing` table, the rrm-academy-cf row's "Read FIRST" column currently says `CLAUDE.md` and `STYLE-GUIDE.md`. Add `docs/rrm-academy-ecosystem.json` to the read list for system-wide queries.

- [ ] **Step 2: Add a note in the RRM Academy Site Structure section**

Add after the "Stack" line:

```markdown
**Ecosystem map:** `projects/rrm-academy-cf/docs/rrm-academy-ecosystem.json` -- structured JSON mapping the full system. Also in D1 `system_config` table and `GET /api/admin/ecosystem`.
```

- [ ] **Step 3: Commit**

```bash
cd ~/iCode && git add CLAUDE.md
git commit -m "docs: reference ecosystem SSOT in iCode CLAUDE.md

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Deploy

- [ ] **Step 1: Push all commits to main**

```bash
cd ~/iCode/projects/rrm-academy-cf && git push origin main
```

- [ ] **Step 2: Wait for CF Pages deploy to complete**

Check deploy status in Cloudflare dashboard or wait ~2 minutes. The push trigger skips data fetch (code-only build).

---

### Task 10: Final verification

- [ ] **Step 1: Verify JSON is valid and complete**

Run: `cd ~/iCode/projects/rrm-academy-cf && python3 -c "
import json
d = json.load(open('docs/rrm-academy-ecosystem.json'))
expected = ['organization','infrastructure','databases','contact_model','deploy_pipelines','projects','workers','sites','credentials','people','finances','calendar','timeline']
missing = [k for k in expected if k not in d]
print(f'Sections: {len(expected)} expected, {len(d.keys())-3} found (excluding name/last_updated/staleness_note)')
if missing: print(f'MISSING: {missing}')
else: print('All sections present')
print(f'File size: {len(json.dumps(d)):,} bytes')
"`

Expected: All 13 sections present, no missing.

- [ ] **Step 2: Verify D1 has the data**

Run: `npx wrangler d1 execute rrm-auth --remote --command "SELECT key, length(value) as size FROM system_config"`

Expected: One row, `ecosystem-map`, size matches file.

- [ ] **Step 3: Verify the endpoint works (after deploy)**

Run: `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $(op read 'op://Automation/RRM Admin API Secret/credential' 2>/dev/null)" https://rrmacademy.org/api/admin/ecosystem`

Expected: `200`

- [ ] **Step 4: Run guard to make sure nothing is broken**

Run: `npm run guard`

Expected: All checks pass.
