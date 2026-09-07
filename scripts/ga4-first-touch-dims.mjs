#!/usr/bin/env node
/**
 * One-time GA4 provisioning for workstream 1 of
 * docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md:
 * registers the seven first-touch event parameters that
 * functions/api/_ga4-source.js parseFirstTouch() emits as EVENT-scoped
 * custom dimensions on the RRM Academy property (526304690), so they are
 * reportable in GA4 (they already reach BigQuery and the D1 ledger without
 * registration).
 *
 * Idempotent: lists live customDimensions first and skips any parameterName
 * already registered (GA4 has a 50 event-scoped dimension cap).
 *
 * Auth, two paths:
 *   1. GA4_REFRESH_TOKEN (+ optional GA4_CLIENT_ID/GA4_CLIENT_SECRET, else
 *      the gmail-cli installed-app client) -- non-interactive.
 *   2. Otherwise the same localhost OAuth consent flow ga4-phase4-config.mjs
 *      uses; prints the consent URL (set GA4_OPEN_BROWSER=1 to `open` it).
 *      The refresh token from that consent is discarded (never printed).
 *
 * Usage: node scripts/ga4-first-touch-dims.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const PROPERTY = 'properties/526304690';
const QUOTA_PROJECT = process.env.GA4_QUOTA_PROJECT || 'rrm-academy';
const GMAIL_CLI_CLIENT_SECRET = `${process.env.HOME}/.config/gmail-cli/client_secret.json`;
const SCOPES = 'https://www.googleapis.com/auth/analytics.edit';

// displayName, parameterName, description -- all EVENT scope. Names match
// parseFirstTouch() in functions/api/_ga4-source.js exactly.
const CUSTOM_DIMENSIONS = [
  ['FT Source',   'ft_source',   'first-touch source (rrm_ft cookie, 90 days)'],
  ['FT Medium',   'ft_medium',   'first-touch medium'],
  ['FT Campaign', 'ft_campaign', 'first-touch utm_campaign'],
  ['FT Content',  'ft_content',  'first-touch utm_content'],
  ['FT Landing',  'ft_landing',  'first-touch landing path'],
  ['FT At',       'ft_at',       'first-touch timestamp (ISO)'],
  ['Click ID',    'click_id',    'first-touch gclid/gbraid/wbraid'],
];

const log = (msg) => process.stderr.write(msg + '\n');

function readOAuthCreds() {
  if (process.env.GA4_CLIENT_ID && process.env.GA4_CLIENT_SECRET) {
    return { client_id: process.env.GA4_CLIENT_ID, client_secret: process.env.GA4_CLIENT_SECRET };
  }
  return JSON.parse(fs.readFileSync(GMAIL_CLI_CLIENT_SECRET, 'utf-8')).installed;
}

async function tokenRequest(body) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await resp.json();
  if (!data.access_token) { log('Token request failed: ' + JSON.stringify({ error: data.error, error_description: data.error_description })); process.exit(1); }
  return data;
}

async function ga(token, path, opts = {}) {
  const resp = await fetch(`https://analyticsadmin.googleapis.com/v1beta/${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': QUOTA_PROJECT },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await resp.json();
  if (data.error) throw new Error(`${opts.method || 'GET'} ${path}: ${data.error.message}`);
  return data;
}

async function provision(token) {
  const existing = await ga(token, `${PROPERTY}/customDimensions?pageSize=200`);
  const byParam = new Map((existing.customDimensions || []).map((d) => [d.parameterName, d]));
  let created = 0, skipped = 0;
  for (const [displayName, parameterName, description] of CUSTOM_DIMENSIONS) {
    if (byParam.has(parameterName)) { log(`  ~ ${parameterName.padEnd(12)} already exists`); skipped++; continue; }
    await ga(token, `${PROPERTY}/customDimensions`, { method: 'POST', body: { parameterName, displayName, scope: 'EVENT', description } });
    log(`  + ${parameterName.padEnd(12)} created`);
    created++;
  }
  const after = await ga(token, `${PROPERTY}/customDimensions?pageSize=200`);
  const live = new Set((after.customDimensions || []).map((d) => d.parameterName));
  const missing = CUSTOM_DIMENSIONS.map(([, p]) => p).filter((p) => !live.has(p));
  log(`\ncreated=${created} skipped=${skipped} missing_after=${missing.length}${missing.length ? ' ' + missing.join(',') : ''}`);
  if (missing.length) process.exit(1);
}

const creds = readOAuthCreds();

if (process.env.GA4_REFRESH_TOKEN) {
  const t = await tokenRequest({ refresh_token: process.env.GA4_REFRESH_TOKEN, client_id: creds.client_id, client_secret: creds.client_secret, grant_type: 'refresh_token' });
  await provision(t.access_token);
  process.exit(0);
}

let redirectUri = '';
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('missing code'); return; }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Authorized. You can close this tab.');
  server.close();
  try {
    const t = await tokenRequest({ code, client_id: creds.client_id, client_secret: creds.client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    await provision(t.access_token);
    process.exit(0);
  } catch (e) {
    log('FAILED: ' + (e.stack || e.message || String(e)));
    process.exit(1);
  }
});

server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://localhost:${server.address().port}`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${creds.client_id}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
  log(`AUTH_URL=${authUrl}`);
  log('Consent as administrator@rrmacademy.org. Waiting for the callback...');
  if (process.env.GA4_OPEN_BROWSER === '1') execSync(`open "${authUrl}"`);
});
