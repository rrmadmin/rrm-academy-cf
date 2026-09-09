/**
 * THE ESTATE'S REPORT PACKAGE: one Analytics Engine row shape, written by
 * every worker, in the one layout the observatory already parses.
 *
 * On 2026-09-08 four workers carried near-identical hand-rolled helpers
 * (rrm-library-worker, rrm-mcp, rrm-marketing-intel, rrm-fingerprint-worker)
 * and twenty-two wrangler configs carried no Analytics Engine binding at all,
 * reporting by `console.error` into a log nobody reads. The observatory could
 * therefore not tell a worker with nothing to say from a worker that had died,
 * because both look identical from the outside: no rows.
 *
 * The row this package writes is the observatory's canonical shape
 * (`rrm-observatory/src/ae-query.js`):
 *
 *   blobs:   [worker, event, action, status, detail]
 *   doubles: [duration_ms, count, 0]
 *   indexes: [action]
 *
 * BLOB1 IS THE WORKER NAME AND NOTHING ELSE. The digest groups by it, so a row
 * whose blob1 is a subsystem name renders as a worker nobody deployed. That is
 * the whole reason `configure({ worker })` is mandatory and why `aeFor()`
 * exists (see below).
 *
 * FAILURE POSTURE: a reporter that throws is worse than no reporter, because
 * it turns a logged error into an outage. `event()` and `error()` return a
 * boolean and never throw; an absent binding is `false`, a binding that throws
 * is `false`. `timed()` is the one exception and only in one direction: it
 * rethrows the wrapped function's error AFTER recording it, because swallowing
 * the caller's error would be a behaviour change, not telemetry.
 *
 *   const r = configure({ worker: 'my-worker' });
 *   export default r.wrap({ fetch, scheduled });
 */

/**
 * Bind a reporter to one worker name. Each consumer calls this once, at module
 * scope, and passes the resulting reporter around.
 *
 * @param {object}  opts
 * @param {string}  opts.worker    - this worker's name, exactly as the fleet
 *   inventory spells it. It becomes blob1 on every row.
 * @param {string} [opts.binding]  - the Analytics Engine binding on `env`.
 *   `EVENTS` (dataset `worker-events`) for Workers; a Pages Functions consumer
 *   binds the same name to `worker_events`, the underscore dataset the
 *   observatory merges alongside it.
 * @param {number} [opts.detailMax] - blob5 cap. 200 estate-wide; 64 for
 *   rrm-fingerprint-worker, whose dashboards were built to that width.
 *
 * NO DEFAULT ARGUMENT HERE. `= {}` used to sit on the parameter and it was a
 * lie a TypeScript consumer could see: `worker` is required, so `configure()`
 * with no argument was never a legal call, it only deferred the failure from
 * the type checker to the TypeError below. fsp-dashboard type-checks its
 * vendored files and caught it.
 */
export function configure({ worker, binding = 'EVENTS', detailMax = 200 }) {
  if (!worker) throw new TypeError('configure({ worker }) is required');

  const clip = (s) => String(s ?? '').slice(0, detailMax);

  /**
   * One row. Returns true if it was written, false if it could not be.
   *
   * `doubles` overrides the canonical [duration_ms, count, 0] VERBATIM, for
   * the workers that carry extra metrics past the third slot. Analytics Engine
   * allows twenty doubles; the observatory reads only double1 as a duration
   * and ignores the rest, so a longer array is compatible with every query it
   * runs. rrm-library-worker charts checked/pass/fail/inconclusive counts in
   * slots three onward, and truncating them to the canonical three would
   * silently blank four of its dashboards. Prefer durationMs and count; reach
   * for this only when the extra slots already exist.
   *
   * The options parameter is typed INLINE rather than with a `@param opts.x`
   * list, because a destructured parameter takes its type from the annotation
   * on the parameter itself; a name-keyed list beside it is ignored, and the
   * checker goes on inferring the shape from the defaults alone. That is how
   * `doubles`, which has no default, read as a property that does not exist.
   *
   * @param {object} env
   * @param {string} ev
   * @param {string} action
   * @param {string} [status]
   * @param {string} [detail]
   * @param {{ durationMs?: number, count?: number, doubles?: number[] }} [options]
   */
  function event(env, ev, action, status = 'ok', detail = '', { durationMs = 0, count = 1, doubles } = {}) {
    const ae = env && env[binding];
    if (!ae || typeof ae.writeDataPoint !== 'function') return false;
    try {
      ae.writeDataPoint({
        blobs: [worker, String(ev), String(action), String(status), clip(detail)],
        doubles: Array.isArray(doubles) ? doubles : [Number(durationMs) || 0, Number(count) || 0, 0],
        indexes: [String(action)],
      });
      return true;
    } catch {
      // An AE write must never be why a request fails.
      return false;
    }
  }

  /** An error row. The message is the detail; a caller's own detail prefixes it. */
  function error(env, ev, action, err, detail = '') {
    const msg = err && err.message ? err.message : String(err);
    return event(env, ev, action, 'error', detail ? `${clip(detail)} ${msg}` : msg);
  }

  /**
   * Run `fn`, record how long it took, and rethrow anything it throws. Status
   * is `ok`, `slow` past `slowMs`, or `error`.
   */
  async function timed(env, ev, action, fn, { slowMs = 5000 } = {}) {
    const t0 = Date.now();
    try {
      const out = await fn();
      const d = Date.now() - t0;
      event(env, ev, action, d > slowMs ? 'slow' : 'ok', '', { durationMs: d });
      return out;
    } catch (e) {
      const d = Date.now() - t0;
      event(env, ev, action, 'error', e && e.message ? e.message : String(e), { durationMs: d });
      throw e;
    }
  }

  const rid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));

  /**
   * ONE LIVENESS ROW PER ISOLATE. `wrap()` writes it on the first invocation
   * of any wrapped handler, and never again in that isolate.
   *
   * Without it a wrapped worker in good health writes NOTHING, which is
   * precisely the state the observatory cannot read: a worker with nothing to
   * report and a worker that has died look identical from the outside, and the
   * whole point of binding these workers to Analytics Engine was to tell them
   * apart. An error-only wrapper would have shipped the binding and left that
   * question exactly as unanswerable as it was.
   *
   * Per ISOLATE, not per request: Cloudflare keeps an isolate warm across many
   * requests, so this is a trickle, not a per-request cost, and a worker
   * serving steady traffic still writes several rows a day. A worker with no
   * traffic at all for 72 hours writes none, and being named as silent is the
   * correct answer for it.
   */
  let announced = false;
  function announce(env, name) {
    if (announced) return;
    announced = true;
    event(env, 'handler', 'start', 'ok', name);
  }

  /**
   * Wrap a worker's exported handlers so an uncaught throw becomes one error
   * row instead of a silent 1101, and so a healthy worker is visible at all.
   *
   * `fetch` answers a 500 carrying `x-request-id` rather than rethrowing, so
   * the platform does not also report the same failure; every other handler
   * (`scheduled`, `queue`, `email`) rethrows after recording, because a cron
   * that swallows its own failure reports success to the scheduler.
   */
  function wrap(handlers) {
    const out = {};
    for (const [name, fn] of Object.entries(handlers)) {
      if (typeof fn !== 'function') continue;
      out[name] = async (a, env, ctx) => {
        announce(env, name);
        try {
          return await fn(a, env, ctx);
        } catch (e) {
          error(env, 'handler', name, e);
          if (name === 'fetch') {
            return new Response('Internal error', {
              status: 500,
              headers: { 'x-request-id': rid(), 'cache-control': 'no-store' },
            });
          }
          throw e;
        }
      };
    }
    return out;
  }

  /**
   * AN AE-SHAPED SHIM THAT RE-ATTRIBUTES ANOTHER PACKAGE'S ROW TO THIS WORKER.
   *
   * The mail package writes `blobs[0] = 'mail'`. On its own dataset that is
   * right; on `worker-events` it is wrong, because the observatory reads blob1
   * as the worker name and renders such a row as a worker called "mail" that
   * nobody deployed. rrm-observatory works around it by sending mail rows to a
   * separate `AE_EMAIL` binding and rrm-wix-stuc-sync by passing no `ae` at
   * all, which is why neither of them shows mail activity in the fleet view.
   *
   * A consumer that uses both packages passes this instead:
   *
   *   send(env, msg, { ...deps, ae: r.aeFor(env, 'mail') })
   *
   * The row lands on worker-events as
   * `[<this worker>, 'mail', <lane>, <status>, <purpose> <detail>]`:
   * attributed to the worker, with the foreign package's own first blob
   * replaced by the event name and its remaining columns shifted one place
   * right. Blob3 in the foreign row (the mail package's `purpose`) has nowhere
   * to go in a five-blob shape, so it is folded onto the front of the detail
   * rather than dropped: a refused send has to stay answerable from telemetry.
   * The index stays whatever the foreign package chose, because that is the
   * dimension it meant to slice on.
   *
   * @param {object} env
   * @param {string} eventName - the event blob2 carries. 'mail' for the mail
   *   package.
   */
  function aeFor(env, eventName) {
    return {
      writeDataPoint(row) {
        const ae = env && env[binding];
        if (!ae || typeof ae.writeDataPoint !== 'function') return;
        const blobs = Array.isArray(row && row.blobs) ? row.blobs : [];
        const doubles = Array.isArray(row && row.doubles) ? row.doubles : [0, 1, 0];
        const indexes = Array.isArray(row && row.indexes) ? row.indexes : [];
        const purpose = String(blobs[2] ?? '').trim();
        const detail = String(blobs[4] ?? '').trim();
        try {
          ae.writeDataPoint({
            blobs: [
              worker,
              String(eventName),
              String(blobs[1] ?? ''),
              String(blobs[3] ?? ''),
              clip(purpose && detail ? `${purpose} ${detail}` : purpose || detail),
            ],
            doubles: [Number(doubles[0]) || 0, Number(doubles[1]) || 0, 0],
            indexes: [String(indexes[0] ?? eventName)],
          });
        } catch {
          // Best-effort, exactly like event().
        }
      },
    };
  }

  return { event, error, timed, wrap, aeFor };
}
