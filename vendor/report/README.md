# report

The estate's one Analytics Engine reporter. It lives here, it is vendored into
each consumer at `vendor/report/` by `console-kit sync`, and its bytes are
sha-locked in that consumer's `kit.lock.json`.

```js
import { configure } from '../vendor/report/index.js';
const r = configure({ worker: 'my-worker' });
export default r.wrap({ fetch, scheduled });
```

Files: `index.js` (the whole package, zero dependencies).

## The row shape is the contract

```
blobs:   [worker, event, action, status, detail]
doubles: [duration_ms, count, 0]
indexes: [action]
```

This is what `rrm-observatory/src/ae-query.js` parses, and every field of it is
load-bearing. `queryBothDatasets` merges `worker-events` (Workers) with
`worker_events` (Pages Functions), so a Pages consumer binds `EVENTS` to the
UNDERSCORE dataset and a Worker to the hyphen one; nothing else differs.
`wave2/workers-latency-error.js` reads the hyphen dataset alone precisely
because blob4 is a status there, so a row that puts something else in blob4
becomes a worker with an unreadable health signal rather than a parse error.

**blob1 is the worker name and nothing else.** The digest groups by it. A row
whose blob1 names a subsystem renders in the fleet view as a worker nobody
deployed, and there is no downstream fix for that, which is why
`configure({ worker })` throws rather than defaulting.

## Nothing here throws except `timed`, and only through

`event()` and `error()` return `true` when a row was written and `false` when
it could not be: no binding, a binding without `writeDataPoint`, or a
`writeDataPoint` that threw. All three are `false`, none is an exception. A
reporter that throws is strictly worse than no reporter, because it converts a
logged error into an outage, and it makes every test that touches a code path
with a log line in it need an Analytics Engine fake.

`timed()` is the one exception and only in one direction. It records `error`
with the elapsed time and then RETHROWS, because swallowing the caller's error
would be a behaviour change rather than telemetry.

`wrap()` splits on the handler name for the same reason: `fetch` answers a 500
carrying `x-request-id` instead of rethrowing, so the platform does not report
the same failure a second time, while `scheduled`, `queue` and `email` rethrow
after recording, because a cron that swallows its own failure reports success
to the scheduler.

## A healthy wrapped worker still writes, once per isolate

`wrap()` writes one row on the first invocation of any wrapped handler in an
isolate, and never again in that isolate:

```
[worker, 'handler', 'start', 'ok', '<handler name>']
```

An error-only wrapper would have been useless for the question the bindings
were added to answer. A worker with nothing to report and a worker that has
died both write zero rows, and no observatory query can separate them; the
liveness row is what makes "silent for 72 hours" mean something.

Per ISOLATE, not per request. A Worker keeps an isolate warm across many
requests, so a steady Worker writes a handful of rows a day. A busy Pages
project spins isolates far more aggressively: rrm-academy-cf measured about
24,000 `handler/start` rows a day on 2026-09-09. Both are far below one row per
request and well inside Analytics Engine limits, but do not budget Pages at
"several rows a day". A worker with no traffic at all for 72 hours writes none,
and being named as silent is the right answer for it.

## Status vocabulary

`STATUSES` is exported: `ok`, `error`, `slow`, `start`, `warn`. The daemon that
judges rows imports this list rather than keeping its own. `normalizeStatus()`
maps legacy words a caller may still pass (`fail`, `failure`, `warning`,
`success`, `skipped`, `completed`, `refused`, `timeout` and others) onto the
canonical value and prepends the original word to the detail, so nothing the
caller meant is lost and no row lands in the dataset with a foreign status.
An unknown word maps to `warn` with the word kept in the detail.

That fallback is why the alias table is short and stays short. A word that is
already warn-shaped (`conflict`, `rejected`, `inconclusive`, `rate_limited`)
needs no entry at all, because the fallback is the honest answer for it. An
alias is added only where the fallback would misreport health, which is at the
two ends of the scale: `pass`, `passed`, `idempotent`, `duplicate` and
`deduped` mean `ok`, and `critical`, `fatal` and `email_unsent` mean `error`.

1.3.2 adds the conditional sender's vocabulary for the same reason. A worker
that sends only when it has something to say reports `sent`, `quiet` or
`suppressed` on a healthy run and `send-failed` when the channel itself is
broken; the first three are `ok` and the last is `error`. The outcome stays in
the status for these rather than moving into the action, where an outcome
usually belongs, because `rrm-observatory`'s `email-series-absence` scopes each
series by the action and moving it would break that deadman rather than sharpen
it.
Adopt a word into the table when a real caller says it and warn is wrong; do
not translate it at the call site, which is how the estate ended up with nine
private vocabularies in the first place.

`event()`, `error()` and `timed()` do not announce. Only `wrap()` does, because
only `wrap()` knows it is standing at the entry point.

## Mail rows must be attributed to the worker, not to "mail"

`kit/packages/mail/index.js` writes its own AE row with `blobs[0] = 'mail'`.
On a dedicated mail dataset that is correct. On `worker-events` it is wrong:
the observatory reads blob1 as the worker name, so the row renders as a worker
called "mail" that nobody deployed and that no inventory can account for.

This is not hypothetical. The 2026-09-08 survey found rrm-observatory routing
its mail-package rows to a separate `AE_EMAIL` binding and rrm-wix-stuc-sync
passing no `ae` at all, both to dodge exactly this, and both losing their mail
telemetry from the fleet view as the price.

**A consumer that uses both packages routes the mail package's `deps.ae`
through this one:**

```js
import { send } from '../vendor/mail/index.js';
await send(env, msg, { signer, fetch, ae: r.aeFor(env, 'mail'), logEmail });
```

`aeFor(env, eventName)` returns an object with the one method the mail package
calls, and rewrites the row on the way through:

| mail package row | lands on worker-events as |
|---|---|
| `blobs[0] = 'mail'` | `blobs[0] = <this worker>` |
| `blobs[1] = lane` | `blobs[1] = 'mail'` (the event) |
| `blobs[2] = purpose` | `blobs[2] = lane` (the action) |
| `blobs[3] = status` | `blobs[3] = status` |
| `blobs[4] = detail` | `blobs[4] = '<purpose> <detail>'` |

`purpose` has nowhere of its own to go in a five-blob shape, so it is folded
onto the front of the detail rather than dropped: which purpose a refused send
carried is the fact a lane rule exists to make visible. The index is left
alone, because it is the dimension the mail package meant to slice on.

The same seam works for any package that writes its own rows. Pass the event
name you want blob2 to carry.

## The extra doubles

`event()` takes a `doubles` option that replaces the canonical
`[duration_ms, count, 0]` verbatim. Analytics Engine allows twenty doubles and
the observatory reads only double1 as a duration, ignoring the rest, so a
longer array answers every query it runs.

It exists because rrm-library-worker charts checked, pass, fail and
inconclusive counts in slots three onward on its cron summary rows. Capping
those to three would have blanked four dashboards and no test outside that repo
would have noticed. Prefer `durationMs` and `count`; reach for `doubles` only
where the extra slots already exist.

## Choosing `detailMax`

200 estate-wide, and it is the cap the observatory's own queries assume.
rrm-fingerprint-worker passes `detailMax: 64` because its dashboards were built
to that width and widening the column would silently change what they render.
Nothing else should differ without the same kind of reason.
