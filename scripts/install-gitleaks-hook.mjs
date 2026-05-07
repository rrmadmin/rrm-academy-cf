#!/usr/bin/env node
// Installs gitleaks pre-commit guard WITHOUT clobbering the existing hook.
// Per /arise --deep finding #2: spec §3.5 7c's `cat > .git/hooks/pre-commit <<EOF`
// truncates and silently disables guard.mjs, payment-pipeline gates, fact-pipeline
// gates, iOS auto-zoom guard, arise-scan, etc. This installer composes instead.
//
// Run: `node scripts/install-gitleaks-hook.mjs`
// Re-running is idempotent (skips if gitleaks is already in the hook).

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const hookPath = resolve(repoRoot, '.git/hooks/pre-commit');

const GITLEAKS_LINE = 'gitleaks protect --staged --redact --no-banner || exit 1';
const HEADER_BLOCK = `
# Gitleaks pre-commit guard (added by scripts/install-gitleaks-hook.mjs).
# Catches accidental secret commits BEFORE they leave the workstation.
# CI workflow (.github/workflows/security.yml) is the authoritative gate;
# this is the fast-feedback local mirror.
${GITLEAKS_LINE}
`;

function ensureGitleaksBinary() {
  try {
    execSync('which gitleaks', { stdio: 'ignore' });
    return true;
  } catch {
    console.error('FAIL: gitleaks not in PATH. Install with: brew install gitleaks');
    return false;
  }
}

function installFresh() {
  const body = `#!/bin/sh
# Pre-commit hook for rrm-academy-cf.
# Installed by scripts/install-gitleaks-hook.mjs.
${GITLEAKS_LINE}
`;
  writeFileSync(hookPath, body, 'utf8');
  chmodSync(hookPath, 0o755);
  console.log(`CREATED ${hookPath}`);
}

function appendIfMissing() {
  const current = readFileSync(hookPath, 'utf8');
  if (current.includes('gitleaks protect --staged')) {
    console.log(`SKIP ${hookPath} already calls gitleaks`);
    return;
  }
  writeFileSync(hookPath, current.trimEnd() + '\n' + HEADER_BLOCK + '\n', 'utf8');
  chmodSync(hookPath, 0o755);
  console.log(`APPENDED gitleaks check to existing ${hookPath}`);
}

if (!ensureGitleaksBinary()) process.exit(1);

if (!existsSync(hookPath)) {
  installFresh();
} else {
  appendIfMissing();
}

console.log('Done. Test with: .git/hooks/pre-commit </dev/null && echo HOOK_OK');
