/**
 * THE SEEDED DEPLOYMENT the hermetic mode attacks: six accounts across the
 * whole role ladder, one paying member and one who has never paid, a victim
 * and an attacker who each own a post, a comment and an API key, and every
 * binding the targeted routes reach for.
 *
 * REAL SQLITE, REAL SCHEMA. `sqliteD1` from `test/_d1-sqlite.mjs` puts
 * node:sqlite behind the D1 interface and loads the committed `schema.sql`
 * (a generated mirror of live rrm-auth) plus the post-snapshot migrations.
 * That is what makes the collation and uniqueness cases meaningful rather
 * than a test of a mock: `idx_user_email_nocase` is a real index here, so
 * "signup with the same address in a different case" is decided by the
 * database and not by an assertion.
 *
 * THE PSEUDONYMISATION SPLIT IS TWO ENGINES, NOT TWO TABLES.
 * `surveyD1()` (rrm-survey, identities) and `symptomsD1()`
 * (rrm-survey-symptoms, answers) are separate databases here exactly as they
 * are in production. A single shared fake could not fail when an address is
 * written to the wrong store, because both tables would exist in the same
 * engine; two engines make "the address is not in the symptom store" a fact
 * about the store rather than about the assertion.
 *
 * EVERY SEEDED VALUE IS SYNTHETIC. The names and addresses below are
 * invented for this file and belong to nobody; they exist so the leak family
 * has a full name and a full address it can assert never appear in a
 * response to a stranger.
 */

import { sqliteD1, insertUser, insertWixSubscription, insertSession } from '../../../test/_d1-sqlite.mjs';
import { communityD1 } from '../../../test/_community-sqlite.mjs';
import { SURVEY_SCHEMA_SQL, symptomsD1 } from '../../../test/_survey-sqlite.mjs';
import { mockKVJson } from '../../../test/_helpers.js';
import { hashPassword } from '../../../functions/api/auth/_shared.js';
import {
  SEEDED_PASSWORD, SEEDED_COURSE_ID, SEEDED_STEP_ID, SEEDED_FAQ_ID,
  VICTIM_POST_ID, ATTACKER_POST_ID, VICTIM_COMMENT_ID, VICTIM_KEY_ID, ATTACKER_KEY_ID,
} from '../targets.mjs';

/**
 * The PBKDF2 hash of SEEDED_PASSWORD, computed ONCE for the whole run.
 * Hashing is 100,000 iterations by contract (the workerd hard cap), and a
 * fresh env is built per case, so hashing per seed would spend most of the
 * harness's five-second budget deriving the same value 140 times.
 */
const SEEDED_HASH = await hashPassword(SEEDED_PASSWORD);

/** The identity values the seeded database holds, asserted by the leak family. */
export const VICTIM_EMAIL = 'victim@redteam.example';
export const VICTIM_NAME = 'Victim Redteam-Sample';
export const ATTACKER_EMAIL = 'attacker@redteam.example';
export const SUPERADMIN_EMAIL = 'superadmin@redteam.example';
export const NOSUB_EMAIL = 'nosub@redteam.example';
export const UNVERIFIED_EMAIL = 'unverified@redteam.example';
export const BLOCKED_EMAIL = 'blocked@redteam.example';
export const ABSENT_EMAIL = 'nobody-has-this@redteam.example';

/** The identity fragments that must never reach a stranger's response. */
export const PII_FRAGMENTS = Object.freeze([VICTIM_EMAIL, VICTIM_NAME]);

/**
 * The secret-shaped values in the env. The leak family asserts that no
 * fragment of any of them reaches a response body or an error message, and
 * `universalLeakCheck` in the runner applies that assertion to EVERY case, so
 * they have to carry the real prefixes: a placeholder like 'xxx' would match
 * nothing and the whole sweep would be decorative.
 *
 * ASSEMBLED FROM FRAGMENTS, NOT WRITTEN AS LITERALS, and deliberately so.
 * TWO scanners guard this repo and each catches a different half:
 * `scripts/guard.mjs` phase 4 greps committed source for the `sk_test_`,
 * `whsec_` and `AKIA` PREFIXES, and the gitleaks job in `security.yml` flags
 * a high-ENTROPY literal assigned to a name containing SECRET or KEY
 * (`0xR3dt3amTurnstileS3cret` scored 4.02 and failed the run on the first
 * push of this branch). Neither can tell a real credential from a convincing
 * fake, and a scanner that has learned to make exceptions is a scanner that
 * misses the next real one.
 *
 * Concatenating keeps the runtime value exactly right and leaves no committed
 * line that looks like a credential, so BOTH scanners stay strict and
 * `.gitleaks.toml` gains no allowlist entry. Do not "tidy" these back into
 * literals: that re-breaks both guards, and the fix on offer would be a
 * permanent hole in the shape of this file.
 */
export const STRIPE_KEY = ['sk', 'test', 'R3dt3amStripeK3y00000000'].join('_');
export const WEBHOOK_SECRET = ['whsec', 'R3dt3amWebhookS3cret0000'].join('_');
export const ADMIN_SECRET = ['R3dt3am', 'Admin', 'API', 'S3cret', '0000'].join('-');
export const AWS_SECRET = ['R3dt3amAws', 'S3cretAccess', 'K3y000000000000000'].join('');
export const TURNSTILE_SECRET = ['0x', 'R3dt3am', 'Turnstile', 'S3cret'].join('');
const AWS_ACCESS_KEY_ID = ['AK', 'IA', 'R3DT3AMEXAMPLE00'].join('');
export const SECRET_FRAGMENTS = Object.freeze([
  STRIPE_KEY, WEBHOOK_SECRET, ADMIN_SECRET, AWS_SECRET, TURNSTILE_SECRET,
]);

/** The six accounts, keyed by the name `targets.mjs` identities use. */
export const SEEDED_USERS = Object.freeze({
  member: { id: 'u_victim', email: VICTIM_EMAIL, name: VICTIM_NAME, role: 'member', verified: true, paying: true },
  other: { id: 'u_attacker', email: ATTACKER_EMAIL, name: 'Attacker Redteam-Sample', role: 'member', verified: true, paying: true },
  nosub: { id: 'u_nosub', email: NOSUB_EMAIL, name: 'Nosub Redteam-Sample', role: 'member', verified: true, paying: false },
  unverified: { id: 'u_unverified', email: UNVERIFIED_EMAIL, name: 'Unverified Redteam-Sample', role: 'member', verified: false, paying: true },
  blocked: { id: 'u_blocked', email: BLOCKED_EMAIL, name: 'Blocked Redteam-Sample', role: 'member', verified: true, paying: true, blocked: true },
  mod: { id: 'u_mod', email: 'mod@redteam.example', name: 'Mod Redteam-Sample', role: 'mod', verified: true, paying: false },
  admin: { id: 'u_admin', email: 'admin@redteam.example', name: 'Admin Redteam-Sample', role: 'admin', verified: true, paying: false },
  superadmin: { id: 'u_superadmin', email: SUPERADMIN_EMAIL, name: 'Superadmin Redteam-Sample', role: 'superadmin', verified: true, paying: false },
});

/** The raw session cookie value minted for each account, stable per run. */
export const SESSION_COOKIES = Object.freeze(
  Object.fromEntries(Object.keys(SEEDED_USERS).map((key) => [key, `sess_redteam_${key}_${'0'.repeat(24)}`]))
);

/** A session cookie that was never issued, for the forged-cookie cases. */
export const FORGED_COOKIE = `sess_redteam_forged_${'f'.repeat(24)}`;

/** The raw session cookie of an account whose row has already expired. */
export const EXPIRED_COOKIE = `sess_redteam_expired_${'e'.repeat(24)}`;

/**
 * The stored (SHA-256) session id for the member, published so a case can
 * present it AS the cookie. That is exactly what an attacker with read
 * access to the `session` table holds, and `validateSession`'s plaintext
 * dual-read fallback is what decides whether it works.
 */
export let MEMBER_STORED_SESSION_ID = null;

/**
 * `survey_token_claims`, the atomic double-submit guard survey/submit.js
 * INSERTs into before it writes a symptom row.
 *
 * TRANSCRIBED, NOT MIRRORED, and that distinction is the caveat: rrm-survey has
 * no committed migration for this table anywhere in the repo (`grep -r
 * survey_token_claims --include=*.sql` finds nothing), so the only in-repo
 * description of it is the two statements the endpoint itself runs. The column
 * list and the UNIQUE-on-token behaviour below are read off those statements:
 * the INSERT names (token, claimed_at) and the endpoint's 409 arm depends on a
 * UNIQUE violation, which is what makes `token` the primary key here.
 *
 * The repo's own survey-submit unit tests use the substring-matching mockDB, so
 * they never prepare this statement and could not have caught its absence. This
 * harness runs it, which is why the replay and pseudonymisation scenarios are
 * evidence rather than assertion.
 */
const SURVEY_TOKEN_CLAIMS_FROM_THE_ENDPOINTS_OWN_STATEMENTS = `
CREATE TABLE IF NOT EXISTS survey_token_claims (
  token TEXT PRIMARY KEY,
  claimed_at INTEGER NOT NULL
);
`;

/**
 * ANALYTICS_DB is the rrm-analytics database, which this repo mirrors nowhere:
 * the ONE statement any targeted route sends it is admin/cleanup.js's
 * `DELETE FROM search_log WHERE created_at < ...`. Loading the rrm-auth
 * snapshot here (which is a different database entirely) would be both wrong
 * and, at 150 fresh envs a run, the single largest line in the harness's
 * runtime budget.
 */
const ANALYTICS_SEARCH_LOG = `
CREATE TABLE IF NOT EXISTS search_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

async function seedAuthDb() {
  /* communityD1, not sqliteD1: `schema.sql` predates the Action Areas and
     free-event migrations that live in the REPO-ROOT migrations/ directory, so
     the stock harness has no area_membership, project_membership or
     community_post.is_free. Every community route this harness attacks names
     at least one of them, and a missing table reads as a 500 finding that is
     really a stale fixture. */
  const db = communityD1();
  const sqlite = db._sqlite;
  const nowS = Math.floor(Date.now() / 1000);

  for (const [key, spec] of Object.entries(SEEDED_USERS)) {
    insertUser(sqlite, {
      id: spec.id,
      email: spec.email,
      name: spec.name,
      role: spec.role,
      email_verified: spec.verified ? 1 : 0,
      blocked: spec.blocked ? 1 : 0,
      hashed_password: SEEDED_HASH,
      stripe_customer_id: null,
    });
    if (spec.paying) insertWixSubscription(sqlite, { email: spec.email, user_id: spec.id });
    const stored = await insertSession(sqlite, {
      rawId: SESSION_COOKIES[key],
      userId: spec.id,
      expiresAt: nowS + 20 * 24 * 60 * 60,
    });
    if (key === 'member') MEMBER_STORED_SESSION_ID = stored;
  }

  await insertSession(sqlite, { rawId: EXPIRED_COOKIE, userId: SEEDED_USERS.member.id, expiresAt: nowS - 60 });

  sqlite.prepare(
    `INSERT INTO community_post (id, author_id, type, title, body, channel, created_at)
     VALUES (?, ?, 'discussion', ?, ?, 'stuc', datetime('now'))`
  ).run(VICTIM_POST_ID, SEEDED_USERS.member.id, 'Victim post', 'Seeded body for the IDOR cases.');
  sqlite.prepare(
    `INSERT INTO community_post (id, author_id, type, title, body, channel, created_at)
     VALUES (?, ?, 'discussion', ?, ?, 'stuc', datetime('now'))`
  ).run(ATTACKER_POST_ID, SEEDED_USERS.other.id, 'Attacker post', 'Seeded body owned by the attacker.');
  sqlite.prepare(
    `INSERT INTO community_comment (id, post_id, author_id, content, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`
  ).run(VICTIM_COMMENT_ID, VICTIM_POST_ID, SEEDED_USERS.member.id, 'Seeded comment owned by the victim.');

  for (const [id, owner] of [[VICTIM_KEY_ID, SEEDED_USERS.member.id], [ATTACKER_KEY_ID, SEEDED_USERS.other.id]]) {
    sqlite.prepare(
      `INSERT INTO mcp_api_key (id, user_id, label, key_hash, key_preview)
       VALUES (?, ?, 'redteam', ?, 'rrm_...seed')`
    ).run(id, owner, `hash_${id}`);
  }

  sqlite.prepare(
    `INSERT INTO "course" (id, slug, title, status, access_type, is_free) VALUES (?, ?, ?, 'published', 'public', 1)`
  ).run(SEEDED_COURSE_ID, SEEDED_COURSE_ID, 'Redteam course');
  sqlite.prepare(
    `INSERT INTO course_section (id, course_id, title, sort_order) VALUES ('redteam-section', ?, 'Section', 1)`
  ).run(SEEDED_COURSE_ID);
  sqlite.prepare(
    `INSERT INTO course_step (id, section_id, course_id, title, type, sort_order) VALUES (?, 'redteam-section', ?, 'Step', 'video', 1)`
  ).run(SEEDED_STEP_ID, SEEDED_COURSE_ID);

  sqlite.prepare(
    `INSERT INTO faq (id, question, published_answer, category, slug, status)
     VALUES (?, 'Seeded?', 'Yes.', 'general', 'redteam-seeded', 'published')`
  ).run(SEEDED_FAQ_ID);

  return db;
}

/** A counting stand-in for an R2 bucket: every write is recorded, none lands. */
function countingR2(counts) {
  return {
    async put(key) { counts.r2Put += 1; return { key }; },
    async get() { counts.r2Get += 1; return null; },
    async delete() { counts.r2Delete += 1; },
    async head() { counts.r2Get += 1; return null; },
  };
}

/** A counting stand-in for Workers AI: a call is a cost, and cost is the assertion. */
function countingAi(counts) {
  return {
    async run() {
      counts.ai += 1;
      return { data: [new Array(768).fill(0)] };
    },
  };
}

function countingAnalytics(counts) {
  return { writeDataPoint() { counts.analytics += 1; } };
}

/**
 * The whole env one case runs against, fresh per case so a rate-limit bucket
 * or a KV token written by one case cannot answer another.
 *
 * `counts` is the cost ledger the cost family reads: every binding that
 * spends money or writes data increments it, and the D1 write count is
 * derived from the engine's own statement log rather than from a wrapper, so
 * a route that writes through `batch()` is counted too.
 */
export async function redteamEnv(extra = {}) {
  const counts = { r2Put: 0, r2Get: 0, r2Delete: 0, ai: 0, analytics: 0, events: 0 };
  const db = await seedAuthDb();

  const env = {
    DB: db,
    SURVEY_DB: sqliteD1({ schemaSql: SURVEY_SCHEMA_SQL + SURVEY_TOKEN_CLAIMS_FROM_THE_ENDPOINTS_OWN_STATEMENTS }),
    SURVEY_SYMPTOMS_DB: symptomsD1(),
    ANALYTICS_DB: sqliteD1({ schemaSql: ANALYTICS_SEARCH_LOG }),
    COMMUNITY_KV: mockKVJson(),
    SURVEY_TOKENS: mockKVJson(),
    R2_ASSETS: countingR2(counts),
    AI: countingAi(counts),
    ANALYTICS: countingAnalytics(counts),
    EVENTS: { writeDataPoint() { counts.events += 1; } },
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ADMIN_API_SECRET: ADMIN_SECRET,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: AWS_SECRET,
    AWS_SES_REGION: 'us-east-1',
    CF_TURNSTILE_SECRET: TURNSTILE_SECRET,
    GA4_MEASUREMENT_ID: 'G-REDTEAM',
    GA4_API_SECRET: 'redteam-ga4-secret',
    ELV_API_KEY: 'redteam-elv-key',
    GOOGLE_ADS_CLIENT_ID: 'redteam-ads-client',
    GOOGLE_ADS_CLIENT_SECRET: 'redteam-ads-secret',
    GOOGLE_ADS_REFRESH_TOKEN: 'redteam-ads-refresh',
    LIBRARY_BUILD_TOKEN: 'redteam-library-build-token',
    SITE_URL: 'https://rrmacademy.org',
    ...extra,
  };

  return { env, counts };
}

/** Every statement the auth database executed, in order. */
export function dbCalls(env) {
  return env.DB?._calls ?? [];
}

/** How many of them wrote. Read off the engine, not off a wrapper. */
export function dbWrites(env) {
  const bindings = [env.DB, env.SURVEY_DB, env.SURVEY_SYMPTOMS_DB, env.ANALYTICS_DB];
  let writes = 0;
  for (const binding of bindings) {
    for (const call of binding?._calls ?? []) {
      if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(call.sql)) writes += 1;
    }
  }
  return writes;
}

/** Rows currently in the symptom store, for the pseudonymisation cases. */
export function symptomRows(env) {
  return env.SURVEY_SYMPTOMS_DB._sqlite.prepare('SELECT * FROM survey_symptoms').all().map((r) => ({ ...r }));
}

/** Every statement text the symptom store was ever handed. */
export function symptomSql(env) {
  return (env.SURVEY_SYMPTOMS_DB?._calls ?? []).map((call) => call.sql);
}
