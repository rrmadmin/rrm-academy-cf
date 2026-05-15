#!/usr/bin/env node
/**
 * One-time GA4 dashboard provisioning for Phase 4 of the client-analytics spec.
 *
 * What this script does (API-able, ~30 sec):
 *   - Creates 13 custom dimensions (user_role, entry_category, entry_platform,
 *     content_pillar, device_type, lead_source, article_type, email_type,
 *     list_source, engagement_tier, cohort_date, audience_type, experiment_id)
 *   - Marks 7 events as conversions / Key Events (sign_up, generate_lead,
 *     begin_checkout, purchase, pdf_download, copy_citation, video_complete)
 *
 * What this script does NOT do (manual only — no GA4 Admin API surface):
 *   - 13 saved audiences (Audience API has gaps; safer in dashboard)
 *   - 20 funnel explorations (no API)
 *   - 4 path explorations (no API)
 *   - cohort exploration (no API)
 *   - scroll_depth=100 conditional conversion (requires Modify event rule)
 *
 * Runs on the rrm-academy property (526304690). Idempotent: skips items that
 * already exist by displayName.
 *
 * Auth: same gmail-cli OAuth client + scope as ga4-rotate-mp-secret.mjs.
 * Required: analytics.edit. User clicks Authorize once in their browser.
 *
 * Spec: docs/superpowers/specs/2026-05-15-client-analytics-spec.html
 * Runbook: docs/superpowers/plans/2026-05-15-phase3-phase4-analytics-runbook.html
 */

import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const PROPERTY = 'properties/526304690'; // RRM Academy
const QUOTA_PROJECT = process.env.GA4_QUOTA_PROJECT || 'rrm-academy';
const GMAIL_CLI_CLIENT_SECRET = `${process.env.HOME}/.config/gmail-cli/client_secret.json`;
const SCOPES = 'https://www.googleapis.com/auth/analytics.edit';

// --- Spec §15.2 + §15.3 -------------------------------------------------

const CUSTOM_DIMENSIONS = [
  // displayName, parameterName, scope, description
  ['User Role',          'user_role',       'USER',    'anonymous / registered / member / admin'],
  ['Entry Category',     'entry_category',  'EVENT',   'direct / organic / social / referral / ai / email / paid'],
  ['Entry Platform',     'entry_platform',  'EVENT',   'instagram, chatgpt, perplexity, google, ...'],
  ['Content Pillar',     'content_pillar',  'EVENT',   'which pillar page (what-is-rrm, naprotechnology, ...)'],
  ['Device Type',        'device_type',     'EVENT',   'mobile / tablet / desktop'],
  ['Lead Source',        'lead_source',     'EVENT',   'newsletter, endo_survey, waitlist, course, donation'],
  ['Article Type',       'article_type',    'EVENT',   'research / commentary / faq / guide / glossary'],
  ['Email Type',         'email_type',      'EVENT',   'broadcast / automation / transactional'],
  ['List Source',        'list_source',     'EVENT',   'where the subscriber was first captured'],
  ['Engagement Tier',    'engagement_tier', 'USER',    'cold / warm / hot (computed from recency + count)'],
  ['Cohort Date',        'cohort_date',     'USER',    'first-touch month YYYY-MM (cohort retention key)'],
  ['Audience Type',      'audience_type',   'USER',    'clinician / researcher / student / donor / patient-advocate'],
  ['Experiment ID',      'experiment_id',   'EVENT',   'A/B test variant ID (reserved for future)'],
];

// 7 conversions can be marked as Key Events via API.
// scroll_depth requires a Modify Event rule (conditional on depth=100 + article_type)
// which has no v1alpha API surface today -- documented as manual in runbook.
const KEY_EVENTS = [
  'sign_up',
  'generate_lead',
  'begin_checkout',
  'purchase',
  'pdf_download',
  'copy_citation',
  'video_complete',
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

// --- main workflow --------------------------------------------------------

async function provisionCustomDimensions(token) {
  log('\n=== Custom dimensions ===');
  const existing = await ga(token, `${PROPERTY}/customDimensions?pageSize=200`);
  const byParam = new Map((existing.customDimensions || []).map((d) => [d.parameterName, d]));
  let created = 0, skipped = 0;
  for (const [displayName, parameterName, scope, description] of CUSTOM_DIMENSIONS) {
    if (byParam.has(parameterName)) {
      log(`  ~ ${parameterName.padEnd(18)} already exists (skipping)`);
      skipped++;
      continue;
    }
    await ga(token, `${PROPERTY}/customDimensions`, {
      method: 'POST',
      body: { parameterName, displayName, scope, description },
    });
    log(`  + ${parameterName.padEnd(18)} created (scope=${scope})`);
    created++;
  }
  log(`  Summary: ${created} created, ${skipped} skipped.`);
}

async function markKeyEvents(token) {
  log('\n=== Key Events (conversions) ===');
  const existing = await ga(token, `${PROPERTY}/keyEvents?pageSize=200`);
  const byName = new Set((existing.keyEvents || []).map((k) => k.eventName));
  let created = 0, skipped = 0;
  for (const eventName of KEY_EVENTS) {
    if (byName.has(eventName)) {
      log(`  ~ ${eventName.padEnd(18)} already marked (skipping)`);
      skipped++;
      continue;
    }
    await ga(token, `${PROPERTY}/keyEvents`, {
      method: 'POST',
      body: { eventName, countingMethod: 'ONCE_PER_EVENT' },
    });
    log(`  + ${eventName.padEnd(18)} marked as Key Event`);
    created++;
  }
  log(`  Summary: ${created} created, ${skipped} skipped.`);
}

async function run(token) {
  await provisionCustomDimensions(token);
  await markKeyEvents(token);
  log('\nDone.');
  log('Remaining manual work (no API): audiences (13), funnels (20), paths (4), cohort (1).');
  log('See docs/superpowers/plans/2026-05-15-phase3-phase4-analytics-runbook.html §4.3-4.6.');
}

// --- OAuth flow -----------------------------------------------------------

const creds = readOAuthCreds();
let actualRedirectUri;
let handled = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, actualRedirectUri || 'http://localhost');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  // Idempotency + favicon side-fetches
  if (!code && !error) { res.writeHead(204); res.end(); return; }
  if (handled) { res.writeHead(204); res.end(); return; }
  handled = true;

  if (error || !code) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Authorization denied${error ? ': ' + error : ''}.</h2><p>You can close this tab.</p>`);
    server.close(); process.exit(1);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2>Authorized. Provisioning GA4 dashboard...</h2><p>Check your terminal. Close this tab.</p>');

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
