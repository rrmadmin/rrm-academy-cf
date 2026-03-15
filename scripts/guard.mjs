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

  // 2f. google-callback.js security invariants
  const googleCallbackPath = join(ROOT, 'functions/api/auth/google-callback.js');
  try {
    const googleCallback = readFileSync(googleCallbackPath, 'utf8');
    const hasBlockedCheck = googleCallback.includes('user.blocked');
    const hasHashedPassword = googleCallback.includes("hashed_password = ''");
    const hasSafeRedirect = googleCallback.includes('isSafeRedirect');
    if (hasBlockedCheck && hasHashedPassword && hasSafeRedirect) {
      log(PASS, `google-callback.js: blocked check, hashed_password='', isSafeRedirect`);
    } else {
      if (!hasBlockedCheck) {
        log(FAIL, `google-callback.js missing user.blocked check`);
        failures++;
      }
      if (!hasHashedPassword) {
        log(FAIL, `google-callback.js missing hashed_password = '' (not NULL)`);
        failures++;
      }
      if (!hasSafeRedirect) {
        log(FAIL, `google-callback.js missing isSafeRedirect (open redirect prevention)`);
        failures++;
      }
    }
  } catch {
    log(FAIL, `Cannot read google-callback.js`);
    failures++;
  }

  // 2g. community/upload.js file-type validation
  const uploadPath = join(ROOT, 'functions/api/community/upload.js');
  try {
    const upload = readFileSync(uploadPath, 'utf8');
    const hasTypeCheck = /allowedTypes|image\/|content.type/i.test(upload);
    if (hasTypeCheck) {
      log(PASS, `community/upload.js has content-type allowlist check`);
    } else {
      log(FAIL, `community/upload.js missing content-type allowlist check`);
      failures++;
    }
  } catch {
    log(FAIL, `Cannot read community/upload.js`);
    failures++;
  }
}

// ─── Phase 3: Critical Files Must Exist ─────────────────────────────

function checkRequiredFiles() {
  console.log(`\n${BOLD}Phase 3: Required files${RESET}`);

  const REQUIRED = [
    { path: 'functions/api/survey/validate.js', note: 'Endo survey magic-link validation' },
    { path: 'functions/api/create-checkout.js', note: 'Stripe checkout (donations + memberships)' },
    { path: 'functions/api/stripe-webhook.js', note: 'Stripe webhook handler' },
    { path: 'functions/api/community/_shared.js', note: 'Community access control (requireMember)' },
    { path: 'functions/api/contact/submit.js', note: 'Contact form' },
    { path: 'src/data/quizzes.json', note: 'Course quiz content' },
    { path: 'src/data/courses.json', note: 'Course structure' },
  ];

  for (const { path, note } of REQUIRED) {
    const fullPath = join(ROOT, path);
    try {
      statSync(fullPath);
      log(PASS, `${path} exists (${note})`);
    } catch {
      log(FAIL, `${path} MISSING — ${note}`);
      failures++;
    }
  }

  // Directory file-count check — warns when new security-critical files appear without guard coverage
  const DIR_MINIMUMS = [
    { dir: 'functions/api/auth', min: 14, note: 'auth endpoints' },
    { dir: 'functions/api/billing', min: 6, note: 'billing endpoints' },
  ];

  for (const { dir, min, note } of DIR_MINIMUMS) {
    const dirPath = join(ROOT, dir);
    try {
      const jsFiles = readdirSync(dirPath).filter(f => f.endsWith('.js'));
      if (jsFiles.length > min) {
        log(WARN, `New file detected in ${dir} (${jsFiles.length} files, expected ${min}). Review and add to guard manifest if security-critical.`);
        warnings++;
      } else {
        log(PASS, `${dir}: ${jsFiles.length} ${note}`);
      }
    } catch {
      log(FAIL, `Cannot read directory ${dir}`);
      failures++;
    }
  }

  // Verify quizzes.json has actual content
  try {
    const quizzes = JSON.parse(readFileSync(join(ROOT, 'src/data/quizzes.json'), 'utf8'));
    const entries = Object.entries(quizzes);
    const emptyQuizzes = entries.filter(([, q]) => !q.questions || q.questions.length === 0);
    if (entries.length === 0) {
      log(FAIL, `quizzes.json has zero entries`);
      failures++;
    } else if (emptyQuizzes.length > 0) {
      log(FAIL, `quizzes.json has empty question arrays: ${emptyQuizzes.map(([k]) => k).join(', ')}`);
      failures++;
    } else {
      log(PASS, `quizzes.json: ${entries.length} quizzes, all have questions`);
    }
  } catch (err) {
    log(FAIL, `Cannot parse quizzes.json: ${err.message}`);
    failures++;
  }
}

// ─── Phase 4: Secret Scanning ───────────────────────────────────────

function scanSecrets() {
  console.log(`\n${BOLD}Phase 4: Secret scanning${RESET}`);

  const SECRET_PATTERNS = [
    { pattern: /sk_live_[a-zA-Z0-9]{20,}/g, label: 'Stripe live secret key' },
    { pattern: /sk_test_[a-zA-Z0-9]{20,}/g, label: 'Stripe test secret key' },
    { pattern: /whsec_[a-zA-Z0-9]{20,}/g, label: 'Stripe webhook secret' },
    { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, label: 'Private key' },
    { pattern: /Bearer\s+[a-zA-Z0-9._\-]{20,}/g, label: 'Hardcoded Bearer token' },
    { pattern: /pat[a-zA-Z0-9]{14}\.[a-f0-9]{64}/g, label: 'Airtable PAT' },
    { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS access key' },
    { pattern: /GOCSPX-[a-zA-Z0-9_-]{20,}/g, label: 'Google OAuth client secret' },
    { pattern: /op:\/\/[a-zA-Z]+\/[^\s'"]+/g, label: '1Password reference in committed code' },
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

// ─── Phase 5: CRM & Newsletter Safety ────────────────────────────────

function checkCrmSafety() {
  console.log(`\n${BOLD}Phase 5: CRM & newsletter safety${RESET}`);

  const functionsDir = join(ROOT, 'functions');
  let allFiles;
  try {
    allFiles = collectFiles(functionsDir);
  } catch {
    log(FAIL, 'Cannot scan functions/ directory');
    failures++;
    return;
  }

  // 5a. No mass delete/drop/truncate on CRM, newsletter, user, or enrollment tables
  const DANGEROUS_PATTERNS = [
    /DELETE\s+FROM\s+(?:contact|newsletter_subscriber|contact_tag|user|enrollment)\b/i,
    /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:contact|newsletter_subscriber|contact_tag|user|enrollment)\b/i,
    /TRUNCATE\s+(?:TABLE\s+)?(?:contact|newsletter_subscriber|contact_tag|user|enrollment)\b/i,
  ];

  let foundDangerous = false;
  for (const filePath of allFiles) {
    const rel = relative(ROOT, filePath);
    let content;
    try { content = readFileSync(filePath, 'utf8'); } catch { continue; }
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(content)) {
        log(FAIL, `Destructive CRM/newsletter SQL in ${rel}: ${pattern}`);
        failures++;
        foundDangerous = true;
      }
    }
  }
  if (!foundDangerous) {
    log(PASS, 'No destructive SQL (DELETE/DROP/TRUNCATE) on CRM, newsletter, user, or enrollment tables');
  }

  // 5b. Unsubscribe must use UPDATE (status change), never DELETE
  const unsubPath = join(ROOT, 'functions/api/newsletter/unsubscribe.js');
  try {
    const content = readFileSync(unsubPath, 'utf8');
    const hasStatusUpdate = /status\s*=\s*'unsubscribed'/i.test(content);
    const hasDelete = /DELETE\s+FROM\s+newsletter_subscriber/i.test(content);
    if (hasStatusUpdate && !hasDelete) {
      log(PASS, 'Unsubscribe uses status change, not DELETE');
    } else {
      if (!hasStatusUpdate) {
        log(FAIL, "unsubscribe.js missing status = 'unsubscribed' update");
        failures++;
      }
      if (hasDelete) {
        log(FAIL, 'unsubscribe.js contains DELETE FROM newsletter_subscriber');
        failures++;
      }
    }
  } catch {
    log(FAIL, 'Cannot read newsletter/unsubscribe.js');
    failures++;
  }

  // 5c. Newsletter send must require admin auth
  const sendPath = join(ROOT, 'functions/api/newsletter/send.js');
  try {
    const content = readFileSync(sendPath, 'utf8');
    if (content.includes('ADMIN_API_SECRET') && content.includes('Bearer')) {
      log(PASS, 'Newsletter send requires ADMIN_API_SECRET Bearer auth');
    } else {
      log(FAIL, 'Newsletter send.js missing ADMIN_API_SECRET or Bearer auth check');
      failures++;
    }
  } catch {
    log(FAIL, 'Cannot read newsletter/send.js');
    failures++;
  }

  // 5d. Newsletter subscribe must have rate limiting
  const subscribePath = join(ROOT, 'functions/api/newsletter/subscribe.js');
  try {
    const content = readFileSync(subscribePath, 'utf8');
    if (/[Rr]ate[Ll]imit/.test(content) || /429/.test(content)) {
      log(PASS, 'Newsletter subscribe has rate limiting');
    } else {
      log(FAIL, 'Newsletter subscribe.js missing rate limiting');
      failures++;
    }
  } catch {
    log(FAIL, 'Cannot read newsletter/subscribe.js');
    failures++;
  }
}

// ─── Main ───────────────────────────────────────────────────────────

console.log(`${BOLD}RRM Academy — Security Guard${RESET}`);
if (UPDATE_MODE) {
  console.log(`Mode: ${YELLOW}update manifest${RESET}`);
}

checkHashes();
checkInvariants();
checkRequiredFiles();
scanSecrets();
checkCrmSafety();

console.log('');
if (failures > 0) {
  console.log(`${RED}${BOLD}BLOCKED${RESET} — ${failures} failure(s)${warnings > 0 ? `, ${warnings} warning(s)` : ''}. Fix issues or run 'npm run guard:update' after intentional changes.`);
  exit(1);
} else if (warnings > 0) {
  console.log(`${GREEN}${BOLD}ALL CLEAR${RESET} — security guard passed with ${warnings} warning(s).`);
  exit(0);
} else {
  console.log(`${GREEN}${BOLD}ALL CLEAR${RESET} — security guard passed.`);
  exit(0);
}
