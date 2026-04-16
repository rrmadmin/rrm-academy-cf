# GA4 Server-Side Source Attribution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix GA4 source attribution so traffic source (google/organic, instagram/social, direct, etc.) and UTM campaign params are captured server-side, enabling "conversions by source" reporting in the admin dashboard.

**Architecture:** Extract referrer hostname + UTM params from every request in `_middleware.js`, classify into source/medium, generate a stable `session_id`, and send all of it as GA4 Measurement Protocol event params. Then update the conversions admin dashboard to cross-reference conversion events with traffic source. Zero client-side JS. Zero cookies.

**Tech Stack:** CF Pages Functions (existing), GA4 Measurement Protocol v2 (existing), GA4 Data API (existing)

---

## Current State

- `_middleware.js` fires `page_view` events server-side via Measurement Protocol
- `_ga4.js` fires conversion events (`sign_up`, `generate_lead`, `begin_checkout`, `purchase`) from API handlers
- Both use `client_id` derived from `SHA-256(IP + UA)`, but send **no** `session_id`, **no** `traffic_source` params, and **no** UTM data
- Result: GA4 reports show `sessionSource = (not set)` for 100% of traffic
- The admin content dashboard already queries `sessionSource` but gets empty data
- The admin conversions dashboard doesn't query source at all

## Key GA4 Measurement Protocol Facts

- `session_id` is a **required** event param for GA4 to create sessions. Without it, every hit is sessionless and unattributable
- `traffic_source.source`, `traffic_source.medium`, and `traffic_source.name` are **user properties** (not event params) that GA4 uses for session attribution
- UTM params (`utm_source`, `utm_medium`, `utm_campaign`) sent as event params are recognized by GA4 and override traffic source inference
- `session_id` must be a positive integer, stable per user session (typically a timestamp)
- GA4 recognizes `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` as event params for attribution. Bare names like `source`/`medium` are NOT recognized -- always use the `utm_*` prefix

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `functions/api/_ga4-source.js` | Create | Referrer classification + UTM extraction + session ID generation |
| `functions/_middleware.js` | Modify | Import `_ga4-source.js`, add source/session params to page_view payload |
| `functions/api/_ga4.js` | Modify | Accept + forward source/session params on conversion events |
| `functions/api/admin/conversions.js` | Modify | Add "conversions by source" GA4 query |
| `src/pages/admin/conversions.astro` | Modify | Add source breakdown table to dashboard |
| `test/ga4-source.test.js` | Create | Tests for referrer classification and UTM extraction |

**Guard impact:** `_middleware.js` is guarded. Run `npm run guard:update` after changes. `_ga4.js` is not guarded. The new `_ga4-source.js` file is prefixed with `_` so CF Pages won't route to it.

---

## Chunk 1: Source Classification + Session ID Module

### Task 1: Create test file for source classification

**Files:**
- Create: `test/ga4-source.test.js`

- [ ] **Step 1: Create test directory and test file**

```js
// test/ga4-source.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource, extractUtm, deriveSessionId } from '../functions/api/_ga4-source.js';

describe('classifySource', () => {
  it('returns direct for empty referrer', () => {
    const result = classifySource('');
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)' });
  });

  it('returns direct for null referrer', () => {
    const result = classifySource(null);
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)' });
  });

  it('classifies google.com as organic', () => {
    const result = classifySource('https://www.google.com/search?q=rrm');
    assert.deepStrictEqual(result, { source: 'google', medium: 'organic' });
  });

  it('classifies google.co.uk as organic', () => {
    const result = classifySource('https://www.google.co.uk/');
    assert.deepStrictEqual(result, { source: 'google', medium: 'organic' });
  });

  it('classifies bing.com as organic', () => {
    const result = classifySource('https://www.bing.com/search?q=napro');
    assert.deepStrictEqual(result, { source: 'bing', medium: 'organic' });
  });

  it('classifies duckduckgo.com as organic', () => {
    const result = classifySource('https://duckduckgo.com/?q=rrm');
    assert.deepStrictEqual(result, { source: 'duckduckgo', medium: 'organic' });
  });

  it('classifies instagram.com as social', () => {
    const result = classifySource('https://l.instagram.com/something');
    assert.deepStrictEqual(result, { source: 'instagram', medium: 'social' });
  });

  it('classifies facebook.com as social', () => {
    const result = classifySource('https://l.facebook.com/l.php?u=...');
    assert.deepStrictEqual(result, { source: 'facebook', medium: 'social' });
  });

  it('classifies linkedin.com as social', () => {
    const result = classifySource('https://www.linkedin.com/feed');
    assert.deepStrictEqual(result, { source: 'linkedin', medium: 'social' });
  });

  it('classifies twitter/x as social', () => {
    const result = classifySource('https://t.co/abc123');
    assert.deepStrictEqual(result, { source: 'twitter', medium: 'social' });
  });

  it('classifies unknown referrer as referral', () => {
    const result = classifySource('https://somesite.com/page');
    assert.deepStrictEqual(result, { source: 'somesite.com', medium: 'referral' });
  });

  it('ignores self-referrals from rrmacademy.org', () => {
    const result = classifySource('https://rrmacademy.org/library/some-article');
    assert.deepStrictEqual(result, { source: '(direct)', medium: '(none)' });
  });

  it('classifies yahoo as organic', () => {
    const result = classifySource('https://search.yahoo.com/search?p=rrm');
    assert.deepStrictEqual(result, { source: 'yahoo', medium: 'organic' });
  });
});

describe('extractUtm', () => {
  it('returns empty object for URL with no UTM params', () => {
    const result = extractUtm('https://rrmacademy.org/library/');
    assert.deepStrictEqual(result, {});
  });

  it('extracts utm_source', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_source=newsletter');
    assert.deepStrictEqual(result, { utm_source: 'newsletter' });
  });

  it('extracts all UTM params', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_source=ig&utm_medium=social&utm_campaign=spring2026');
    assert.deepStrictEqual(result, {
      utm_source: 'ig',
      utm_medium: 'social',
      utm_campaign: 'spring2026',
    });
  });

  it('extracts utm_content and utm_term', () => {
    const result = extractUtm('https://rrmacademy.org/?utm_source=google&utm_content=cta&utm_term=napro');
    assert.deepStrictEqual(result, {
      utm_source: 'google',
      utm_content: 'cta',
      utm_term: 'napro',
    });
  });

  it('ignores non-UTM params', () => {
    const result = extractUtm('https://rrmacademy.org/?page=2&utm_source=test&sort=date');
    assert.deepStrictEqual(result, { utm_source: 'test' });
  });
});

describe('deriveSessionId', () => {
  it('returns a positive integer', async () => {
    const id = await deriveSessionId('abc123client', '2026-03-09');
    assert.equal(typeof id, 'number');
    assert.ok(id > 0);
    assert.ok(Number.isInteger(id));
  });

  it('returns same value for same client + date', async () => {
    const a = await deriveSessionId('abc123client', '2026-03-09');
    const b = await deriveSessionId('abc123client', '2026-03-09');
    assert.equal(a, b);
  });

  it('returns different value for different dates', async () => {
    const a = await deriveSessionId('abc123client', '2026-03-09');
    const b = await deriveSessionId('abc123client', '2026-03-10');
    assert.notEqual(a, b);
  });

  it('returns different value for different clients', async () => {
    const a = await deriveSessionId('client1', '2026-03-09');
    const b = await deriveSessionId('client2', '2026-03-09');
    assert.notEqual(a, b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/iCode/projects/rrm-academy-cf && node --test test/ga4-source.test.js`
Expected: FAIL -- module `_ga4-source.js` does not exist

- [ ] **Step 3: Commit test file**

```bash
git add test/ga4-source.test.js
git commit -m "test: add tests for GA4 source attribution module"
```

---

### Task 2: Implement source classification module

**Files:**
- Create: `functions/api/_ga4-source.js`

- [ ] **Step 1: Create the source classification module**

```js
// functions/api/_ga4-source.js
//
// Server-side traffic source classification for GA4 Measurement Protocol.
// Prefixed with _ so CF Pages doesn't treat it as a route handler.

const SEARCH_ENGINES = [
  { pattern: /google\./i, source: 'google' },
  { pattern: /bing\.com/i, source: 'bing' },
  { pattern: /yahoo\./i, source: 'yahoo' },
  { pattern: /duckduckgo\.com/i, source: 'duckduckgo' },
  { pattern: /baidu\.com/i, source: 'baidu' },
  { pattern: /yandex\./i, source: 'yandex' },
  { pattern: /ecosia\.org/i, source: 'ecosia' },
];

const SOCIAL_NETWORKS = [
  { pattern: /instagram\.com|l\.instagram\.com/i, source: 'instagram' },
  { pattern: /facebook\.com|l\.facebook\.com|fb\.com/i, source: 'facebook' },
  { pattern: /linkedin\.com|lnkd\.in/i, source: 'linkedin' },
  { pattern: /t\.co|twitter\.com|x\.com/i, source: 'twitter' },
  { pattern: /youtube\.com|youtu\.be/i, source: 'youtube' },
  { pattern: /pinterest\.com/i, source: 'pinterest' },
  { pattern: /reddit\.com/i, source: 'reddit' },
  { pattern: /tiktok\.com/i, source: 'tiktok' },
];

const SELF_DOMAINS = ['rrmacademy.org', 'www.rrmacademy.org', 'library.rrmacademy.org'];

/**
 * Classify a referrer URL into source/medium.
 * @param {string|null} referrer - The Referer header value
 * @returns {{ source: string, medium: string }}
 */
export function classifySource(referrer) {
  if (!referrer) return { source: '(direct)', medium: '(none)' };

  let hostname;
  try {
    hostname = new URL(referrer).hostname;
  } catch {
    return { source: '(direct)', medium: '(none)' };
  }

  // Self-referrals treated as direct
  if (SELF_DOMAINS.some(d => hostname === d)) {
    return { source: '(direct)', medium: '(none)' };
  }

  // Search engines
  for (const { pattern, source } of SEARCH_ENGINES) {
    if (pattern.test(hostname)) return { source, medium: 'organic' };
  }

  // Social networks
  for (const { pattern, source } of SOCIAL_NETWORKS) {
    if (pattern.test(hostname)) return { source, medium: 'social' };
  }

  // Everything else is referral
  return { source: hostname, medium: 'referral' };
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/**
 * Extract UTM parameters from a URL string.
 * @param {string} urlString - Full request URL
 * @returns {Object} Only the UTM params that are present
 */
export function extractUtm(urlString) {
  let params;
  try {
    params = new URL(urlString).searchParams;
  } catch {
    return {};
  }

  const result = {};
  for (const key of UTM_KEYS) {
    const val = params.get(key);
    if (val) result[key] = val;
  }
  return result;
}

/**
 * Derive a stable session_id from client_id + date.
 * GA4 requires session_id to be a positive integer.
 * Using date granularity: one "session" per device per day.
 * Uses SubtleCrypto (available in CF Workers).
 *
 * @param {string} clientId - The hashed client identifier
 * @param {string} dateStr - ISO date string (YYYY-MM-DD)
 * @returns {Promise<number>} Positive integer session ID
 */
export async function deriveSessionId(clientId, dateStr) {
  const raw = new TextEncoder().encode(`${clientId}:${dateStr}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', raw);
  const view = new DataView(hashBuffer);
  // Use first 4 bytes as unsigned 32-bit integer (always positive)
  return view.getUint32(0);
}

/**
 * Build the full set of GA4 params for source attribution.
 * Call this from middleware for page_view events and from _ga4.js for conversions.
 *
 * @param {Request} request
 * @param {string} clientId - Pre-computed client_id hash
 * @returns {Promise<Object>} Params to spread into the GA4 event
 */
export async function buildSourceParams(request, clientId) {
  const referrer = request.headers.get('Referer') || '';
  const url = request.url;
  const utmParams = extractUtm(url);
  const { source, medium } = classifySource(referrer);

  // Date in the property timezone (America/New_York)
  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sessionId = await deriveSessionId(clientId, dateStr);

  // GA4 Measurement Protocol recognizes utm_* prefixed event params for attribution.
  // Bare "source"/"medium" are NOT recognized. Always use utm_source, utm_medium, etc.
  return {
    session_id: sessionId,
    utm_source: utmParams.utm_source || source,
    utm_medium: utmParams.utm_medium || medium,
    ...(utmParams.utm_campaign && { utm_campaign: utmParams.utm_campaign }),
    ...(utmParams.utm_content && { utm_content: utmParams.utm_content }),
    ...(utmParams.utm_term && { utm_term: utmParams.utm_term }),
  };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd ~/iCode/projects/rrm-academy-cf && node --test test/ga4-source.test.js`
Expected: All 22 tests PASS

- [ ] **Step 3: Commit**

```bash
git add functions/api/_ga4-source.js
git commit -m "feat: add server-side GA4 source classification module

Classifies referrer into source/medium (search, social, referral, direct),
extracts UTM params, and generates stable session IDs. Zero client-side JS."
```

---

## Chunk 2: Wire Source Attribution into Middleware + Conversion Helper

### Task 3: Update middleware to send source params with page_view

**Files:**
- Modify: `functions/_middleware.js:1-67` (the `sendPageView` function and imports)

The middleware already has its own `getClientId()` function (identical to the one in `_ga4.js`). We import `buildSourceParams` from the new module and spread the result into the page_view payload.

- [ ] **Step 1: Add import at top of `_middleware.js`**

After line 11 (`import { getSessionIdFromCookie, ... }`), add:

```js
import { buildSourceParams } from './api/_ga4-source.js';
```

- [ ] **Step 2: Update `sendPageView` to include source params**

Replace the existing payload construction (lines 45-54) with:

```js
    const clientId = await getClientId(request);
    const sourceParams = await buildSourceParams(request, clientId);
    const payload = {
      client_id: clientId,
      events: [{
        name: 'page_view',
        params: {
          page_location: request.url,
          page_referrer: request.headers.get('Referer') || '',
          ...sourceParams,
        },
      }],
    };
```

The full `sendPageView` function after this change:

```js
async function sendPageView(request, env) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;

  const url = new URL(request.url);

  // Only fire for HTML page requests -- skip API routes and assets
  if (url.pathname.startsWith('/api/')) return;
  const accept = request.headers.get('Accept') || '';
  if (!accept.includes('text/html')) return;

  try {
    const clientId = await getClientId(request);
    const sourceParams = await buildSourceParams(request, clientId);
    const payload = {
      client_id: clientId,
      events: [{
        name: 'page_view',
        params: {
          page_location: request.url,
          page_referrer: request.headers.get('Referer') || '',
          ...sourceParams,
        },
      }],
    };

    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    // Silent -- never let analytics failures affect the user
  }
}
```

- [ ] **Step 3: Update guard manifest**

Run: `cd ~/iCode/projects/rrm-academy-cf && npm run guard:update`
Expected: `guard-manifest.json` updated with new hash for `_middleware.js`

- [ ] **Step 4: Commit**

```bash
git add functions/_middleware.js guard-manifest.json
git commit -m "feat: add source attribution to GA4 page_view events

Sends session_id, source, medium, and UTM params via Measurement Protocol.
Fixes '(not set)' source attribution in GA4 reports."
```

---

### Task 4: Update `_ga4.js` to include source params on conversion events

**Files:**
- Modify: `functions/api/_ga4.js`

Conversion events (sign_up, purchase, etc.) need the same source/session params so GA4 can attribute conversions to the session that triggered them. Same `client_id` derivation already exists in this file.

- [ ] **Step 1: Add import and update `sendGA4Event`**

Replace the full content of `_ga4.js`:

```js
/**
 * GA4 Measurement Protocol helper for server-side conversion tracking.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Usage: fire-and-forget after successful actions:
 *   sendGA4Event(env, request, 'purchase', { value: 10.00, currency: 'USD' }).catch(() => {});
 */

import { buildSourceParams } from './_ga4-source.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

async function getClientId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const raw = new TextEncoder().encode(`${ip}:${ua}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', raw);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export async function sendGA4Event(env, request, eventName, params = {}) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return;

  try {
    const clientId = await getClientId(request);
    const sourceParams = await buildSourceParams(request, clientId);
    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          page_location: request.url,
          ...sourceParams,
          ...params,
        },
      }],
    };

    await fetch(
      `${GA4_ENDPOINT}?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
  } catch {
    // Silent -- never let analytics failures affect the user
  }
}
```

Note: `params` is spread AFTER `sourceParams` so caller-provided params (like `value`, `currency`, `items`) take precedence and aren't overwritten.

- [ ] **Step 2: Verify existing callers don't need changes**

All 10 callsites use: `sendGA4Event(env, request, 'event_name', { ... }).catch(() => {})`
The signature hasn't changed. No caller modifications needed.

Callsites to sanity-check (read-only):
- `functions/api/auth/signup.js:114`
- `functions/api/auth/google-callback.js:91`
- `functions/api/courses/enroll.js:70,113`
- `functions/api/create-checkout.js:121,179`
- `functions/api/stripe-webhook.js:176,231,238`
- `functions/api/newsletter/subscribe.js:115`
- `functions/api/survey/submit.js:159`
- `functions/api/survey/request.js:102`

- [ ] **Step 3: Run guard to verify non-guarded files are fine**

Run: `cd ~/iCode/projects/rrm-academy-cf && npm run guard`
Expected: PASS (only `_middleware.js` is guarded, and its hash was updated in Task 3)

- [ ] **Step 4: Commit**

```bash
git add functions/api/_ga4.js
git commit -m "feat: add source attribution to GA4 conversion events

Conversion events now include session_id, source, medium, and UTM params,
matching the page_view attribution from middleware."
```

---

## Chunk 3: Update Admin Dashboard for Conversions by Source

### Task 5: Add "conversions by source" query to the conversions API

**Files:**
- Modify: `functions/api/admin/conversions.js:73-139` (the `fetchReport` function)

- [ ] **Step 1: Add a third query to `fetchReport` for conversions by source**

In `fetchReport()`, change the `Promise.all` to include a third query. Replace the function (lines 73-139):

```js
async function fetchReport(accessToken, propertyId, startDate) {
  const [summary, daily, bySource] = await Promise.all([
    runReport(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [
        { name: 'eventCount' },
        { name: 'totalUsers' },
      ],
      dimensions: [{ name: 'eventName' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['purchase', 'begin_checkout', 'sign_up', 'generate_lead', 'page_view'],
          },
        },
      },
    }),
    runReport(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [{ name: 'eventCount' }],
      dimensions: [{ name: 'date' }, { name: 'eventName' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['purchase', 'begin_checkout', 'sign_up', 'generate_lead', 'page_view'],
          },
        },
      },
      orderBys: [{ dimension: { dimensionName: 'date' } }],
    }),
    runReport(accessToken, propertyId, {
      dateRanges: [{ startDate, endDate: 'today' }],
      metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
      dimensions: [{ name: 'sessionSource' }, { name: 'eventName' }],
      dimensionFilter: {
        filter: {
          fieldName: 'eventName',
          inListFilter: {
            values: ['purchase', 'begin_checkout', 'sign_up', 'generate_lead', 'page_view'],
          },
        },
      },
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
      limit: 100,
    }),
  ]);

  // Parse summary into clean object
  const events = {};
  for (const row of summary.rows || []) {
    const name = row.dimensionValues[0].value;
    events[name] = {
      count: parseInt(row.metricValues[0].value, 10),
      users: parseInt(row.metricValues[1].value, 10),
    };
  }

  // Parse daily into array
  const dailyData = {};
  for (const row of daily.rows || []) {
    const date = row.dimensionValues[0].value;
    const event = row.dimensionValues[1].value;
    const count = parseInt(row.metricValues[0].value, 10);
    if (!dailyData[date]) dailyData[date] = {};
    dailyData[date][event] = count;
  }

  const timeline = Object.entries(dailyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({ date, ...counts }));

  // Parse conversions by source
  // Group: { "google": { page_view: {count, users}, sign_up: {count, users}, ... }, ... }
  const sourceData = {};
  for (const row of bySource.rows || []) {
    const source = row.dimensionValues[0].value;
    const event = row.dimensionValues[1].value;
    const count = parseInt(row.metricValues[0].value, 10);
    const users = parseInt(row.metricValues[1].value, 10);
    if (!sourceData[source]) sourceData[source] = {};
    sourceData[source][event] = { count, users };
  }

  // Flatten to sorted array for the dashboard
  const sources = Object.entries(sourceData)
    .map(([source, events]) => ({
      source,
      views: events.page_view?.count || 0,
      signups: events.sign_up?.count || 0,
      leads: events.generate_lead?.count || 0,
      checkouts: events.begin_checkout?.count || 0,
      purchases: events.purchase?.count || 0,
    }))
    .sort((a, b) => b.views - a.views);

  return {
    period: startDate,
    events,
    timeline,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/api/admin/conversions.js
git commit -m "feat: add conversions-by-source query to admin API

New 'sources' array in the response shows page_view, sign_up,
generate_lead, begin_checkout, and purchase counts per traffic source."
```

---

### Task 6: Add source breakdown table to conversions dashboard

**Files:**
- Modify: `src/pages/admin/conversions.astro`

- [ ] **Step 1: Add the source table HTML after the daily breakdown table**

After the `<p class="cv-meta" id="cv-meta"></p>` line (line 108), add:

```html
      <h2 class="cv-table-heading">Conversions by Source</h2>
      <div class="cv-table-wrap">
        <table class="cv-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Views</th>
              <th>Signups</th>
              <th>Leads</th>
              <th>Checkouts</th>
              <th>Purchases</th>
            </tr>
          </thead>
          <tbody id="cv-source-tbody">
            <tr><td colspan="6" class="cv-empty">Loading...</td></tr>
          </tbody>
        </table>
      </div>
```

- [ ] **Step 2: Update the `render()` function in the script to populate the source table**

Inside the `render(report)` function, after the daily table rendering block (after `tbody.innerHTML = ...`), add:

```js
      // Source table
      var sources = report.sources || [];
      var srcTbody = document.getElementById('cv-source-tbody');
      if (!sources.length) {
        srcTbody.innerHTML = '<tr><td colspan="6" class="cv-empty">No source data yet</td></tr>';
      } else {
        srcTbody.innerHTML = sources.map(function (s) {
          return '<tr>' +
            '<td>' + s.source + '</td>' +
            '<td>' + num(s.views) + '</td>' +
            '<td>' + num(s.signups) + '</td>' +
            '<td>' + num(s.leads) + '</td>' +
            '<td>' + num(s.checkouts) + '</td>' +
            '<td>' + num(s.purchases) + '</td>' +
            '</tr>';
        }).join('');
      }
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/conversions.astro
git commit -m "feat: add conversions-by-source table to admin dashboard

Shows page views, signups, leads, checkouts, and purchases
broken down by traffic source (google, instagram, direct, etc.)."
```

---

## Chunk 4: Verification + Deploy

### Task 7: Local verification

- [ ] **Step 1: Run tests**

Run: `cd ~/iCode/projects/rrm-academy-cf && node --test test/ga4-source.test.js`
Expected: All 22 tests PASS

- [ ] **Step 2: Run guard**

Run: `cd ~/iCode/projects/rrm-academy-cf && npm run guard`
Expected: PASS

- [ ] **Step 3: Run ESLint**

Run: `cd ~/iCode/projects/rrm-academy-cf && npm run lint`
Expected: No errors in `functions/`

- [ ] **Step 4: Build the site**

Run: `cd ~/iCode/projects/rrm-academy-cf && npm run build:astro`
Expected: Build succeeds (confirms the Astro template changes compile)

### Task 8: Validate payload against GA4 debug endpoint

Before deploying, confirm GA4 accepts the new payload format.

- [ ] **Step 1: Send a test hit to the GA4 debug endpoint**

Run (substituting real secrets from CF Pages env):
```bash
curl -s -X POST \
  'https://www.google-analytics.com/debug/mp/collect?measurement_id=G-TSWRY7XLR0&api_secret=YOUR_SECRET' \
  -H 'Content-Type: application/json' \
  -d '{
    "client_id": "test1234abcd5678",
    "events": [{
      "name": "page_view",
      "params": {
        "page_location": "https://rrmacademy.org/",
        "page_referrer": "https://www.google.com/search?q=rrm",
        "session_id": 3847291056,
        "utm_source": "google",
        "utm_medium": "organic"
      }
    }]
  }' | python3 -m json.tool
```

Expected: `validationMessages` array is empty (no errors). If there are validation errors, fix the param names/types before deploying.

---

### Task 9: Deploy and validate

- [ ] **Step 1: Push to main**

```bash
cd ~/iCode/projects/rrm-academy-cf && git push origin main
```

- [ ] **Step 2: Monitor GitHub Actions deploy**

Check GitHub Actions completes successfully.

- [ ] **Step 3: Validate source data appears in GA4**

Wait 24-48 hours after deploy, then query GA4:

```bash
source ~/.zshrc && TOKEN=$(gcloud auth application-default print-access-token)
curl -s -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-goog-user-project: rrm-academy" \
  "https://analyticsdata.googleapis.com/v1beta/properties/526304690:runReport" \
  -d '{"dateRanges":[{"startDate":"2daysAgo","endDate":"today"}],"dimensions":[{"name":"sessionSource"},{"name":"sessionMedium"}],"metrics":[{"name":"sessions"},{"name":"totalUsers"}],"orderBys":[{"metric":{"metricName":"sessions"},"desc":true}],"limit":10}'
```

Expected: `sessionSource` values like `google`, `instagram`, `(direct)` instead of `(not set)`.

- [ ] **Step 4: Check admin dashboard**

Visit `https://rrmacademy.org/admin/conversions/` and verify:
- Existing metrics still load
- New "Conversions by Source" table appears (may show "(not set)" for historical data, but new data should have source values)

---

## Notes

**Data transition:** Historical data will remain `(not set)`. Source attribution only applies to hits after deploy. The dashboard will show a mix until enough new data accumulates (7-14 days).

**Session granularity:** Session ID is per client per day. This is coarser than GA4's default 30-minute inactivity timeout, but works well for server-side where we can't track idle time. One user visiting 3 times in a day = one session. This is a reasonable tradeoff for zero-cookie, zero-JS tracking.

**UTM priority:** When UTM params are present in the URL, they override referrer-based classification. This matches GA4's standard behavior and ensures link campaigns (newsletter, social posts with tracking links) attribute correctly.

**Stripe webhook caveat:** Handled in Chunk 5 below. The checkout endpoint captures the user's source at purchase intent time and passes it through Stripe metadata so the webhook can replay it on the `purchase` event.

---

## Chunk 5: Stripe Purchase Attribution

The `stripe-webhook.js` handler receives requests from Stripe's servers, not the user's browser. Without intervention, all `purchase` events would attribute to `(direct)` because the webhook request has Stripe's IP and no referrer/UTM params.

**Fix:** At checkout time (`create-checkout.js`), the `request` IS the user's browser. Capture `utm_source`, `utm_medium`, `utm_campaign`, and the referrer-derived source into Stripe's `metadata` field. On webhook receipt, read it back and pass it to `sendGA4Event` as overrides.

### Task 10: Capture source at checkout time

**Files:**
- Modify: `functions/api/create-checkout.js:19-124,178-182`

- [ ] **Step 1: Import source helpers and capture source in checkout metadata**

Add import after line 19:

```js
import { classifySource, extractUtm } from './_ga4-source.js';
```

- [ ] **Step 2: Build source metadata before creating checkout sessions**

In `handleCheckout()`, after the `const origin = SITE_URL;` line (line 85), add:

```js
  // Capture traffic source from the user's browser request for webhook attribution
  const referrer = request.headers.get('Referer') || '';
  const utmParams = extractUtm(request.url);
  const { source, medium } = classifySource(referrer);
  const gaSource = utmParams.utm_source || source;
  const gaMedium = utmParams.utm_medium || medium;
  const gaCampaign = utmParams.utm_campaign || '';
```

- [ ] **Step 3: Add `ga_source`, `ga_medium`, `ga_campaign` to both checkout session metadata objects**

For the **donation** path (mode === 'payment'), add to `sessionParams` after `customer_creation` / `customer_email` / `client_reference_id` lines but before `stripe.checkout.sessions.create()`:

```js
    sessionParams.metadata = {
      ...(sessionParams.metadata || {}),
      ga_source: gaSource,
      ga_medium: gaMedium,
      ...(gaCampaign && { ga_campaign: gaCampaign }),
    };
```

For the **subscription** path (mode === 'subscription'), the `sessionParams` already has `metadata: { tier }`. Update it:

```js
    sessionParams.metadata = {
      ...sessionParams.metadata,
      ga_source: gaSource,
      ga_medium: gaMedium,
      ...(gaCampaign && { ga_campaign: gaCampaign }),
    };
```

- [ ] **Step 4: Update guard manifest**

Run: `cd ~/iCode/projects/rrm-academy-cf && npm run guard:update`
Expected: `guard-manifest.json` updated with new hash for `create-checkout.js`

- [ ] **Step 5: Commit**

```bash
git add functions/api/create-checkout.js guard-manifest.json
git commit -m "feat: capture traffic source in Stripe checkout metadata

Stores ga_source, ga_medium, ga_campaign from the user's browser
request into Stripe session metadata for webhook attribution."
```

---

### Task 11: Replay source on webhook purchase events

**Files:**
- Modify: `functions/api/stripe-webhook.js:174-244` (the `purchase` GA4 calls)

The webhook handler already has access to `session.metadata` (the Stripe checkout session object). We read `ga_source`, `ga_medium`, `ga_campaign` from it and pass them as overrides to `sendGA4Event`.

- [ ] **Step 1: Update the three `sendGA4Event('purchase', ...)` calls to include source overrides**

For each of the three purchase event calls (lines 176, 231, 238), add the source params from metadata. The pattern is the same for all three -- add these keys to the params object:

```js
      ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
      ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
      ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
```

**Line 176 (course purchase)** -- the full call becomes:

```js
        sendGA4Event(env, request, 'purchase', {
          currency: 'USD',
          value: (session.amount_total || 0) / 100,
          transaction_id: session.payment_intent,
          items: [{ item_name: `Course: ${session.metadata.courseId || 'unknown'}` }],
          ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
          ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
          ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
        }).catch(() => {});
```

**Line 231 (donation purchase)** -- the full call becomes:

```js
        sendGA4Event(env, request, 'purchase', {
          currency: 'USD',
          value: (session.amount_total || 0) / 100,
          transaction_id: session.payment_intent || session.id,
          items: [{ item_name: 'Donation' }],
          ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
          ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
          ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
        }).catch(() => {});
```

**Line 238 (STUC membership purchase)** -- the full call becomes:

```js
        sendGA4Event(env, request, 'purchase', {
          currency: 'USD',
          value: (session.amount_total || 0) / 100,
          transaction_id: session.subscription || session.id,
          items: [{ item_name: `STUC ${stucTiers[tier]}` }],
          ...(session.metadata?.ga_source && { utm_source: session.metadata.ga_source }),
          ...(session.metadata?.ga_medium && { utm_medium: session.metadata.ga_medium }),
          ...(session.metadata?.ga_campaign && { utm_campaign: session.metadata.ga_campaign }),
        }).catch(() => {});
```

Note: These `utm_*` params are spread AFTER `sourceParams` inside `sendGA4Event`, so they override the Stripe-server-derived source with the original user's source. This works because `sendGA4Event` spreads caller `params` last (see Task 4).

- [ ] **Step 2: Update guard manifest**

Run: `cd ~/iCode/projects/rrm-academy-cf && npm run guard:update`
Expected: `guard-manifest.json` updated with new hash for `stripe-webhook.js`

- [ ] **Step 3: Commit**

```bash
git add functions/api/stripe-webhook.js guard-manifest.json
git commit -m "feat: attribute purchase events to original traffic source

Reads ga_source/ga_medium/ga_campaign from Stripe session metadata
(captured at checkout) and passes as utm_* overrides to GA4."
```

---

### Task 12: Add test for source metadata round-trip

**Files:**
- Modify: `test/ga4-source.test.js`

- [ ] **Step 1: Add test for the round-trip pattern**

Append to the test file:

```js
describe('source metadata round-trip (checkout -> webhook)', () => {
  it('extractUtm + classifySource produce values that override in sendGA4Event', () => {
    // Simulates: user arrives from Instagram with UTM params
    const referrer = 'https://l.instagram.com/something';
    const url = 'https://rrmacademy.org/donate?utm_source=ig_bio&utm_medium=social&utm_campaign=spring2026';

    const { source, medium } = classifySource(referrer);
    const utmParams = extractUtm(url);

    // UTM params take priority over referrer
    const gaSource = utmParams.utm_source || source;
    const gaMedium = utmParams.utm_medium || medium;

    assert.equal(gaSource, 'ig_bio');
    assert.equal(gaMedium, 'social');

    // Without UTMs, falls back to referrer
    const url2 = 'https://rrmacademy.org/donate';
    const utmParams2 = extractUtm(url2);
    const gaSource2 = utmParams2.utm_source || source;
    const gaMedium2 = utmParams2.utm_medium || medium;

    assert.equal(gaSource2, 'instagram');
    assert.equal(gaMedium2, 'social');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd ~/iCode/projects/rrm-academy-cf && node --test test/ga4-source.test.js`
Expected: All 23 tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/ga4-source.test.js
git commit -m "test: add source metadata round-trip test for checkout->webhook flow"
```
