/**
 * THE PARTS OF A RED-TEAM RUNNER THAT ARE THE SAME EVERYWHERE.
 *
 * Six harnesses were built across the estate in the week of 2026-09-05, each
 * by copying the last one. Diffing the five that survive shows exactly which
 * of their runner is shared and which only looks it: the aggregation and the
 * reporting are one implementation wearing five names, while the dispatch,
 * the fakes, the case table and the evaluation are genuinely per-repo. This
 * module is the first half. The second half stays in each repo, and the
 * README beside this file says why, with the measurements.
 *
 * NOTHING HERE SENDS A REQUEST OR DECIDES AN OUTCOME. A function in this
 * module reads results that a repo's own runner has already produced. That
 * boundary is deliberate: a shared module that could change a verdict would
 * be a single edit able to turn six security harnesses green at once.
 *
 * THIS IS THE VENDORED COPY, AND IT IS THE ONLY COPY. It is owned by
 * console-kit (`kit/packages/redteam/report.mjs`), synced into
 * `vendor/redteam/` and sha-locked in `kit.lock.json`. Edit it in a consumer
 * and `check:kit` calls the drift; fix it in the kit and sync.
 */

import { readFileSync } from 'node:fs';

/**
 * THE OUTCOMES, IN THE ORDER EVERY GRID PRINTS THEM.
 *
 * KNOWN is not a sixth kind of pass. It is a FAIL that has been adjudicated,
 * written down with an id, and left in the table with its expectation intact,
 * so it prints in every grid and appears in every report rather than going
 * quiet. A findings count that ignored KNOWN would report a harness carrying
 * open findings as clean.
 */
export const OUTCOMES = Object.freeze(['PASS', 'FAIL', 'SKIP', 'KNOWN']);

/** How many cases landed on each outcome. */
export function tally(results) {
  const counts = { PASS: 0, FAIL: 0, SKIP: 0, KNOWN: 0 };

  for (const result of results) counts[result.outcome] += 1;

  return counts;
}

/**
 * THE ONE-LINE ANSWER: `families=N cases=N findings=N`.
 *
 * Findings are FAIL plus KNOWN, for the reason above. A run with zero FAILs
 * and four KNOWNs has four findings standing against it and this line says
 * so, which is the whole difference between a register and a wish list.
 */
export function summary(results) {
  const families = new Set(results.map((r) => r.family)).size;
  const counts = tally(results);

  return `families=${families} cases=${results.length} findings=${counts.FAIL + counts.KNOWN}`;
}

/**
 * ONE FIELD AT A TIME, AND THE FIRST DISAGREEMENT NAMED.
 * -> null when every expected key matches, else the sentence saying which.
 *
 * The observed value is truncated at 120 characters: a case that expected a
 * short refusal body and got a rendered HTML page would otherwise print the
 * page into the terminal and into the committed report.
 */
export function subsetMatches(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(actual?.[key]) !== JSON.stringify(value)) {
      return `body.${key} is ${JSON.stringify(actual?.[key])?.slice(0, 120)}, expected ${JSON.stringify(value)}`;
    }
  }

  return null;
}

/**
 * THE GRID, BY FAMILY, PASSES FOLDED AWAY UNLESS ASKED FOR.
 *
 * `families` is the repo's own family name to description map, passed in
 * rather than imported, because the family list is the one part of this that
 * belongs to the case table.
 */
export function grid(results, { verbose = false, families = {} } = {}) {
  const lines = [];
  const byFamily = new Map();

  for (const result of results) {
    if (!byFamily.has(result.family)) byFamily.set(result.family, []);

    byFamily.get(result.family).push(result);
  }

  for (const [family, rows] of byFamily) {
    const counts = tally(rows);

    lines.push('');
    lines.push(`${family.toUpperCase()}  ${families[family] ?? ''}`);
    lines.push(`  ${rows.length} cases: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.KNOWN} KNOWN, ${counts.SKIP} SKIP`);

    for (const row of rows) {
      if (!verbose && row.outcome === 'PASS') continue;

      lines.push(`  ${row.outcome.padEnd(5)} ${row.id}`);

      if (row.check || row.scenario) lines.push(`        measured: ${row.detail}`);

      for (const reason of row.reasons ?? []) lines.push(`        ${reason}`);
    }
  }

  const total = tally(results);

  lines.push('');
  lines.push(`TOTAL ${results.length} cases: ${total.PASS} PASS, ${total.FAIL} FAIL, ${total.KNOWN} KNOWN, ${total.SKIP} SKIP`);

  return lines.join('\n');
}

/**
 * WHICH IDENTITIES REALLY RAN, AND WHICH WERE ONLY NAMED.
 *
 * A live run against an Access-fronted host cannot mint an assertion, so
 * every identity case there is a SKIP unless the operator supplied that
 * identity's `CF_Authorization` cookie. Without this line a live report shows
 * a long list of identity cases and no hint that none of them presented a
 * credential. It names identities and counts and never a cookie value.
 */
export function identityCoverage(results, options = {}) {
  const byIdentity = new Map();
  let ran = 0;
  let missing = 0;

  for (const result of results) {
    const key = result.as;
    const entry = byIdentity.get(key) ?? { ran: 0, skipped: 0 };
    const forWantOfACookie = result.outcome === 'SKIP' && (result.reasons?.[0] ?? '').includes('cannot mint an Access assertion');

    if (forWantOfACookie) {
      entry.skipped += 1;
      missing += 1;
    } else if (result.outcome !== 'SKIP') {
      entry.ran += 1;
      ran += 1;
    }

    byIdentity.set(key, entry);
  }

  const short = [...byIdentity].filter(([, counts]) => counts.skipped).map(([key, counts]) => `${key} ${counts.skipped}`);
  const supplied = Object.keys(options.cookies ?? {}).sort();

  return (
    `identity coverage: ${ran} case(s) ran, ${missing} skipped for want of a cookie`
    + `${short.length ? ` (${short.join(', ')})` : ''}`
    + `; cookies supplied for ${supplied.length ? supplied.join(', ') : 'no identities'}`
  );
}

/**
 * THE `--identity-file`: A JSON MAP OF IDENTITY TO CF_Authorization VALUE.
 *
 * One `--cookie-<identity>` flag is fine for one identity and unusable for
 * six. Either shape is accepted, `{ "cookies": { ... } }` or the flat map.
 *
 * THAT FILE IS A SET OF LIVE SESSIONS. It belongs outside the repo, and no
 * value in it may ever be printed: `scrub()` below exists to hold that line
 * for the report, and this function throws rather than carrying an empty or
 * non-string value that would later scrub to nothing.
 */
export function loadIdentityFile(path) {
  let parsed;

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`redteam: --identity-file ${path} could not be read as JSON: ${String(err?.message ?? err).slice(0, 120)}`);
  }

  const map = parsed && typeof parsed === 'object' && parsed.cookies && typeof parsed.cookies === 'object' ? parsed.cookies : parsed;

  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`redteam: --identity-file ${path} must hold an object of identity -> CF_Authorization value`);
  }

  const cookies = {};

  for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`redteam: --identity-file ${path} has no usable cookie for ${key}`);

    cookies[key] = value.trim();
  }

  return cookies;
}

/**
 * NOTHING THE RUNNER PRINTS OR WRITES MAY CARRY A CREDENTIAL.
 *
 * A live run once quoted a service-token client id into a committed report.
 * Every line that reaches a terminal or a file goes through here first, and
 * the substitution is by VALUE rather than by pattern, because a credential
 * has no shape a regular expression could recognise.
 */
export function scrub(text, options) {
  let out = String(text);

  const secrets = [
    [options?.serviceToken?.secret, '<service-token-secret>'],
    [options?.serviceToken?.id, '<service-token-client-id>'],
    ...Object.entries(options?.cookies ?? {}).map(([key, value]) => [value, `<cf-authorization:${key}>`]),
  ];

  for (const [value, label] of secrets) {
    if (value) out = out.split(value).join(label);
  }

  return out;
}
