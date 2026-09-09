#!/usr/bin/env node
/**
 * THE DEPENDENCY GATE, AS THIS REPO INVOKES IT.
 *
 * The gate itself is estate-shared and lives in console-kit
 * (`kit/packages/redteam/deps.mjs`), vendored here at `vendor/redteam/` and
 * sha-locked in `kit.lock.json`. Five repos ran five byte-identical copies of
 * it until 2026-09-09; the policy it enforces is one policy, so it is one
 * file now, and a change to it arrives here by `console-kit sync` rather than
 * by somebody remembering to copy it.
 *
 * THIS FILE STAYS because two things point at this path and neither should
 * have to move: `test/deps.test.js` imports the policy functions from here,
 * and the step in tests.yml runs it as a program. So it re-exports the module
 * and calls `main()` when it is the process entry.
 *
 * WHAT IS STILL THIS REPO'S OWN: `deps-accepted.json` beside this file, which
 * is this site's adjudication ledger and is never shared. The vendored gate
 * reads it from `scripts/redteam/deps-accepted.json` by default.
 */

import { main } from '../../vendor/redteam/deps.mjs';

export * from '../../vendor/redteam/deps.mjs';

if (import.meta.filename === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(String(err?.message ?? err));
      process.exit(2);
    }
  );
}
