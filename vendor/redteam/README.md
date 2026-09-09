# redteam

The shared half of the estate's red-team harnesses. It lives here, it is
vendored into each consumer at `vendor/redteam/` by `console-kit sync`, and
its bytes are sha-locked in that consumer's `kit.lock.json`.

Files: `deps.mjs` (the dependency gate, whole), `report.mjs` (the aggregation
and reporting primitives).

Consumers: `fsp-admin`, `fsp-dashboard`, `rrm-backoffice`, `rrm-academy-cf`,
`fivestarpractices-site`.

## What is shared, and what is not

Six harnesses were built in the week of 2026-09-05, each copied from the last,
so the obvious assumption is that `run.mjs`, `deps.mjs` and
`fakes/identities.mjs` are one core wearing five names. Diffing the five
copies says otherwise, and the measurements are recorded here so the next
reader sees the evidence rather than the conclusion. Comparison is
whitespace-normalised and comment-stripped, against the newest copy
(rrm-backoffice, 2026-09-09).

**`deps.mjs` is shared, entirely.** Code-identical in all five repos. The only
difference was the idiom for locating the module's own directory:
rrm-backoffice used `import.meta.dirname`, the other four
`fileURLToPath(import.meta.url)`. Roughly 2,100 duplicated lines collapse to
one file.

**`run.mjs` is not shared, and cannot be.** Against the newest copy it shows
1,019 to 1,201 changed lines out of about a thousand. Each runner imports its
repo's own fakes (`jwks`, `upstream`, `neon`, `stripe`, `bodies`), carries its
own `SCENARIOS` table, and asserts its own repo's state. Function by function,
comparing whole bodies:

| function | repos | distinct implementations | verdict |
|---|---|---|---|
| `loadIdentityFile` | 3 | 1 | shared, here |
| `tally` | 5 | 2 (fsp-dashboard's differs in layout only) | shared, here |
| `subsetMatches` | 5 | 3, and rrm-backoffice's truncates | shared, here, truncating |
| `grid` | 5 | 3, differing only in when a `measured:` line prints | shared, here |
| `scrub` | 1 | 1 | shared, here, and the doctrine says every runner should have it |
| `identityCoverage` | 3 | 3 | per-repo: each words its skip reason for its own edge |
| `normalise` | 5 | 3 | per-repo: the response shape differs |
| `captureLogs` | 5 | 2 | per-repo |
| `parseArgs` | 5 | 5 | per-repo: different flags |
| `markdown`, `writeReport` | 5 | 5 each | per-repo: different report sections |

Two of those rows are a judgement rather than a measurement, and the reasoning
is worth keeping. `grid`'s three variants differ in one condition: this one
prints the `measured:` line when `row.check || row.scenario`, fsp-admin's and
its two twins when `row.scenario` (their rows carry no `check`, so the two are
the same function on their data), and fsp-dashboard's additionally suppresses
it on a SKIP. The first four therefore adopt this one with byte-identical
output; fsp-dashboard keeps its own, because suppressing a measurement on a
case that never ran is a real difference and switching it away would be a
silent change to a security harness's report. `tally` is the same story with
whitespace instead of behaviour, and fsp-dashboard likewise keeps its own until
somebody shows the output identical on that repo's cases.

`identityCoverage` reads like shared code and is not: each repo matches a
different sentence in the skip reason ("cannot mint an Access assertion" here,
"Access overwrites both identity headers at the edge" in fsp-admin) and words
its own count line ("for want of a cookie", "for want of a session"). One
implementation would have to agree with three edges about what a missing
credential is called, so each keeps its own. It stays exported from this
module for a repo whose wording already matches.

A NOTE ON HOW THIS WAS MEASURED, because the first pass got it wrong. A body
extractor that finds the opening brace with `indexOf('{')` after the function
name lands on the `= {}` of a destructured default parameter, not on the body,
so every function with an options bag compares as the empty string and reads as
identical everywhere. That is what made the first draft of this table claim
`grid` and `identityCoverage` were one implementation in all five. Walk the
parameter list to its closing paren first. fsp-admin's own suite is what caught
it, by failing on a sentence the shared copy does not say.

**`fakes/identities.mjs` is not shared either.** Four repos hold four different
auth models, with incompatible signatures: rrm-backoffice mints Access
assertions from its own signer, fsp-admin from `jwks.mjs`'s `assertionFor`,
fsp-dashboard from `test/helpers.js`'s `mintToken`, and rrm-academy-cf has no
Access at all, presenting seeded session cookies and Stripe HMAC signatures.
`fivestarpractices-site` has no such file. There is nothing here to merge; the
identity fake is the part of a harness that is most specific to the surface it
attacks, and forcing one shape on all four would weaken every one of them.

## The boundary this module holds

Nothing in `report.mjs` sends a request or decides an outcome. It reads
results a repo's own runner has already produced. That is deliberate: a shared
module able to change a verdict would be a single edit able to turn five
security harnesses green at once, and the vendoring means that edit would
arrive in all five by sync.

`deps.mjs` is different, and is shared whole precisely because its policy
SHOULD be one policy: BLOCK on a CISA KEV entry, on EPSS at or over the
threshold, or on a HIGH or CRITICAL whose fix is published for the installed
major; KNOWN for an unexpired dated acceptance; WARN for everything else,
printed and never hidden; and a failure of the run when a source cannot be
reached, because a gate that passes on an outage is not a gate.

## What each consumer keeps

`scripts/redteam/cases.mjs`, `targets.mjs`, `coverage.mjs`, `fakes/` and
`deps-accepted.json` are that repo's own and are never synced. So is
`scripts/redteam/run.mjs`, minus the primitives it now imports from
`../../vendor/redteam/report.mjs`.

`scripts/redteam/deps.mjs` becomes a CLI shim: it re-exports the package so
`test/deps.test.js` keeps importing the same names from the same path, and it
calls `main()` when it is the process entry point so `node
scripts/redteam/deps.mjs` and the `redteam:deps` npm script keep working
unchanged.

## Paths

`deps.mjs` finds the consumer's root by walking up from its own directory to
the nearest `package.json`, so the lockfile it reads, the
`scripts/redteam/deps-accepted.json` it honours and the
`docs/redteam/<date>-deps.md` it writes all belong to the repo rather than to
the vendor tree. A later change of vendor layout cannot silently point the
gate at an empty lockfile.

## Fixtures

The kit's own `test/redteam-package.test.js` runs against
`test/fixtures/redteam/`, which stays in the kit rather than in the package:
`results.mjs` holds two synthetic cases, one that passed and one carried as an
adjudicated KNOWN finding, and `deps-advisories.json` plus the two acceptance
files exercise BLOCK, KNOWN, WARN and an expired acceptance with no network.
Nothing there is vendored into a consumer, because a consumer proves its own
gate against its own fixtures.
