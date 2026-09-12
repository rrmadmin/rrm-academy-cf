/**
 * A D1-shaped rrm-auth binding that ALSO carries the bulk mail rail's tables.
 *
 * WHY THIS EXISTS
 * ---------------
 * test/_d1-sqlite.mjs builds rrm-auth from schema.sql ("Generated from the live
 * database on 2026-05-27") plus a replay list scoped to scripts/migrations/.
 * mail_domain_state and send_paused are in NEITHER: their DDL lives in the ROOT
 * migrations/ directory (041-bulk-mail-rail.sql), which the replay list does not
 * read and test/schema-migration-replay.test.mjs does not scan. This mirrors
 * test/_community-sqlite.mjs, whose action_area tables have the same problem for
 * the same reason.
 *
 * Also composed: root migrations/034-membership-state.sql. It is a separate,
 * earlier root migration (wix_subscription.membership_state), not part of the
 * bulk rail's own DDL, but Task 6's bulk-send tests seed a lapsed member with
 * that column (spec section 3: "membership_state is a lapse REASON, never a
 * status", so a lapsed member must still be IN the bulk audience) and this
 * harness is the one every bulk-path test loads. Without it here, that seed
 * INSERT throws "no such column: membership_state" before the assertion under
 * test ever runs.
 *
 * Load the plain harness and every statement in functions/api/newsletter/send.js's
 * bulk path fails to PREPARE with "no such table: mail_domain_state". Under
 * test/_helpers.js mockDB the same statements would "succeed" against canned
 * rows, which is the failure mode this harness family exists to refuse.
 *
 * WHAT THIS FAKE CANNOT DISTINGUISH (read before trusting a green run)
 * -------------------------------------------------------------------
 *  1. Whether live rrm-auth matches migrations 034 and 041. This reads the
 *     files; it cannot query Cloudflare. `npm run gates:schema-drift` is what
 *     compares the composed mirror to live, in both directions, once the
 *     EXTRA_DDL entry in scripts/gates/validate-sql-columns.mjs is in place.
 *  2. Everything test/_d1-sqlite.mjs already lists: D1-vs-SQLite engine
 *     differences, the ~100KB statement cap, real concurrency, and every
 *     non-database service (SES, SNS, KV).
 */
import { readFileSync } from 'node:fs';
import { sqliteD1, SCHEMA_SQL } from './_d1-sqlite.mjs';

/**
 * Root-migrations files, in application (and numeric) order, composed onto
 * schema.sql for the bulk rail's test harness. 034 is not bulk-rail DDL --
 * it is the wix_subscription.membership_state column the Task 6 lapsed-member
 * test depends on -- but it lives in root migrations/ same as 041, and this
 * harness is what every bulk-path test loads, so it belongs here too.
 */
export const BULK_MAIL_MIGRATIONS = ['034-membership-state.sql', '041-bulk-mail-rail.sql', '042-bulk-campaign-lease.sql', '043-bulk-lease-unique.sql'];

/**
 * Same list, minus 043. Exists ONLY so a test can prove the schema-guard
 * (send.js's pre-lease check for idx_nl_send_one_live_per_campaign) actually
 * fires when a deploy has shipped 041+042 but not yet 043 -- see the finding
 * this closes: isSchemaNotMigratedError matches column/table errors, but 043
 * is an INDEX, so a missing 043 alone throws nothing and the mutex silently
 * stops existing. Never use this for anything but that one negative case.
 */
export const BULK_MAIL_MIGRATIONS_NO_LEASE_INDEX = BULK_MAIL_MIGRATIONS.filter((n) => n !== '043-bulk-lease-unique.sql');

function composeSchema(migrations) {
  return migrations.reduce(
    (sql, name) => sql + '\n' + readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8'),
    SCHEMA_SQL,
  );
}

/** schema.sql + the replay list + migrations 034, 041, 042 and 043, in that order. */
export const BULK_MAIL_SCHEMA_SQL = composeSchema(BULK_MAIL_MIGRATIONS);

/** The same, but without 043 -- see BULK_MAIL_MIGRATIONS_NO_LEASE_INDEX. */
export const BULK_MAIL_SCHEMA_SQL_NO_LEASE_INDEX = composeSchema(BULK_MAIL_MIGRATIONS_NO_LEASE_INDEX);

/**
 * Same option bag as sqliteD1({ seed, interleave }); schemaSql is supplied.
 * @param {{ seed?: Function, interleave?: object }} [opts]
 */
export function bulkMailD1(opts = {}) {
  return sqliteD1({ ...opts, schemaSql: BULK_MAIL_SCHEMA_SQL });
}

/** Same, composed WITHOUT migration 043 -- see BULK_MAIL_MIGRATIONS_NO_LEASE_INDEX. */
export function bulkMailD1NoLeaseIndex(opts = {}) {
  return sqliteD1({ ...opts, schemaSql: BULK_MAIL_SCHEMA_SQL_NO_LEASE_INDEX });
}
