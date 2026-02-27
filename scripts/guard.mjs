#!/usr/bin/env node

// Build-time security guard for RRM Academy
// Zero npm dependencies — uses only Node.js stdlib
// Usage:
//   node scripts/guard.mjs          → verify (exit 1 on failure)
//   node scripts/guard.mjs --update → regenerate manifest hashes

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { exit, argv } from 'node:process';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const MANIFEST_PATH = join(ROOT, 'guard-manifest.json');
const UPDATE_MODE = argv.includes('--update');

// ANSI colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const PASS = `${GREEN}PASS${RESET}`;
const FAIL = `${RED}FAIL${RESET}`;
const WARN = `${YELLOW}WARN${RESET}`;

let failures = 0;
let warnings = 0;

function log(status, message) {
  console.log(`  ${status}  ${message}`);
}

function sha256(filePath) {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function collectFiles(dir, list = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, list);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      list.push(full);
    }
  }
  return list;
}

// ─── Phase 1: Hash Integrity ────────────────────────────────────────

function checkHashes() {
  console.log(`\n${BOLD}Phase 1: Hash integrity${RESET}`);

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    log(FAIL, `Cannot read ${MANIFEST_PATH}`);
    failures++;
    return;
  }

  if (UPDATE_MODE) {
    for (const [file, entry] of Object.entries(manifest.files)) {
      const fullPath = join(ROOT, file);
      try {
        entry.hash = sha256(fullPath);
        log(PASS, `Updated hash: ${file}`);
      } catch {
        log(FAIL, `File not found: ${file}`);
        failures++;
      }
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`\n  Manifest written to ${relative(ROOT, MANIFEST_PATH)}`);
    return;
  }

  for (const [file, entry] of Object.entries(manifest.files)) {
    const fullPath = join(ROOT, file);
    try {
      const actual = sha256(fullPath);
      if (actual === entry.hash) {
        log(PASS, `${file}`);
      } else {
        log(FAIL, `${file} — hash mismatch`);
        log('    ', `Expected: ${entry.hash}`);
        log('    ', `Actual:   ${actual}`);
        failures++;
      }
    } catch {
      log(FAIL, `${file} — file not found`);
      failures++;
    }
  }
}

// ─── Phase 2: Security Invariants ───────────────────────────────────

function checkInvariants() {
  console.log(`\n${BOLD}Phase 2: Security invariants${RESET}`);

  const REQUIRED_ORIGIN = 'https://rrmacademy.org';

  // 2a. CORS origin in _shared.js
  const sharedPath = join(ROOT, 'functions/api/auth/_shared.js');
  try {
    const shared = readFileSync(sharedPath, 'utf8');
    if (shared.includes(`'Access-Control-Allow-Origin': '${REQUIRED_ORIGIN}'`)) {
      log(PASS, `CORS origin in _shared.js is ${REQUIRED_ORIGIN}`);
    } else {
      log(FAIL, `CORS origin in _shared.js is NOT ${REQUIRED_ORIGIN}`);
      failures++;
    }
  } catch {
    log(FAIL, `Cannot read _shared.js`);
    failures++;
  }

  // 2b. Scan ALL files in functions/ for Access-Control-Allow-Origin
  const functionsDir = join(ROOT, 'functions');
  try {
    const allFiles = collectFiles(functionsDir);
    for (const filePath of allFiles) {
      const content = readFileSync(filePath, 'utf8');
      const rel = relative(ROOT, filePath);
      const originMatches = content.matchAll(/Access-Control-Allow-Origin['":\s]+['"]([^'"]+)['"]/g);
      for (const match of originMatches) {
        const origin = match[1];
        if (origin === REQUIRED_ORIGIN) {
          log(PASS, `CORS origin in ${rel}`);
        } else {
          log(FAIL, `CORS origin in ${rel} is '${origin}' — must be '${REQUIRED_ORIGIN}'`);
          failures++;
        }
      }
    }
  } catch (err) {
    log(FAIL, `Cannot scan functions/ for CORS: ${err.message}`);
    failures++;
  }

  // 2c. Stripe webhook signature verification
  const webhookPath = join(ROOT, 'functions/api/stripe-webhook.js');
  try {
    const webhook = readFileSync(webhookPath, 'utf8');
    const hasSignature = webhook.includes('stripe-signature');
    const hasConstruct = webhook.includes('constructEventAsync');
    if (hasSignature && hasConstruct) {
      log(PASS, `Webhook signature verification (stripe-signature + constructEventAsync)`);
    } else {
      if (!hasSignature) {
        log(FAIL, `stripe-webhook.js missing 'stripe-signature' header check`);
        failures++;
      }
      if (!hasConstruct) {
        log(FAIL, `stripe-webhook.js missing 'constructEventAsync' call`);
        failures++;
      }
    }
  } catch {
    log(FAIL, `Cannot read stripe-webhook.js`);
    failures++;
  }

  // 2d. Middleware protects /account and /community
  const middlewarePath = join(ROOT, 'functions/_middleware.js');
  try {
    const middleware = readFileSync(middlewarePath, 'utf8');
    const protectsAccount = middleware.includes('/account');
    const protectsCommunity = middleware.includes('/community');
    if (protectsAccount && protectsCommunity) {
      log(PASS, `Middleware protects /account and /community`);
    } else {
      if (!protectsAccount) {
        log(FAIL, `_middleware.js does not reference /account`);
        failures++;
      }
      if (!protectsCommunity) {
        log(FAIL, `_middleware.js does not reference /community`);
        failures++;
      }
    }
  } catch {
    log(FAIL, `Cannot read _middleware.js`);
    failures++;
  }

  // 2e. Rate limiting on login.js and signup.js
  for (const file of ['functions/api/auth/login.js', 'functions/api/auth/signup.js']) {
    const filePath = join(ROOT, file);
    try {
      const content = readFileSync(filePath, 'utf8');
      if (content.includes('checkRateLimit')) {
        log(PASS, `Rate limiting in ${file}`);
      } else {
        log(FAIL, `${file} missing checkRateLimit`);
        failures++;
      }
    } catch {
      log(FAIL, `Cannot read ${file}`);
      failures++;
    }
  }
}

// ─── Phase 3: Secret Scanning ───────────────────────────────────────

function scanSecrets() {
  console.log(`\n${BOLD}Phase 3: Secret scanning${RESET}`);

  const SECRET_PATTERNS = [
    { pattern: /sk_live_[a-zA-Z0-9]{20,}/g, label: 'Stripe live secret key' },
    { pattern: /sk_test_[a-zA-Z0-9]{20,}/g, label: 'Stripe test secret key' },
    { pattern: /whsec_[a-zA-Z0-9]{20,}/g, label: 'Stripe webhook secret' },
    { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, label: 'Private key' },
    { pattern: /Bearer\s+[a-zA-Z0-9._\-]{20,}/g, label: 'Hardcoded Bearer token' },
    { pattern: /pat[a-zA-Z0-9]{14}\.[a-f0-9]{64}/g, label: 'Airtable PAT' },
    { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key' },
  ];

  const SCAN_DIRS = [
    join(ROOT, 'functions'),
    join(ROOT, 'src'),
  ];

  let foundSecrets = 0;

  for (const dir of SCAN_DIRS) {
    let files;
    try {
      files = collectFilesAll(dir);
    } catch {
      continue;
    }

    for (const filePath of files) {
      const rel = relative(ROOT, filePath);
      let content;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }

      for (const { pattern, label } of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = content.match(pattern);
        if (matches) {
          for (const match of matches) {
            const redacted = match.slice(0, 10) + '...' + match.slice(-4);
            log(FAIL, `${label} in ${rel}: ${redacted}`);
            foundSecrets++;
            failures++;
          }
        }
      }
    }
  }

  if (foundSecrets === 0) {
    log(PASS, `No hardcoded secrets found`);
  }
}

function collectFilesAll(dir, list = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFilesAll(full, list);
    } else if (entry.isFile()) {
      const ext = entry.name.split('.').pop();
      if (['js', 'mjs', 'ts', 'astro', 'json', 'html', 'css', 'md'].includes(ext)) {
        list.push(full);
      }
    }
  }
  return list;
}

// ─── Main ───────────────────────────────────────────────────────────

console.log(`${BOLD}RRM Academy — Security Guard${RESET}`);
if (UPDATE_MODE) {
  console.log(`Mode: ${YELLOW}update manifest${RESET}`);
}

checkHashes();
checkInvariants();
scanSecrets();

console.log('');
if (failures > 0) {
  console.log(`${RED}${BOLD}BLOCKED${RESET} — ${failures} failure(s). Fix issues or run 'npm run guard:update' after intentional changes.`);
  exit(1);
} else {
  console.log(`${GREEN}${BOLD}ALL CLEAR${RESET} — security guard passed.`);
  exit(0);
}
