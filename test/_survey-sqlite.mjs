/**
 * D1-shaped SURVEY_DB (rrm-survey) and SURVEY_SYMPTOMS_DB (rrm-survey-symptoms)
 * bindings backed by a REAL SQLite engine, built from the COMMITTED migration
 * files rather than a hand-written table definition.
 *
 * WHY THIS EXISTS
 * ---------------
 * rrm-auth has `schema.sql`, a generated mirror of live. rrm-survey has no
 * committed snapshot at all -- the only in-repo description of quiz_result and
 * quiz_event is the pair of migration files that created them. So the honest
 * source for a SURVEY_DB harness is those files, read verbatim:
 *
 *   scripts/migrations/2026-06-13-quiz-result.sql
 *   scripts/migrations/2026-07-02-quiz-events-and-rules-version.sql
 *
 * Reading them (instead of retyping the DDL) is the whole point. The INSERTs in
 * functions/api/quiz/request.js and functions/api/quiz/event.js name nine and
 * four columns respectively; under test/_helpers.js mockDB, which matches SQL by
 * substring and hands back a canned result, a column that does not exist is
 * indistinguishable from one that does. Against this harness the statement is
 * PREPARED by SQLite, so a drifted column list, a NOT NULL violation, or a
 * misordered bind is a test failure instead of a production 500.
 *
 * WHAT THIS FAKE CANNOT DISTINGUISH (read before trusting a green run)
 * -------------------------------------------------------------------
 *  1. Whether live rrm-survey matches these migration files. Nothing in this
 *    repo mirrors that database, and this harness cannot query it. A column
 *    added to live by hand, or a migration file that was never applied, leaves
 *    these tests green and possibly wrong. This is strictly weaker than the
 *    rrm-auth harness, which at least loads a generated mirror of live.
 *  2. `email_log` (see below) is MIRRORED FROM rrm-auth's schema.sql, not from
 *    any committed rrm-survey artifact. It exists here so the best-effort email
 *    audit write in quiz/request.js executes rather than silently throwing into
 *    insertEmailLog's catch. Its column list being right for rrm-auth does NOT
 *    prove it is right for rrm-survey.
 *  3. Everything test/_d1-sqlite.mjs already lists: D1-vs-SQLite engine
 *    differences, statement caps, concurrency, and non-database services.
 */
import { readFileSync } from 'node:fs';
import { sqliteD1 } from './_d1-sqlite.mjs';

/**
 * Migration files, in application order, that define rrm-survey's quiz surface.
 * Kept in lockstep with MIGRATIONS_NOT_REPLAYED in _d1-sqlite.mjs, whose
 * reasons for these two entries point back here.
 */
export const SURVEY_MIGRATIONS = [
  '2026-06-13-quiz-result.sql',
  '2026-07-02-quiz-events-and-rules-version.sql',
];

/**
 * Not from a committed rrm-survey artifact -- copied from schema.sql's rrm-auth
 * definition so the fire-and-forget audit write has somewhere to land. See
 * caveat 2 above.
 */
const EMAIL_LOG_MIRRORED_FROM_RRM_AUTH = `
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT,
  source TEXT,
  subject TEXT,
  detail TEXT,
  send_id TEXT,
  ses_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

/**
 * The identity half of the pseudonymization split. rrm-survey has no committed
 * migration file for this table: it was created by a wrangler command written
 * out in docs/plans/2026-03-09-survey-pseudonymization-plan.md (Step 3) and
 * repeated verbatim in the matching design doc, so that command is the closest
 * thing to a committed artifact and this is a transcription of it.
 *
 * Two columns here are load-bearing for the endpoints that write it:
 *   - airtable_record_id is UNIQUE, so a replayed rec_id is a constraint error
 *     rather than a duplicate identity row;
 *   - email is NOT NULL and NOT unique, because one person can retake a survey.
 * Under mockDB neither of those exists, so an INSERT that dropped a column or
 * reused a rec_id would look identical to a clean write.
 *
 * Caveat, same shape as EMAIL_LOG_MIRRORED_FROM_RRM_AUTH below: this is a doc
 * transcription, not a mirror of live rrm-survey. If someone ALTERed the live
 * table, these tests stay green over the old shape.
 */
const SURVEY_IDENTITIES_FROM_PSEUDONYMIZATION_PLAN = `
CREATE TABLE IF NOT EXISTS survey_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  airtable_record_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'endo-survey-v1',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_survey_identities_email ON survey_identities(email);
`;

export const SURVEY_SCHEMA_SQL =
  SURVEY_MIGRATIONS
    .map((name) => readFileSync(new URL(`../scripts/migrations/${name}`, import.meta.url), 'utf8'))
    .join('\n') + EMAIL_LOG_MIRRORED_FROM_RRM_AUTH + SURVEY_IDENTITIES_FROM_PSEUDONYMIZATION_PLAN;

/**
 * @param {object} [opts]
 * @param {(db: import('node:sqlite').DatabaseSync) => void} [opts.seed]
 * @returns D1-like binding suitable for env.SURVEY_DB
 */
export function surveyD1({ seed } = {}) {
  return sqliteD1({ seed, schemaSql: SURVEY_SCHEMA_SQL });
}

/**
 * The symptom half of the split: a SEPARATE database (binding
 * SURVEY_SYMPTOMS_DB, D1 rrm-survey-symptoms) that must never hold an address.
 * Unlike survey_identities this one HAS a committed migration, so its DDL is
 * read from the file rather than transcribed.
 *
 * Building it as its own engine is the point. A single shared fake cannot fail
 * when an email is written to the wrong store, because both tables would exist
 * in the same database; two engines make "the address is not in the symptom
 * store" a fact about the store rather than about the assertion.
 */
export const SYMPTOMS_MIGRATIONS = ['2026-06-26-survey-symptoms.sql'];

export const SYMPTOMS_SCHEMA_SQL = SYMPTOMS_MIGRATIONS
  .map((name) => readFileSync(new URL(`../scripts/migrations/${name}`, import.meta.url), 'utf8'))
  .join('\n');

/**
 * @param {object} [opts]
 * @param {(db: import('node:sqlite').DatabaseSync) => void} [opts.seed]
 * @returns D1-like binding suitable for env.SURVEY_SYMPTOMS_DB
 */
export function symptomsD1({ seed } = {}) {
  return sqliteD1({ seed, schemaSql: SYMPTOMS_SCHEMA_SQL });
}
