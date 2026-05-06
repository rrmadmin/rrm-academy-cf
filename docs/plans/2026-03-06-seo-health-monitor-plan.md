# SEO Health Monitor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automated SEO monitoring Worker with daily alerts, weekly digests, and admin dashboard integration.

**Architecture:** New standalone CF Worker (`rrm-seo-monitor`) with cron triggers for daily/weekly checks, KV for baselines, Telegram for alerts. Admin dashboard in `rrm-academy-cf` gets a new "SEO" tab that proxies to the Worker via `functions/api/admin/seo.js`.

**Tech Stack:** Cloudflare Worker (JS, no build step), KV, Analytics Engine, Telegram Bot API

**Design doc:** `docs/plans/2026-03-06-seo-health-monitor-design.md`

---

### Task 1: Scaffold the Worker repo

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/index.js`
- Create: `~/iCode/projects/rrm-seo-monitor/wrangler.toml`
- Create: `~/iCode/projects/rrm-seo-monitor/package.json`
- Create: `~/iCode/projects/rrm-seo-monitor/.gitignore`
- Create: `~/iCode/projects/rrm-seo-monitor/CLAUDE.md`

**Step 1: Create project directory and init git**

```bash
mkdir -p ~/iCode/projects/rrm-seo-monitor/src
cd ~/iCode/projects/rrm-seo-monitor
git init
```

**Step 2: Create wrangler.toml**

```toml
name = "rrm-seo-monitor"
main = "src/index.js"
compatibility_date = "2025-03-01"
account_id = "ecf2c5bc8b5ebd634bcb587b3890910a"

[triggers]
crons = ["0 6 * * *", "0 14 * * 6"]

[[kv_namespaces]]
binding = "BASELINES"
id = ""  # Fill after creating namespace

[[analytics_engine_datasets]]
binding = "EVENTS"
dataset = "worker-events"
```

**Step 3: Create package.json**

```json
{
  "name": "rrm-seo-monitor",
  "version": "1.0.0",
  "private": true
}
```

**Step 4: Create .gitignore**

```
node_modules/
.wrangler/
.dev.vars
```

**Step 5: Create minimal index.js with health endpoint**

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, worker: 'rrm-seo-monitor' });
    }
    return new Response('not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    // Will be implemented in later tasks
  },
};
```

**Step 6: Create CLAUDE.md**

Minimal placeholder -- will be fleshed out after implementation.

**Step 7: Create KV namespace and update wrangler.toml**

```bash
cd ~/iCode/projects/rrm-seo-monitor
source ~/.zshrc
npx wrangler kv namespace create SEO_BASELINES
```

Copy the returned ID into `wrangler.toml`.

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: scaffold rrm-seo-monitor Worker"
```

---

### Task 2: Implement check modules

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/checks.js`

Each check is a pure async function: `(env) => { name, status, detail }`.

**Step 1: Write the checks module**

```js
const SITE = 'https://rrmacademy.org';

const KEY_PAGES = [
  '/', '/about/', '/courses/', '/courses/endo-masterclass/',
  '/library/', '/commentary/', '/faqs/', '/donate/',
  '/save-the-uterus-club/', '/what-is-rrm/',
];

// --- Individual checks ---

async function checkPages() {
  const results = [];
  // Fetch all pages concurrently
  const fetches = KEY_PAGES.map(async (path) => {
    try {
      const res = await fetch(SITE + path, { redirect: 'follow' });
      if (!res.ok) results.push({ path, status: res.status });
    } catch (e) {
      results.push({ path, status: 'error', error: e.message });
    }
  });
  await Promise.all(fetches);
  return {
    name: 'pages',
    ok: results.length === 0,
    detail: results.length === 0
      ? `All ${KEY_PAGES.length} key pages healthy`
      : results.map(r => `${r.path} returned ${r.status}`).join('; '),
    failures: results,
  };
}

async function checkSitemap(env) {
  try {
    const res = await fetch(SITE + '/sitemap-index.xml');
    if (!res.ok) return { name: 'sitemap', ok: false, detail: `Sitemap returned ${res.status}` };
    const text = await res.text();
    // Count <loc> entries across all sub-sitemaps referenced
    const locCount = (text.match(/<loc>/g) || []).length;
    // Also fetch the main sitemap to count actual URLs
    const sitemaps = [...text.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
    let totalUrls = 0;
    for (const smUrl of sitemaps.slice(0, 5)) {  // cap at 5 sub-sitemaps
      try {
        const smRes = await fetch(smUrl);
        if (smRes.ok) {
          const smText = await smRes.text();
          totalUrls += (smText.match(/<loc>/g) || []).length;
        }
      } catch {}
    }
    const baseline = await env.BASELINES.get('sitemap_count');
    const baselineCount = baseline ? parseInt(baseline, 10) : null;
    const drop = baselineCount && totalUrls < baselineCount * 0.9;
    return {
      name: 'sitemap',
      ok: !drop,
      detail: `${totalUrls} URLs` + (baselineCount ? ` (baseline: ${baselineCount})` : ''),
      count: totalUrls,
    };
  } catch (e) {
    return { name: 'sitemap', ok: false, detail: `Sitemap error: ${e.message}` };
  }
}

async function checkRobots(env) {
  try {
    const res = await fetch(SITE + '/robots.txt');
    if (!res.ok) return { name: 'robots', ok: false, detail: `robots.txt returned ${res.status}` };
    const text = await res.text();
    // SHA-256 hash
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    const hash = [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2, '0')).join('');
    const baseline = await env.BASELINES.get('robots_hash');
    if (!baseline) {
      // First run -- store baseline
      await env.BASELINES.put('robots_hash', hash);
      return { name: 'robots', ok: true, detail: 'robots.txt baseline set' };
    }
    const changed = hash !== baseline;
    return {
      name: 'robots',
      ok: !changed,
      detail: changed ? 'robots.txt content changed from baseline' : 'robots.txt unchanged',
      hash,
    };
  } catch (e) {
    return { name: 'robots', ok: false, detail: `robots.txt error: ${e.message}` };
  }
}

async function checkLlmsTxt() {
  try {
    const res = await fetch(SITE + '/llms.txt');
    if (!res.ok) return { name: 'llms_txt', ok: false, detail: `llms.txt returned ${res.status}` };
    const text = await res.text();
    const empty = text.trim().length === 0;
    return {
      name: 'llms_txt',
      ok: !empty,
      detail: empty ? 'llms.txt is empty' : 'llms.txt OK',
    };
  } catch (e) {
    return { name: 'llms_txt', ok: false, detail: `llms.txt error: ${e.message}` };
  }
}

async function checkSchema() {
  const SCHEMA_PAGES = [
    { path: '/', expected: 'WebSite' },
    { path: '/courses/endo-masterclass/', expected: 'Course' },
    { path: '/commentary/', expected: 'Blog' },
  ];
  const failures = [];
  for (const { path, expected } of SCHEMA_PAGES) {
    try {
      const res = await fetch(SITE + path);
      if (!res.ok) { failures.push(`${path}: HTTP ${res.status}`); continue; }
      const html = await res.text();
      const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      if (!match) { failures.push(`${path}: no JSON-LD found`); continue; }
      try {
        JSON.parse(match[1]);
      } catch {
        failures.push(`${path}: JSON-LD parse error`);
      }
    } catch (e) {
      failures.push(`${path}: ${e.message}`);
    }
  }
  return {
    name: 'schema',
    ok: failures.length === 0,
    detail: failures.length === 0
      ? `Schema valid on ${SCHEMA_PAGES.length} sample pages`
      : failures.join('; '),
    failures,
  };
}

async function checkBacklinks(env) {
  const token = env.BACKLINKS_API_TOKEN;
  if (!token) return { name: 'backlinks', ok: true, detail: 'Backlinks check skipped (no token)' };
  try {
    const res = await fetch('https://rrm-backlinks.administrator-cloudflare.workers.dev/api/backlinks/summary', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return { name: 'backlinks', ok: false, detail: `Backlinks API returned ${res.status}` };
    const data = await res.json();
    const deadCount = data.dead || 0;
    return {
      name: 'backlinks',
      ok: deadCount === 0,
      detail: deadCount > 0
        ? `${deadCount} dead backlink(s) detected`
        : `${data.total || 0} backlinks, all healthy`,
      data,
    };
  } catch (e) {
    return { name: 'backlinks', ok: false, detail: `Backlinks error: ${e.message}` };
  }
}

async function checkHeaders() {
  try {
    const res = await fetch(SITE + '/');
    const hsts = res.headers.get('strict-transport-security');
    const csp = res.headers.get('content-security-policy');
    const missing = [];
    if (!hsts) missing.push('HSTS');
    if (!csp) missing.push('CSP');
    return {
      name: 'headers',
      ok: missing.length === 0,
      detail: missing.length === 0
        ? 'Security headers present'
        : `Missing: ${missing.join(', ')}`,
      missing,
    };
  } catch (e) {
    return { name: 'headers', ok: false, detail: `Headers error: ${e.message}` };
  }
}

// --- Run all checks ---

export async function runAllChecks(env) {
  const results = await Promise.all([
    checkPages(),
    checkSitemap(env),
    checkRobots(env),
    checkLlmsTxt(),
    checkSchema(),
    checkBacklinks(env),
    checkHeaders(),
  ]);
  const allOk = results.every(r => r.ok);
  return { ok: allOk, checks: results, timestamp: new Date().toISOString() };
}
```

**Step 2: Commit**

```bash
git add src/checks.js
git commit -m "feat: implement SEO check modules (pages, sitemap, robots, llms, schema, backlinks, headers)"
```

---

### Task 3: Implement Telegram notifications

**Files:**
- Create: `~/iCode/projects/rrm-seo-monitor/src/telegram.js`

**Step 1: Write the Telegram module**

```js
export async function sendTelegram(env, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram not configured, skipping notification');
    return;
  }
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.error(`Telegram send failed: ${res.status}`);
  }
}

export function formatDailyAlert(results) {
  const failures = results.checks.filter(c => !c.ok);
  if (failures.length === 0) return null; // No alert needed

  const lines = ['<b>SEO Alert -- rrmacademy.org</b>', ''];
  for (const f of failures) {
    lines.push(`${f.name}: ${f.detail}`);
  }
  lines.push('', 'Run full check: rrmacademy.org/admin/seo/');
  return lines.join('\n');
}

export function formatWeeklyDigest(results) {
  const lines = ['<b>SEO Weekly -- rrmacademy.org</b>', ''];
  for (const c of results.checks) {
    const icon = c.ok ? '\u2705' : '\u26a0\ufe0f';
    lines.push(`${icon} ${c.detail}`);
  }
  lines.push('', 'Deep analysis: <code>python seo_dashboard.py rrmacademy</code>');
  return lines.join('\n');
}
```

**Step 2: Commit**

```bash
git add src/telegram.js
git commit -m "feat: Telegram notification formatting and sending"
```

---

### Task 4: Wire up cron handlers and API routes

**Files:**
- Modify: `~/iCode/projects/rrm-seo-monitor/src/index.js`

**Step 1: Implement the full Worker entry point**

```js
import { runAllChecks } from './checks.js';
import { sendTelegram, formatDailyAlert, formatWeeklyDigest } from './telegram.js';

function log(env, ctx, action, status, detail) {
  if (!env.EVENTS) return;
  ctx.waitUntil(env.EVENTS.writeDataPoint({
    blobs: ['rrm-seo-monitor', 'seo', action, status, (detail || '').slice(0, 200)],
    doubles: [0, 1, 0],
    indexes: [action],
  }));
}

function auth(request, env) {
  const token = env.SEO_MONITOR_API_TOKEN;
  if (!token) return false;
  const header = request.headers.get('Authorization') || '';
  return header === `Bearer ${token}`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, worker: 'rrm-seo-monitor' });
    }

    // All /api/* routes require auth
    if (url.pathname.startsWith('/api/')) {
      if (!auth(request, env)) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }

      if (url.pathname === '/api/check' && request.method === 'GET') {
        const results = await runAllChecks(env);
        log(env, ctx, 'manual_check', results.ok ? 'ok' : 'alert', `${results.checks.filter(c => !c.ok).length} failures`);
        return Response.json(results);
      }

      if (url.pathname === '/api/baseline' && request.method === 'GET') {
        const keys = ['sitemap_count', 'robots_hash'];
        const baselines = {};
        for (const k of keys) {
          baselines[k] = await env.BASELINES.get(k);
        }
        return Response.json(baselines);
      }

      if (url.pathname === '/api/baseline' && request.method === 'PUT') {
        const body = await request.json();
        for (const [k, v] of Object.entries(body)) {
          await env.BASELINES.put(k, String(v));
        }
        return Response.json({ ok: true, updated: Object.keys(body) });
      }
    }

    return new Response('not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const results = await runAllChecks(env);
    const isWeekly = event.cron === '0 14 * * 6';

    if (isWeekly) {
      const digest = formatWeeklyDigest(results);
      await sendTelegram(env, digest);
      log(env, ctx, 'weekly_digest', results.ok ? 'ok' : 'alert', `${results.checks.filter(c => !c.ok).length} failures`);
    } else {
      // Daily -- only alert on failure
      const alert = formatDailyAlert(results);
      if (alert) {
        await sendTelegram(env, alert);
        log(env, ctx, 'daily_alert', 'alert', `${results.checks.filter(c => !c.ok).length} failures`);
      } else {
        log(env, ctx, 'daily_check', 'ok', 'All checks passed');
      }
    }

    // Store latest results in KV for dashboard reads
    await env.BASELINES.put('last_results', JSON.stringify(results));
  },
};
```

**Step 2: Commit**

```bash
git add src/index.js
git commit -m "feat: wire cron handlers, API routes, auth, and logging"
```

---

### Task 5: Set secrets and deploy

**Step 1: Create GitHub repo**

```bash
cd ~/iCode/projects/rrm-seo-monitor
gh repo create rrmadmin/rrm-seo-monitor --private --source=. --push
```

**Step 2: Set secrets**

```bash
source ~/.zshrc

# Generate a new API token for the SEO monitor
SEO_TOKEN=$(openssl rand -hex 32)
echo "SEO_MONITOR_API_TOKEN: $SEO_TOKEN"

# Store in 1Password
op item create --vault Automation --category "API Credential" \
  --title "RRM SEO Monitor API Token" \
  "credential=$SEO_TOKEN"

# Set Worker secrets
echo "$SEO_TOKEN" | npx wrangler secret put SEO_MONITOR_API_TOKEN

# Telegram bot token (same bot as down detector)
op read 'op://Automation/<redacted>/credential' | npx wrangler secret put TELEGRAM_BOT_TOKEN

# Telegram chat ID
echo "8444326757" | npx wrangler secret put TELEGRAM_CHAT_ID

# Backlinks API token
op read 'op://Automation/<redacted>/credential' | npx wrangler secret put BACKLINKS_API_TOKEN
```

**Step 3: Deploy**

```bash
npx wrangler deploy
```

**Step 4: Verify health endpoint**

```bash
curl https://rrm-seo-monitor.administrator-cloudflare.workers.dev/health
```

Expected: `{"ok":true,"worker":"rrm-seo-monitor"}`

**Step 5: Run manual check to set baselines**

```bash
SEO_TOKEN="<from step 2>"
curl -H "Authorization: Bearer $SEO_TOKEN" \
  https://rrm-seo-monitor.administrator-cloudflare.workers.dev/api/check | python3 -m json.tool
```

Review the output. Then set the sitemap baseline:

```bash
curl -X PUT -H "Authorization: Bearer $SEO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sitemap_count": <number from check output>}' \
  https://rrm-seo-monitor.administrator-cloudflare.workers.dev/api/baseline
```

**Step 6: Commit and push**

```bash
git add -A
git commit -m "chore: deploy config and secrets setup"
git push
```

---

### Task 6: Admin dashboard proxy endpoint

**Files:**
- Create: `~/iCode/projects/rrm-academy-cf/functions/api/admin/seo.js`

**Step 1: Create the proxy endpoint**

Follow the exact pattern from `functions/api/admin/backlinks.js`.

```js
/**
 * GET /api/admin/seo
 *
 * Proxies SEO monitor check to rrm-seo-monitor Worker.
 * Requires ADMIN_TOKEN via Bearer auth.
 */

const SEO_WORKER = 'https://rrm-seo-monitor.administrator-cloudflare.workers.dev';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://rrmacademy.org',
    },
  });
}

export async function onRequestGet({ request, env }) {
  // Auth
  if (!env.ADMIN_TOKEN) return json({ ok: false, error: 'Not configured' }, 500);
  const auth = (request.headers.get('Authorization') || '').replace('Bearer ', '');
  if (auth !== env.ADMIN_TOKEN) return json({ ok: false, error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'check';

  try {
    let endpoint = '/api/check';
    if (action === 'baseline') endpoint = '/api/baseline';
    if (action === 'cached') endpoint = '/api/check'; // Will read last_results from KV

    const res = await fetch(SEO_WORKER + endpoint, {
      headers: { 'Authorization': `Bearer ${env.SEO_MONITOR_API_TOKEN}` },
    });
    const data = await res.json();
    return json(data);
  } catch (e) {
    return json({ ok: false, error: e.message }, 502);
  }
}
```

**Step 2: Add SEO_MONITOR_API_TOKEN to CF Pages env vars**

Use Cloudflare API or dashboard to add `SEO_MONITOR_API_TOKEN` to the `rrm-academy` Pages project env vars (same value stored in 1Password).

**Step 3: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
git add functions/api/admin/seo.js
git commit -m "feat: add /api/admin/seo proxy endpoint for SEO monitor"
```

---

### Task 7: Admin dashboard SEO page

**Files:**
- Create: `~/iCode/projects/rrm-academy-cf/src/pages/admin/seo.astro`
- Modify: `~/iCode/projects/rrm-academy-cf/src/pages/admin/backlinks.astro` (add SEO nav link)
- Modify: `~/iCode/projects/rrm-academy-cf/src/pages/admin/conversions.astro` (add SEO nav link)
- Modify: `~/iCode/projects/rrm-academy-cf/src/pages/admin/content.astro` (add SEO nav link)
- Modify: `~/iCode/projects/rrm-academy-cf/src/pages/admin/revenue.astro` (add SEO nav link)

**Step 1: Add "SEO" to the admin nav in all 4 existing pages**

In each file, add after the Content link:

```html
<a href="/admin/seo/" class="admin-bar__link">SEO</a>
```

**Step 2: Create seo.astro**

Follow the exact pattern from `backlinks.astro`: same layout, login gate, admin bar nav (with SEO link active), dashboard section.

Dashboard content:
- Status cards grid (7 cards: Pages, Sitemap, Robots, llms.txt, Schema, Backlinks, Headers)
- Each card: label, status icon (green check / red X), detail text
- "Run Check" button + "Last checked" timestamp
- Expandable failure details

**Step 3: Commit**

```bash
git add src/pages/admin/seo.astro src/pages/admin/backlinks.astro src/pages/admin/conversions.astro src/pages/admin/content.astro src/pages/admin/revenue.astro
git commit -m "feat: add SEO tab to admin dashboard"
```

---

### Task 8: Update documentation

**Files:**
- Modify: `~/iCode/projects/rrm-academy-cf/CLAUDE.md` (add SEO admin endpoint, page route)
- Create: `~/iCode/projects/rrm-seo-monitor/CLAUDE.md` (full project reference)
- Modify: `~/iCode/CLAUDE.md` (add rrm-seo-monitor to repos table)

**Step 1: Update rrm-academy-cf CLAUDE.md**

- Add `/admin/seo` to Site Map table
- Add `GET /api/admin/seo` to API Functions table
- Add `SEO_MONITOR_API_TOKEN` mention where relevant

**Step 2: Write rrm-seo-monitor CLAUDE.md**

Full project reference: architecture, key files, secrets, connections, cron schedule. Follow the pattern from `rrm-backlinks/CLAUDE.md`.

**Step 3: Update iCode/CLAUDE.md**

Add to Git Repos table:

```
| rrm-seo-monitor | `iCode/projects/rrm-seo-monitor/` | `rrmadmin/rrm-seo-monitor` (private) | SEO health monitoring Worker |
```

**Step 4: Commit both repos**

```bash
cd ~/iCode/projects/rrm-seo-monitor
git add CLAUDE.md && git commit -m "docs: add CLAUDE.md project reference"

cd ~/iCode/projects/rrm-academy-cf
git add CLAUDE.md && git commit -m "docs: add SEO monitor to CLAUDE.md"

cd ~/iCode
git add CLAUDE.md && git commit -m "docs: add rrm-seo-monitor to repos table"
```

---

### Task 9: End-to-end verification

**Step 1: Trigger a manual check from the admin dashboard**

Navigate to `rrmacademy.org/admin/seo/`, login, click "Run Check". Verify all 7 cards render with status.

**Step 2: Test Telegram alert**

Temporarily break a check (e.g., set a bad robots hash baseline) and trigger a check. Verify Telegram alert arrives at `@rrm_n8n_notification_bot`.

**Step 3: Verify cron is registered**

```bash
cd ~/iCode/projects/rrm-seo-monitor
npx wrangler deployments list
```

Check that cron triggers are active in the Cloudflare dashboard (Workers > rrm-seo-monitor > Triggers).

**Step 4: Restore baselines and verify clean state**

Reset any test baselines, run one more manual check to confirm all green.
