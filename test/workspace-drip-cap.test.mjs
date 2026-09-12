/**
 * EXECUTED tests for the Warm lane cap inside scripts/workspace-drip-send.sh.
 *
 * The drip IS the Warm lane. tools/mail-cap/send-cap.sh caps it when somebody
 * remembers to wrap the invocation, and nothing caps it when they do not -- so
 * the script carries the cap itself, and this is the test that has watched it
 * refuse. The count it gates is derived exactly as the script's own recipient
 * set is (header row dropped, first column, blanks dropped, de-duplicated), so
 * the number gated is the number that would be mailed.
 *
 * The script has no pre-existing dry-run switch, so DRIP_DRY_RUN=1 was added
 * with the cap: it exits 0 immediately after the cap check and before the first
 * D1 read, which is what lets these cases run with no network, no 1Password and
 * no Gmail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), 'scripts', 'workspace-drip-send.sh');

// The drip is a macOS operator script (#!/bin/zsh). The Linux CI runner ships
// no zsh, and a missing interpreter surfaces here as `status: null` (spawn
// ENOENT), which is not a cap verdict. Skip with a named reason there; the
// cap is exercised on every Mac run of `npm test` and in tools/mail-cap's
// own suite in rrm-tools.
function zshAvailable() {
  try {
    execFileSync('zsh', ['-c', 'exit 0'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const HAVE_ZSH = zshAvailable();
const SKIP_REASON = HAVE_ZSH ? false : 'zsh is not on PATH (Linux CI); the drip is a macOS operator script';

/** Runs the drip in dry-run mode over a roster of n unique recipients. */
function run(n, { max, extraRows = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'drip-cap-'));
  const roster = join(dir, 'roster.csv');
  const logDir = join(dir, 'mail-cap');
  mkdirSync(logDir, { recursive: true });
  const rows = ['email,name', ...Array.from({ length: n }, (_, i) => `d${i}@example.com,Person ${i}`), ...extraRows];
  writeFileSync(roster, rows.join('\n') + '\n');
  writeFileSync(join(dir, 'approved.txt'), 'plain body\n');
  writeFileSync(join(dir, 'approved.html'), '<p>body</p>\n');
  const env = {
    ...process.env,
    DRIP_DRY_RUN: '1',
    ROSTER: roster,
    TXT: join(dir, 'approved.txt'),
    HTML: join(dir, 'approved.html'),
    SENTLOG: join(dir, 'sent.log'),
    RUNLOG: join(dir, 'run.log'),
    LOCK: join(dir, 'lock.d'),
    MAIL_CAP_RUN_LOG_DIR: logDir,
  };
  if (max !== undefined) env.MAIL_CAP_MAX = String(max);
  else delete env.MAIL_CAP_MAX;
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('zsh', [SCRIPT], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    code = err.status;
    stdout = err.stdout || '';
    stderr = err.stderr || '';
  }
  const logPath = join(logDir, 'send-cap.log');
  return { code, stdout, stderr, log: existsSync(logPath) ? readFileSync(logPath, 'utf8') : '' };
}

test('a 300-recipient roster passes the cap', { skip: SKIP_REASON }, () => {
  const r = run(300);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /DRIP_DRY_RUN/);
  assert.match(r.log, /\tallowed\tcount=300\tmax=300\t/);
});

test('a 301-recipient roster is refused, and the drip never reaches a recipient', { skip: SKIP_REASON }, () => {
  const r = run(301);
  assert.equal(r.code, 2);
  assert.ok(!r.stdout.includes('DRIP_DRY_RUN'), 'nothing past the cap check ran');
  assert.ok(!/drip: \d+ to send/.test(r.stdout), 'the roster was never walked');
  assert.match(r.log, /\trefused\tcount=301\tmax=300\t/);
});

test('the refusal names the bulk rail and the command that belongs to a run this size', { skip: SKIP_REASON }, () => {
  const r = run(301);
  assert.match(r.stderr, /BULK RAIL/i);
  assert.match(r.stderr, /bulk-send\.mjs/);
  assert.match(r.stderr, /newsletter@rrmacademy\.com/);
});

test('the count is the drip own recipient set: header dropped, blanks dropped, de-duplicated', { skip: SKIP_REASON }, () => {
  // 300 unique names plus a duplicate and a blank line is still 300 recipients.
  const r = run(300, { extraRows: ['d0@example.com,Person 0 again', ''] });
  assert.equal(r.code, 0);
  assert.match(r.log, /count=300/);
});

test('case-variant duplicates are one recipient, the same way the drip sends them', { skip: SKIP_REASON }, () => {
  // The drip folds case before de-duplicating, so these two rows are ONE
  // message. A cap pipeline that skipped the fold would count 302 here and
  // refuse a roster the drip would have sent inside the cap.
  const r = run(300, { extraRows: ['D0@Example.com,Person 0 shouting', 'd0@EXAMPLE.COM,Person 0 again'] });
  assert.equal(r.code, 0);
  assert.match(r.log, /count=300/);
});

test('a malformed MAIL_CAP_MAX refuses, it does not fall through uncapped', { skip: SKIP_REASON }, () => {
  const r = run(10, { max: '3OO' });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /MAIL_CAP_MAX is not a number/);
  assert.ok(!r.stdout.includes('DRIP_DRY_RUN'), 'the run stopped at the malformed cap');
});

test('MAIL_CAP_MAX lowers the cap for a test run', { skip: SKIP_REASON }, () => {
  assert.equal(run(11, { max: 10 }).code, 2);
  assert.equal(run(10, { max: 10 }).code, 0);
});
