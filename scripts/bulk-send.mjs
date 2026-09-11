#!/usr/bin/env node
/**
 * THE BULK SEND DRIVER. Dry-run by default.
 *
 *   node scripts/bulk-send.mjs --campaign sept-letter --subject s.txt --body b.html
 *   node scripts/bulk-send.mjs --campaign sept-letter --subject s.txt --body b.html --send
 *   node scripts/bulk-send.mjs --campaign sept-letter ... --send --first-send
 *   node scripts/bulk-send.mjs --campaign sept-letter ... --send --resume
 *
 * IT HOLDS NO SES CREDENTIAL, and a test asserts that by reading this file.
 * Only the Pages Function holds an SES key on this estate (spec section 5.4);
 * the CLI reads ADMIN_API_SECRET from 1Password and calls the endpoint.
 *
 * IT REFUSES A STALE CHECKOUT. A send driven from a clone that does not contain
 * origin/main can be running against copy, exclusions or policy that were
 * superseded, and unlike a bad deploy there is no rollback for mail that has
 * already left. An unreadable git state counts as BEHIND, never as clean.
 *
 * IT LOOPS. One invocation of the endpoint sends at most BULK_PAGE_SIZE (50)
 * recipients (functions/api/newsletter/send.js, runBulkSend), so a --send run
 * calls the endpoint again and again while there is more to do. The loop
 * breaks on `sent === 0`, never on `deferred` alone: `deferred` is a true
 * count of the eligible audience on an unfiltered run, but on a run carrying
 * `--segments` the endpoint's audience COUNT query does not know about the
 * segment filter (see the comment above BULK_AUDIENCE_COUNT_SQL), so on a
 * segmented run `deferred` is only an upper bound and can sit above zero
 * forever even once every matching recipient has been mailed. A page that
 * actually sent nothing is the one signal that is exact in both cases.
 * `done: true` is also a legitimate stop (the endpoint's own accounting says
 * the audience is exhausted), so the loop stops on whichever comes first.
 * `deferred` is reported as "up to N remaining" on a segmented run so an
 * operator watching the log does not read the upper bound as an exact count.
 *
 * IT NEVER LOOPS ON A DRY RUN. A dry run reports one page and stops: it does
 * not send, so there is nothing for repeated calls to advance past, and
 * calling again would just describe the same first page.
 *
 * EXIT CODES, so a wrapper can branch without parsing prose:
 *   0  success, or a dry run that produced a report
 *   2  bad arguments (a campaign key that is not a lowercase slug, a missing file)
 *   3  the checkout is behind origin/main
 *   4  the run is paused (breaker or log-write-failed); read the reason, then --resume
 *   5  the first-send gate: pass --first-send once
 *   6  the day's cap is exhausted
 *   7  any other refusal from the endpoint
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ENDPOINT = 'https://rrmacademy.org/api/newsletter/send';
const CAMPAIGN_KEY = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function parseArgs(argv) {
  const take = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? null : argv[i + 1] ?? null;
  };
  const segments = take('--segments');
  return {
    campaign: take('--campaign'),
    subjectFile: take('--subject'),
    bodyFile: take('--body'),
    segments: segments ? segments.split(',').map((s) => s.trim()).filter(Boolean) : null,
    send: argv.includes('--send'),
    firstSend: argv.includes('--first-send'),
    resume: argv.includes('--resume'),
    endpoint: take('--endpoint') || DEFAULT_ENDPOINT,
  };
}

/**
 * Is this checkout missing commits that are on origin/main?
 *
 * `run` is injected so this is testable without a git repository. A throw from
 * git resolves to BEHIND: an unreadable checkout is not a fresh one, and the
 * failure mode of guessing "clean" is a send against superseded policy.
 */
export function isBehindOrigin(cwd, run) {
  try {
    run('git', ['fetch', 'origin', 'main', '--quiet'], cwd);
    const out = String(run('git', ['rev-list', '--count', 'HEAD..origin/main'], cwd)).trim();
    const count = Number.parseInt(out, 10);
    if (!Number.isFinite(count)) {
      return { behind: true, count: 0, detail: `git answered "${out}", which is not a count` };
    }
    return {
      behind: count > 0,
      count,
      detail: count > 0 ? `this checkout is behind origin/main by ${count} commit(s)` : 'checkout contains origin/main',
    };
  } catch (err) {
    return { behind: true, count: 0, detail: `git could not answer: ${err?.message || err}` };
  }
}

/**
 * The report for one endpoint response (one dry run, or one page of a real
 * send). `a.segmented` (set by the caller, never by the endpoint) switches
 * the deferred line to "up to N remaining" because a segmented run's
 * `deferred` is an upper bound, not an exact count -- see the file header.
 */
export function renderReport(a) {
  const lines = [];
  lines.push(a.dryRun ? `DRY RUN -- nothing was sent` : `SENT`);
  lines.push(`campaign        ${a.campaign}`);
  if (a.feedbackId) lines.push(`Feedback-ID     ${a.feedbackId}`);
  lines.push(`domain age      day ${a.ageDays} -> cap ${a.cap}/day`);
  lines.push(`spent today     ${a.sentToday ?? 0}`);
  lines.push(`remaining today ${a.remainingToday}`);
  const deferredLine = a.segmented ? `up to ${a.deferred} remaining` : `${a.deferred}`;
  if (a.dryRun) {
    lines.push(`audience        ${a.audience} after exclusions`);
    lines.push(`would send      ${a.wouldSend}`);
    lines.push(a.segmented
      ? `deferred        ${deferredLine}`
      : `deferred        ${deferredLine} (left for the next day, engaged first)`);
  } else {
    lines.push(`sent            ${a.sent}`);
    lines.push(`deferred        ${deferredLine}`);
    lines.push(`done            ${a.done}`);
  }
  if (a.breaker) lines.push(`breaker         ${a.breaker}`);
  if (a.pausedNow) lines.push(`WOULD PAUSE     ${a.pausedNow}`);
  if (Array.isArray(a.head) && a.head.length) {
    lines.push(`cohort head     ${a.head.join(', ')}`);
  }
  return lines.join('\n');
}

const EXIT_FOR_ERROR = {
  bulk_paused: 4,
  bulk_first_send_required: 5,
  bulk_cap_exhausted: 6,
};

export async function main(argv, deps) {
  const {
    fetch: doFetch = globalThis.fetch,
    readFile = (p) => readFileSync(p, 'utf8'),
    secret = () => String(execFileSync('op', ['read', 'op://Automation/RRM Academy Admin API Secret/credential'], { encoding: 'utf8' })).trim(),
    git = (cmd, args, cwd) => execFileSync(cmd, args, { cwd: cwd || ROOT, encoding: 'utf8' }),
    log = console.log,
    error = console.error,
  } = deps || {};

  const args = parseArgs(argv);
  if (!args.campaign || !CAMPAIGN_KEY.test(args.campaign)) {
    error('--campaign must be a lowercase slug of 2 to 64 characters, e.g. sept-letter');
    return 2;
  }
  if (!args.subjectFile || !args.bodyFile) {
    error('--subject <file> and --body <file> are both required');
    return 2;
  }

  let subject;
  let body;
  try {
    subject = readFile(args.subjectFile).trim();
    body = readFile(args.bodyFile);
  } catch (err) {
    error(`could not read the copy: ${err?.message || err}`);
    return 2;
  }

  const freshness = isBehindOrigin(ROOT, git);
  if (freshness.behind) {
    error(`REFUSING: ${freshness.detail}`);
    error('Mail that has already left has no rollback. Pull, re-read the copy and the exclusions, then re-run.');
    return 3;
  }

  const segmented = !!(args.segments && args.segments.length);
  const bearer = secret();

  const call = async () => {
    const payload = { lane: 'bulk', campaign: args.campaign, subject, body };
    if (args.segments) payload.segments = args.segments;
    if (args.send) payload.send = true;
    if (args.firstSend) payload.firstSend = true;
    if (args.resume) payload.resume = true;

    const res = await doFetch(args.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const answer = await res.json();
    return { status: res.status, answer };
  };

  const reportAndExitOnRefusal = ({ status, answer }) => {
    if (answer.ok) return null;
    error(`REFUSED (${status}): ${answer.error}${answer.reason ? ` -- ${answer.reason}` : ''}`);
    if (answer.detail) error(answer.detail);
    if (answer.action) error(`NEXT: ${answer.action}`);
    return EXIT_FOR_ERROR[answer.error] ?? 7;
  };

  // A dry run reports exactly one page and never loops: it sends nothing, so
  // there is nothing for a second call to advance past. See the file header.
  if (!args.send) {
    const { status, answer } = await call();
    const refusedExit = reportAndExitOnRefusal({ status, answer });
    if (refusedExit !== null) return refusedExit;
    log(renderReport({ ...answer, segmented }));
    log('\nNothing was sent. Re-run with --send when the report reads right.');
    return 0;
  }

  // A real send loops: one invocation is at most one BULK_PAGE_SIZE page, so
  // the CLI keeps calling while the endpoint keeps sending. It stops on
  // `sent === 0` (the exact signal, even on a segmented run where `deferred`
  // is only an upper bound) or on `done: true`, whichever comes first.
  let totalSent = 0;
  for (;;) {
    const { status, answer } = await call();
    const refusedExit = reportAndExitOnRefusal({ status, answer });
    if (refusedExit !== null) return refusedExit;

    totalSent += answer.sent || 0;
    log(renderReport({ ...answer, segmented }));

    if (answer.sent === 0 || answer.done) break;
  }
  log(`\nTOTAL SENT THIS RUN: ${totalSent}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2), {}));
}
