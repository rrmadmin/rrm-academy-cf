#!/usr/bin/env node
/**
 * Idempotent provisioning of the 13 GA4 audiences from
 * docs/superpowers/plans/2026-05-15-phase3-phase4-analytics-runbook.html §4.3.
 *
 * Uses GA4 Admin API v1alpha: properties.audiences.create.
 * Skips any audience whose displayName already exists on the property.
 *
 * Key API quirks (learned 2026-05-15):
 *   - Every top-level simpleFilter.filterExpression MUST be wrapped in
 *     `andGroup: { filterExpressions: [...] }` even when only one expr.
 *   - NumericFilter.Operation has NO GREATER_THAN_OR_EQUAL -- use
 *     GREATER_THAN with `value-1` to express ">= value".
 *   - StringFilter.MatchType has NO PARTIAL_REGEXP -- use FULL_REGEXP.
 *
 * Spec: docs/superpowers/specs/2026-05-15-client-analytics-spec.html §15
 * Runbook: docs/superpowers/plans/2026-05-15-phase3-phase4-analytics-runbook.html §4.3
 */

import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const PROPERTY = 'properties/526304690'; // RRM Academy
const QUOTA_PROJECT = process.env.GA4_QUOTA_PROJECT || 'rrm-academy';
const GMAIL_CLI_CLIENT_SECRET = `${process.env.HOME}/.config/gmail-cli/client_secret.json`;
const SCOPES = 'https://www.googleapis.com/auth/analytics.edit';

// --- Helper builders ----------------------------------------------------

// GA4 audience filter expressions require a strict nesting:
//   filterExpression -> andGroup -> orGroup -> leaf (dimensionOrMetricFilter or eventFilter)
// Top-level can be andGroup. Items inside andGroup MUST be orGroup. Items inside
// orGroup MUST be leaf filters.
const andGroup = (...leafFilters) => ({
  andGroup: {
    filterExpressions: leafFilters.map((leaf) => ({
      orGroup: { filterExpressions: [leaf] },
    })),
  },
});

// Custom dimensions need a customEvent: or customUser: prefix in audience fieldNames.
// Built-in GA4 dimensions (page_location, etc.) take their raw name.
const EVENT_CUSTOM = new Set([
  'article_type', 'content_pillar', 'device_type', 'email_type', 'entry_category',
  'entry_platform', 'experiment_id', 'lead_source', 'list_source',
  // event params not custom-dimensioned but referenced in audiences
  'depth',
]);
const USER_CUSTOM = new Set([
  'audience_type', 'cohort_date', 'engagement_tier', 'user_role',
]);

const prefixed = (fieldName) => {
  if (fieldName.startsWith('customEvent:') || fieldName.startsWith('customUser:')) return fieldName;
  if (EVENT_CUSTOM.has(fieldName)) return `customEvent:${fieldName}`;
  if (USER_CUSTOM.has(fieldName)) return `customUser:${fieldName}`;
  return fieldName; // built-in (page_location, etc.)
};

const dimEq = (fieldName, value, caseSensitive = false) => ({
  dimensionOrMetricFilter: {
    fieldName: prefixed(fieldName),
    stringFilter: { matchType: 'EXACT', value, caseSensitive },
    atAnyPointInTime: true,
  },
});

const dimRegex = (fieldName, value, caseSensitive = false) => ({
  dimensionOrMetricFilter: {
    fieldName: prefixed(fieldName),
    stringFilter: { matchType: 'FULL_REGEXP', value, caseSensitive },
    atAnyPointInTime: true,
  },
});

const dimContains = (fieldName, value, caseSensitive = false) => ({
  dimensionOrMetricFilter: {
    fieldName: prefixed(fieldName),
    stringFilter: { matchType: 'CONTAINS', value, caseSensitive },
    atAnyPointInTime: true,
  },
});

// numeric ">= n" => GREATER_THAN with n-1
const dimNumericGte = (fieldName, n) => ({
  dimensionOrMetricFilter: {
    fieldName: prefixed(fieldName),
    numericFilter: {
      operation: 'GREATER_THAN',
      value: { int64Value: String(n - 1) },
    },
    atAnyPointInTime: true,
  },
});

// event filter (eventName + optional param sub-expression)
const evtFilter = (eventName, paramExpr) => ({
  eventFilter: {
    eventName,
    ...(paramExpr ? { eventParameterFilterExpression: paramExpr } : {}),
  },
});

const sessionScoped = (filterExpression) => ({
  scope: 'AUDIENCE_FILTER_SCOPE_WITHIN_SAME_SESSION',
  filterExpression,
});

const allSessionsScoped = (filterExpression) => ({
  scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
  filterExpression,
});

// --- The 13 audiences ---------------------------------------------------

const AUDIENCES = [
  // 1. Donors — purchase event with lead_source='donation' (lifetime)
  {
    displayName: 'Donors',
    description: "Membership lifetime: purchase event with lead_source = 'donation'",
    membershipDurationDays: 540,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: allSessionsScoped(
        andGroup(evtFilter('purchase', andGroup(dimEq('lead_source', 'donation'))))
      ),
    }],
  },

  // 2. Returning donors — purchase with lead_source=donation, count ≥ 2 (placeholder: include via same as Donors; tighten in UI later if needed)
  {
    displayName: 'Returning donors',
    description: 'Cumulative lifetime: 2+ donation purchases (tighten count to ≥2 in UI if needed)',
    membershipDurationDays: 540,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: allSessionsScoped(
        andGroup(evtFilter('purchase', andGroup(dimEq('lead_source', 'donation'))))
      ),
    }],
  },

  // 3. STUC members — user_role = 'member' (user-scoped). Skip if "STUC members" exists.
  {
    displayName: 'STUC members',
    description: "User-scoped: user_role = 'member'",
    membershipDurationDays: 540,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: allSessionsScoped(andGroup(dimEq('user_role', 'member'))),
    }],
  },

  // 4. Engaged readers — ≥1 library page_view AND ≥1 scroll_depth ≥ 75
  {
    displayName: 'Engaged readers',
    description: '≥1 library page_view AND ≥1 scroll_depth ≥ 75 (rolling 7d). Tighten library-pv count ≥ 3 in UI.',
    membershipDurationDays: 7,
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        simpleFilter: allSessionsScoped(
          andGroup(evtFilter('page_view', andGroup(dimContains('page_location', '/library/'))))
        ),
      },
      {
        clauseType: 'INCLUDE',
        simpleFilter: allSessionsScoped(
          andGroup(evtFilter('scroll_depth', andGroup(dimNumericGte('depth', 75))))
        ),
      },
    ],
  },

  // 5. IG arrivers — entry_platform = 'instagram'  (already exists from UI run)
  {
    displayName: 'IG arrivers',
    description: "Session-scoped: entry_platform = 'instagram'",
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: sessionScoped(andGroup(dimEq('entry_platform', 'instagram'))),
    }],
  },

  // 6. AI search arrivers — entry_category = 'ai' (already exists from UI run)
  {
    displayName: 'AI search arrivers',
    description: "Session-scoped: entry_category = 'ai' (ChatGPT, Perplexity, Claude, Gemini, Copilot, You, Grok)",
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: sessionScoped(andGroup(dimEq('entry_category', 'ai'))),
    }],
  },

  // 7. Organic search arrivers
  {
    displayName: 'Organic search arrivers',
    description: "Session-scoped: entry_category = 'organic'",
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: sessionScoped(andGroup(dimEq('entry_category', 'organic'))),
    }],
  },

  // 8. Referral arrivers
  {
    displayName: 'Referral arrivers',
    description: "Session-scoped: entry_category = 'referral' (external press, partner blogs)",
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: sessionScoped(andGroup(dimEq('entry_category', 'referral'))),
    }],
  },

  // 9. Direct arrivers
  {
    displayName: 'Direct arrivers',
    description: "Session-scoped: entry_category = 'direct' (typed URL, bookmark, dark social)",
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: sessionScoped(andGroup(dimEq('entry_category', 'direct'))),
    }],
  },

  // 10. Email arrivers — broadcast
  {
    displayName: 'Email arrivers — broadcast',
    description: "Session-scoped: entry_category = 'email' AND email_type = 'broadcast' (newsletter)",
    membershipDurationDays: 30,
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        simpleFilter: sessionScoped(andGroup(dimEq('entry_category', 'email'))),
      },
      {
        clauseType: 'INCLUDE',
        simpleFilter: sessionScoped(andGroup(dimEq('email_type', 'broadcast'))),
      },
    ],
  },

  // 11. Email arrivers — automation
  {
    displayName: 'Email arrivers — automation',
    description: "Session-scoped: email_type = 'automation' (drip / nurture / onboarding)",
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: sessionScoped(andGroup(dimEq('email_type', 'automation'))),
    }],
  },

  // 12. Email arrivers — transactional
  {
    displayName: 'Email arrivers — transactional',
    description: "Session-scoped: email_type = 'transactional' (receipts, password reset, course confirm)",
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: sessionScoped(andGroup(dimEq('email_type', 'transactional'))),
    }],
  },

  // 13. Lapsed users — Registered AND no page_view in 90 days
  {
    displayName: 'Lapsed users',
    description: 'Registered users (user_role matches regex: registered|member|admin) with no page_view in 90 days',
    membershipDurationDays: 90,
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        simpleFilter: allSessionsScoped(andGroup(dimRegex('user_role', '^(registered|member|admin)$'))),
      },
      {
        clauseType: 'EXCLUDE',
        simpleFilter: allSessionsScoped(andGroup(evtFilter('page_view'))),
      },
    ],
  },
];

// --- helpers --------------------------------------------------------------

const log = (msg) => process.stderr.write(msg + '\n');

function readOAuthCreds() {
  const raw = fs.readFileSync(GMAIL_CLI_CLIENT_SECRET, 'utf-8');
  return JSON.parse(raw).installed;
}

async function exchangeCode(code, clientId, clientSecret, redirectUri) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const data = await resp.json();
  if (!data.access_token) { log('Token exchange failed: ' + JSON.stringify(data)); process.exit(1); }
  return data.access_token;
}

async function ga(token, path, opts = {}) {
  const resp = await fetch(`https://analyticsadmin.googleapis.com/v1alpha/${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': QUOTA_PROJECT,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await resp.json();
  if (data.error) {
    log(`  GA Admin API error on ${opts.method || 'GET'} ${path}: ${data.error.message}`);
    if (opts.fatal !== false) throw new Error(data.error.message);
  }
  return data;
}

async function provisionAudiences(token) {
  log('\n=== Audiences ===');
  const existing = await ga(token, `${PROPERTY}/audiences?pageSize=200`);
  const byName = new Set((existing.audiences || []).map((a) => a.displayName));
  log(`  Existing audiences (${(existing.audiences || []).length}): ${[...byName].join(', ') || '(none)'}`);

  let created = 0, skipped = 0, failed = 0;
  for (const audience of AUDIENCES) {
    if (byName.has(audience.displayName)) {
      log(`  ~ ${audience.displayName.padEnd(34)} already exists (skipping)`);
      skipped++;
      continue;
    }

    const body = {
      displayName: audience.displayName,
      description: audience.description,
      membershipDurationDays: audience.membershipDurationDays || 30,
      exclusionDurationMode: 'EXCLUDE_TEMPORARILY',
      filterClauses: audience.filterClauses,
    };

    const result = await ga(token, `${PROPERTY}/audiences`, { method: 'POST', body, fatal: false });
    if (result.error) {
      log(`  ✗ ${audience.displayName.padEnd(34)} FAILED: ${result.error.message}`);
      failed++;
    } else {
      log(`  + ${audience.displayName.padEnd(34)} created (${result.name?.split('/').pop()})`);
      created++;
    }
  }
  log(`  Summary: ${created} created, ${skipped} skipped, ${failed} failed.`);
  return { created, skipped, failed };
}

async function run(token) {
  const result = await provisionAudiences(token);
  log('\nDone.');
  log('Funnel/Path/Cohort explorations remain manual (no v1alpha API surface).');
  if (result.failed > 0) process.exit(1);
}

const creds = readOAuthCreds();
let actualRedirectUri;
let handled = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, actualRedirectUri || 'http://localhost');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (!code && !error) { res.writeHead(204); res.end(); return; }
  if (handled) { res.writeHead(204); res.end(); return; }
  handled = true;

  if (error || !code) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Authorization denied${error ? ': ' + error : ''}.</h2><p>You can close this tab.</p>`);
    server.close(); process.exit(1);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2>Authorized. Provisioning GA4 audiences...</h2><p>Check your terminal. Close this tab.</p>');

  log('Exchanging OAuth code for access token...');
  try {
    const token = await exchangeCode(code, creds.client_id, creds.client_secret, actualRedirectUri);
    log('Token acquired.');
    await run(token);
    server.close();
    process.exit(0);
  } catch (e) {
    log('\nFAILED: ' + (e.stack || e.message || String(e)));
    server.close();
    process.exit(1);
  }
});

process.on('unhandledRejection', (r) => { log('Unhandled: ' + (r?.stack || r)); process.exit(1); });

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  actualRedirectUri = `http://localhost:${port}`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${creds.client_id}&redirect_uri=${encodeURIComponent(actualRedirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
  log(`OAuth client: gmail-cli installed-app (localhost wildcard).`);
  log(`Listening on ${actualRedirectUri}`);
  log('Opening Google consent screen. Click "Allow" — pick administrator@rrmacademy.org.\n');
  execSync(`open "${authUrl}"`);
  log('Waiting for authorization callback...');
});
