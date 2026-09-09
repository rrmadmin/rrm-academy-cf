/**
 * THE ONE REPORTER FOR THIS REPO.
 *
 * Every Analytics Engine row written by rrm-academy-cf's Pages Functions goes
 * through this object, so `blobs[0]` is the worker name on every one of them.
 * That was not true before 2026-09-09: eight subsystems wrote their own first
 * blob (`mail`, `ai-bot`, `survey`, `track`, `idempotency`, `billing`, `auth`,
 * `email_validate`), and the observatory reads blob1 as the worker name, so
 * each of those rendered in the fleet view as a worker nobody deployed. The
 * subsystem name is not lost; it moved one place right, into blob2, the event.
 *
 * The binding is `EVENTS`, bound in wrangler.toml to the UNDERSCORE dataset
 * `worker_events`, which is where Cloudflare Pages Functions write and which
 * `rrm-observatory/src/ae-query.js` merges alongside the hyphen dataset the
 * Workers use.
 *
 * The package itself is vendored at `vendor/report/` and sha-locked in
 * kit.lock.json. Do not edit it here; edit it in console-kit and re-sync.
 */
import { configure } from '../vendor/report/index.js';

export const r = configure({ worker: 'rrm-academy' });

/**
 * blob4 IS A STATUS AND ONLY A STATUS.
 *
 * `rrm-observatory/src/daemons/wave2/workers-latency-error.js` counts an error
 * by reading blob4, and the `worker-error-reporting` daemon calls a worker's
 * shape foreign when blob4 is empty or carries something outside this
 * vocabulary. Both were reading rows where blob4 held an HTTP status, a two
 * letter country code, a Wix subscription id or a post id.
 *
 * The mapping is central rather than at 481 call sites for the same reason the
 * reporter is: a call site that invents a new status word cannot silently make
 * this repo unreadable, it just lands on `warn` and says what it meant in the
 * detail.
 */
const STATUS_VOCABULARY = new Set(['ok', 'error', 'slow', 'start', 'warn']);
const STATUS_ALIASES = {
  warning: 'warn',
  limited: 'warn',
  block: 'warn',
  blocked: 'warn',
  skipped: 'ok',
  info: 'ok',
  reprocess: 'ok',
  success: 'ok',
  fail: 'error',
  failed: 'error',
};

/**
 * Returns `{ status, note }`. `note` is empty when the caller's word was
 * already in the vocabulary, and otherwise carries the original word so the
 * detail can keep it. Nothing is dropped; it stops being a column and becomes
 * a prefix.
 */
export function normalizeStatus(raw) {
  const word = String(raw ?? '').trim().toLowerCase();
  if (!word) return { status: 'ok', note: '' };
  if (STATUS_VOCABULARY.has(word)) return { status: word, note: '' };
  const mapped = STATUS_ALIASES[word];
  if (mapped) return { status: mapped, note: word };
  return { status: 'warn', note: word };
}

/** An HTTP status code as one of the five words. */
export function statusFromHttp(code) {
  const n = Number(code) || 0;
  if (n >= 500) return 'error';
  if (n >= 400) return 'warn';
  return 'ok';
}
