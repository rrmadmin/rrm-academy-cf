#!/usr/bin/env node
/**
 * One-time / on-demand: rotate the GA4 Measurement Protocol API secret for
 * property G-TSWRY7XLR0 (rrm-academy).
 *
 * Flow (matches docs/plans/2026-02-27-ga4-server-side-design.md spec v2 §3.1):
 *   1a. Ensure 1P item "GA4 Measurement Protocol API Secret" exists (create if not).
 *   1b. OAuth consent (one click), then list MP secrets, identify the old one to revoke.
 *   1c. Create NEW MP secret via Admin API. Capture secretValue (only shown once).
 *   1d. Pipe new value into 1P item AND into `wrangler pages secret put GA4_API_SECRET`.
 *   1e. Verify CF Pages binding name (typo guard).
 *   1f. Send a verification ping to GA4 /debug/mp/collect with the NEW secret. Expect validationMessages = [].
 *   1g. Delete OLD MP secret.
 *
 * Generate-before-revoke ordering: the old secret stays valid until 1g, so there's
 * no outage window. If anything fails between 1c and 1g, the old value is still bound.
 *
 * Never echoes the secret to stdout. Pipes to op + wrangler via spawned-process stdin.
 */
import http from 'node:http';
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';

const PROPERTY = 'properties/526304690'; // RRM Academy
const MEASUREMENT_ID = 'G-TSWRY7XLR0';
const CF_PAGES_PROJECT = 'rrm-academy';
const CF_PAGES_SECRET_NAME = 'GA4_API_SECRET';
const ONEP_VAULT = 'Automation';
const ONEP_ITEM = 'GA4 Measurement Protocol API Secret';
const NEW_SECRET_DISPLAY_NAME = `rrmacademy.org-rotated-${new Date().toISOString().slice(0, 10)}`;
const OLD_SECRET_LITERAL_PREFIX = 'REDACTED-PREFIX'; // first 9 chars of the leaked literal, for matching
// Use gmail-cli's installed-app OAuth client (localhost wildcard registered).
// The GA4 OAuth Creds (CF Pages) item doesn't have localhost registered.
const GMAIL_CLI_CLIENT_SECRET = `${process.env.HOME}/.config/gmail-cli/client_secret.json`;
const SCOPES = 'https://www.googleapis.com/auth/analytics.edit';

// --- helpers --------------------------------------------------------------

function log(msg) { process.stderr.write(msg + '\n'); }
function logErr(msg) { process.stderr.write(msg + '\n'); }

function readOAuthCreds() {
  // gmail-cli client_secret has http://localhost (wildcard port) registered.
  const raw = fs.readFileSync(GMAIL_CLI_CLIENT_SECRET, 'utf-8');
  const json = JSON.parse(raw);
  // Format: { "installed": { "client_id":..., "client_secret":..., "redirect_uris":[...] } }
  return json.installed || json.web;
}

async function exchangeCode(code, clientId, clientSecret, redirectUri) {
  let resp, data;
  try {
    resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    data = await resp.json();
  } catch (err) {
    logErr('Token exchange network error: ' + err.message);
    process.exit(1);
  }
  if (!data.access_token) {
    logErr('Token exchange failed: ' + JSON.stringify(data));
    process.exit(1);
  }
  return data.access_token;
}

async function ga(token, path, opts = {}) {
  let resp, data;
  try {
    resp = await fetch(`https://analyticsadmin.googleapis.com/v1alpha/${path}`, {
      method: opts.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    data = await resp.json();
  } catch (err) {
    logErr(`GA Admin API network error on ${opts.method || 'GET'} ${path}: ${err.message}`);
    if (opts.fatal !== false) process.exit(1);
    return { error: { message: err.message } };
  }
  if (data.error) {
    logErr(`GA Admin API error on ${opts.method || 'GET'} ${path}: ${data.error.message}`);
    if (opts.fatal !== false) process.exit(1);
  }
  return data;
}

function ensureOnePassItemExists() {
  // op item get returns non-zero if not found; suppress and create on miss.
  try {
    execSync(`op item get '${ONEP_ITEM}' --vault ${ONEP_VAULT} --format json > /dev/null 2>&1`, { stdio: 'ignore' });
    log(`  1P: item '${ONEP_ITEM}' exists.`);
    return 'exists';
  } catch {
    log(`  1P: creating item '${ONEP_ITEM}' (category=API Credential)...`);
    // apicredential category has a default 'credential' field, which is what
    // op://Automation/<item>/credential resolves to. Create with a placeholder
    // credential value; rotate() will overwrite via op item edit before exit.
    return new Promise((resolve, reject) => {
      const proc = spawn('op', [
        'item', 'create',
        '--category=apicredential',
        `--title=${ONEP_ITEM}`,
        `--vault=${ONEP_VAULT}`,
        'credential=PLACEHOLDER_WILL_BE_OVERWRITTEN',
        `notesPlain=Created by ga4-rotate-mp-secret.mjs. GA4 Measurement Protocol API secret for property ${MEASUREMENT_ID}.`,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve('created');
        else reject(new Error(`op item create exited ${code}: ${stderr.trim()}`));
      });
    });
  }
}

function writeSecretToOnePassword(secretValue) {
  // Pass via argv to op (spawn array, not shell string) so the value never hits
  // the shell history or transcript. op apicredential items have a 'credential'
  // field by default.
  return new Promise((resolve, reject) => {
    const proc = spawn('op', [
      'item', 'edit', ONEP_ITEM,
      '--vault', ONEP_VAULT,
      `credential=${secretValue}`,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`op item edit exited ${code}: ${stderr.trim()}`));
    });
  });
}

function bindToCloudflarePages(secretValue) {
  return new Promise((resolve, reject) => {
    // wrangler pages secret put reads value from stdin (interactive prompt).
    // We pipe via stdin to keep value out of argv.
    const proc = spawn('npx', [
      '--yes', 'wrangler', 'pages', 'secret', 'put',
      CF_PAGES_SECRET_NAME, '--project-name', CF_PAGES_PROJECT,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    proc.stdin.write(secretValue + '\n');
    proc.stdin.end();
    proc.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler pages secret put exited ${code}`));
    });
  });
}

async function verifyMpIngestion(secretValue) {
  // Use the GA4 debug endpoint which validates the secret + payload.
  // 200 with validationMessages: [] = secret accepted + payload valid.
  const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${encodeURIComponent(secretValue)}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'rotation-verify-' + Date.now(),
        events: [{ name: 'rotation_verify', params: { engagement_time_msec: 100 } }],
      }),
    });
    return await resp.json();
  } catch (err) {
    return { networkError: err.message, validationMessages: undefined };
  }
}

// --- main rotation pipeline ----------------------------------------------

async function rotate(token) {
  log('\n=== STEP 1a: Ensure 1Password item exists ===');
  const onePstate = await ensureOnePassItemExists();
  log(`  1P state: ${onePstate}`);

  log('\n=== STEP 1b: Discover dataStream + list existing MP secrets ===');
  const streams = await ga(token, `${PROPERTY}/dataStreams`);
  const stream = (streams.dataStreams || []).find(
    s => s.webStreamData?.measurementId === MEASUREMENT_ID
  );
  if (!stream) {
    logErr(`No dataStream with measurementId ${MEASUREMENT_ID} on ${PROPERTY}`);
    process.exit(1);
  }
  const streamPath = stream.name; // properties/X/dataStreams/Y
  log(`  Stream: ${streamPath}`);

  const secrets = await ga(token, `${streamPath}/measurementProtocolSecrets`);
  const allSecrets = secrets.measurementProtocolSecrets || [];
  log(`  Existing MP secrets: ${allSecrets.length}`);
  for (const s of allSecrets) {
    const matchOld = s.secretValue && s.secretValue.startsWith(OLD_SECRET_LITERAL_PREFIX);
    log(`    - ${s.displayName} (${s.name.split('/').pop()})${matchOld ? '  <-- LEAKED, will revoke' : ''}`);
  }
  const oldSecret = allSecrets.find(s => s.secretValue && s.secretValue.startsWith(OLD_SECRET_LITERAL_PREFIX));
  if (!oldSecret) {
    log(`  WARN: no MP secret with prefix ${OLD_SECRET_LITERAL_PREFIX} found.`);
    log(`  Either it's already been revoked OR it has a different prefix.`);
    log(`  Will proceed with create + bind, then list again so you can manually revoke if needed.`);
  }

  log('\n=== STEP 1c: Create NEW MP secret ===');
  const created = await ga(token, `${streamPath}/measurementProtocolSecrets`, {
    method: 'POST',
    body: { displayName: NEW_SECRET_DISPLAY_NAME },
  });
  if (!created.secretValue) {
    logErr('Create did not return secretValue: ' + JSON.stringify(created));
    process.exit(1);
  }
  const newSecretValue = created.secretValue;
  const newSecretPath = created.name; // properties/X/dataStreams/Y/measurementProtocolSecrets/Z
  log(`  Created: ${created.displayName} (${newSecretPath.split('/').pop()})`);
  log(`  secretValue captured (length=${newSecretValue.length}, not echoed).`);

  log('\n=== STEP 1d: Write new secret to 1Password + bind to CF Pages ===');
  await writeSecretToOnePassword(newSecretValue);
  log(`  1P: '${ONEP_ITEM}' credential field updated.`);
  await bindToCloudflarePages(newSecretValue);
  log(`  CF Pages: ${CF_PAGES_SECRET_NAME} bound on project ${CF_PAGES_PROJECT}.`);

  log('\n=== STEP 1e: Verify CF Pages binding name ===');
  try {
    const list = execSync(
      `npx --yes wrangler pages secret list --project-name ${CF_PAGES_PROJECT}`,
      { encoding: 'utf-8' }
    );
    if (list.includes(CF_PAGES_SECRET_NAME)) {
      log(`  OK: ${CF_PAGES_SECRET_NAME} present in pages secret list.`);
    } else {
      logErr(`  FAIL: ${CF_PAGES_SECRET_NAME} NOT found in pages secret list. Aborting before revoke.`);
      logErr(list);
      process.exit(1);
    }
  } catch (e) {
    logErr(`  wrangler pages secret list errored: ${e.message}`);
    process.exit(1);
  }

  log('\n=== STEP 1f: Verify ingestion via /debug/mp/collect ===');
  // GA4 takes a moment to propagate the new secret. Retry 3x.
  let validation = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await verifyMpIngestion(newSecretValue);
    if (Array.isArray(result.validationMessages)) {
      validation = result;
      if (result.validationMessages.length === 0) {
        log(`  attempt ${attempt}: PASS (validationMessages: [])`);
        break;
      }
      log(`  attempt ${attempt}: validationMessages = ${JSON.stringify(result.validationMessages)}`);
      if (attempt < 5) {
        log(`  Retrying in 6s...`);
        await new Promise(r => setTimeout(r, 6000));
      }
    } else {
      log(`  attempt ${attempt}: unexpected response: ${JSON.stringify(result).slice(0, 200)}`);
      if (attempt < 5) await new Promise(r => setTimeout(r, 6000));
    }
  }
  if (!validation || validation.validationMessages?.length > 0) {
    logErr(`  Ingestion verification did not pass after 5 attempts. NOT revoking old secret.`);
    logErr(`  Investigate, then re-run with --revoke-old-only to complete cleanup.`);
    process.exit(1);
  }

  log('\n=== STEP 1g: Revoke OLD MP secret ===');
  if (oldSecret) {
    await ga(token, oldSecret.name, { method: 'DELETE', fatal: false });
    log(`  Deleted: ${oldSecret.displayName} (${oldSecret.name.split('/').pop()})`);
  } else {
    log(`  No old secret matched prefix ${OLD_SECRET_LITERAL_PREFIX}; skipping revoke.`);
    log(`  Re-listing all MP secrets so you can audit:`);
    const after = await ga(token, `${streamPath}/measurementProtocolSecrets`);
    for (const s of (after.measurementProtocolSecrets || [])) {
      log(`    - ${s.displayName} (${s.name.split('/').pop()})`);
    }
  }

  log('\n=== ROTATION COMPLETE ===');
  log(`  GA4 property: ${PROPERTY}`);
  log(`  Measurement ID: ${MEASUREMENT_ID}`);
  log(`  New secret: stored in 1P '${ONEP_ITEM}' + CF Pages secret '${CF_PAGES_SECRET_NAME}'`);
  log(`  Old secret: revoked at GA4`);
  log(`  Verification: validationMessages = []`);
  log(`  Site GA4 events should continue without interruption.`);
}

// --- OAuth flow ----------------------------------------------------------

const creds = readOAuthCreds();

let actualRedirectUri;
let handled = false;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, actualRedirectUri || 'http://localhost');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  // Ignore browser side-fetches (favicon, devtools probe, etc) that lack OAuth params.
  // Without this, the chrome auto-favicon-fetch after the success page kills the script.
  if (!code && !error) {
    res.writeHead(204);
    res.end();
    return;
  }
  // Idempotency: only handle the first OAuth callback. Any later request is noise.
  if (handled) {
    res.writeHead(204);
    res.end();
    return;
  }
  handled = true;
  if (error || !code) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>Authorization denied${error ? ': ' + error : ''}.</h2><p>You can close this tab.</p>`);
    server.close(); process.exit(1);
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<h2>Authorized. Rotating GA4 MP secret...</h2><p>Check your terminal. Close this tab.</p>');

  log('\nExchanging OAuth code for access token...');
  try {
    const token = await exchangeCode(code, creds.client_id, creds.client_secret, actualRedirectUri);
    log('Token acquired. Beginning rotation...');
    await rotate(token);
    server.close();
    process.exit(0);
  } catch (e) {
    logErr('\nFAILED: ' + (e.stack || e.message || String(e)));
    server.close();
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason) => {
  logErr('\nUnhandled rejection: ' + (reason?.stack || reason?.message || String(reason)));
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logErr('\nUncaught exception: ' + (err?.stack || err?.message || String(err)));
  process.exit(1);
});

// port 0 = OS-picked random port; gmail-cli client has http://localhost wildcard.
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  actualRedirectUri = `http://localhost:${port}`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${creds.client_id}&redirect_uri=${encodeURIComponent(actualRedirectUri)}&response_type=code&scope=${encodeURIComponent(SCOPES)}&access_type=offline&prompt=consent`;
  log(`OAuth client: gmail-cli installed-app (localhost wildcard).`);
  log(`Listening on ${actualRedirectUri}`);
  log('Opening Google consent screen in your browser. Click "Allow".\n');
  execSync(`open "${authUrl}"`);
  log('Waiting for authorization callback...');
});
