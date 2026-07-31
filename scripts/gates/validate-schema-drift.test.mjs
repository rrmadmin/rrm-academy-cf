/**
 * Tests for the schema.sql drift gate.
 *
 * Three of these are FLIPPED PINS. They previously described the drift as a
 * known, accepted limitation; they now assert it is gone, and each one fails
 * against the pre-fix tree:
 *   - retrieval_docs / retrieval_state in the composed rrm-auth mirror
 *   - the "ai_search_docs was DROPPED" claim in the replay-list disposition
 *   - the "DRAFT / HELD. Do NOT apply" header on a migration long since applied
 *
 * The rest exercise the gate itself. The live gates take an injected query
 * function so the whole file runs offline and deterministically; nothing here
 * touches Cloudflare.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MIN_LIVE_TABLES,
  MIRROR_ONLY_ALLOWED,
  PROJECT_ROOT,
  allowedReason,
  composeMirror,
  diffSchemas,
  gateSD1,
  gateSD2,
  gateSD3,
  isAllowed,
  isInternalTable,
  liveSchema,
  main,
} from './validate-schema-drift.mjs';
import { MIGRATIONS_NOT_REPLAYED } from '../../test/_d1-sqlite.mjs';

/** A `table -> Set(columns)` map from a plain object, the shape both sides use. */
function schema(obj) {
  return new Map(Object.entries(obj).map(([t, cols]) => [t, new Set(cols)]));
}

/** Collects gate output without printing. */
function capture() {
  const lines = [];
  return { lines, log: (s) => lines.push(String(s)), error: (s) => lines.push(String(s)) };
}

const verdicts = (items) => items.map((r) => r.ok);
const text = (items) => items.map((r) => r.msg).join('\n');

// ------------------------------------------------- flipped pins -------------

test('FLIPPED PIN: the composed mirror declares no rrm-library table', () => {
  // retrieval_docs and retrieval_state live in rrm-library (their DDL is in
  // rrm-library-worker/migrations/), never in rrm-auth. While schema.sql
  // declared them, a SELECT against either PREPAREd clean under gates:sql and
  // would have thrown "no such table" on its first production call. That is a
  // green gate certifying a guaranteed 500, and it is the founding case for
  // this whole file.
  const { tables, errors } = composeMirror();
  assert.deepEqual(errors, [], 'the mirror must compose cleanly');
  for (const t of ['retrieval_docs', 'retrieval_state']) {
    assert.equal(
      tables.has(t), false,
      `${t} is an rrm-library table and must not be in the rrm-auth mirror. ` +
      'Live rrm-auth does not have it; live rrm-library does (both verified 2026-07-31).'
    );
  }
});

test('FLIPPED PIN: the ai-search-docs disposition no longer claims the table was dropped', () => {
  // The old reason read "The ai_search_docs table was subsequently DROPPED
  // (see the schema.sql comment block); replaying it would resurrect a retired
  // table." Both halves were false, and the schema.sql comment it cited was the
  // source of the error. ai_search_docs is live and still written to by
  // scripts/ai-search-corpus-upload.mjs.
  const reason = MIGRATIONS_NOT_REPLAYED['ai-search-docs.sql'];
  assert.ok(reason, 'ai-search-docs.sql must still carry a written disposition');
  assert.equal(
    /(?:was|been)\s+(?:subsequently\s+)?DROPPED/i.test(reason), false,
    'the disposition must not assert ai_search_docs was dropped: it is live in rrm-auth'
  );
  assert.equal(
    /resurrect a retired table/i.test(reason), false,
    'the table is not retired, so "resurrect a retired table" is not a reason to exclude it'
  );
  assert.match(reason, /NOT DROPPED/i, 'the correction must be explicit, so nobody re-derives the old belief');

  const schemaSql = readFileSync(resolve(PROJECT_ROOT, 'schema.sql'), 'utf8');
  assert.equal(
    /DROPPED 2026-05-27 \(retrieval Plan 3\)/.test(schemaSql), false,
    'schema.sql still carries the comment that produced the wrong belief'
  );
});

test('FLIPPED PIN: the email-event migration header records it as applied, not held', () => {
  // test/_d1-sqlite.mjs excluded this migration from its replay list on the
  // strength of this header, so the harness had no email_log.ses_message_id
  // while production did, and that read as a month-long email outage that was
  // never happening. A file header is not a deployment record; live rrm-auth is.
  const sql = readFileSync(resolve(PROJECT_ROOT, 'scripts/migrations/2026-06-28-email-event.sql'), 'utf8');
  assert.equal(
    /STATUS:\s*DRAFT\s*\/\s*HELD/i.test(sql), false,
    'the migration is applied to live rrm-auth; a stale DRAFT/HELD header is what caused the incident'
  );
  assert.equal(
    /Do NOT apply/i.test(sql), false,
    'the header must not still instruct a reader to hold a migration that has been applied'
  );
  assert.match(sql, /STATUS:\s*APPLIED/i, 'the header must state the applied status positively');
  assert.match(sql, /ses_message_id/, 'the evidence cited in the header must name the column it is about');
});

// ------------------------------------------------- diff mechanics -----------

test('diffSchemas reports both directions and separates tables from columns', () => {
  const mirror = schema({ user: ['id', 'email'], ghost: ['id'], course: ['id', 'title'] });
  const live = schema({ user: ['id', 'email', 'phone'], course: ['id', 'title'], arrived: ['id'] });
  const d = diffSchemas(mirror, live);
  assert.deepEqual(d.mirrorOnlyTables, ['ghost']);
  assert.deepEqual(d.liveOnlyTables, ['arrived']);
  assert.deepEqual(d.mirrorOnlyColumns, []);
  assert.deepEqual(d.liveOnlyColumns, ['user.phone']);
});

test('diffSchemas does not report columns of a table only one side has', () => {
  // A missing table must be one finding, not one per column, or a new table
  // buries every other finding in the run.
  const mirror = schema({ ghost: ['a', 'b', 'c'] });
  const live = schema({ arrived: ['x', 'y'] });
  const d = diffSchemas(mirror, live);
  assert.deepEqual(d.mirrorOnlyTables, ['ghost']);
  assert.deepEqual(d.liveOnlyTables, ['arrived']);
  assert.deepEqual(d.mirrorOnlyColumns, []);
  assert.deepEqual(d.liveOnlyColumns, []);
});

test('isInternalTable filters engine and Cloudflare bookkeeping from both sides', () => {
  assert.equal(isInternalTable('sqlite_sequence'), true);
  assert.equal(isInternalTable('_cf_KV'), true);
  assert.equal(isInternalTable('d1_migrations'), false, 'd1_migrations is a real table on both sides');
  assert.equal(isInternalTable('user'), false);
});

test('liveSchema folds the flat (tbl, col) rows into a table map and drops internals', () => {
  const rows = [
    { tbl: 'user', col: 'id' },
    { tbl: 'user', col: 'email' },
    { tbl: 'sqlite_sequence', col: 'name' },
    { tbl: 'course', col: 'id' },
  ];
  const live = liveSchema({ query: () => rows });
  assert.deepEqual([...live.keys()].sort(), ['course', 'user']);
  assert.deepEqual([...live.get('user')].sort(), ['email', 'id']);
});

// ------------------------------------------------- SD2: stale-present -------

const bigLive = (extra = {}) => {
  const obj = {};
  for (let i = 0; i < MIN_LIVE_TABLES + 5; i++) obj[`t${i}`] = ['id'];
  return schema({ ...obj, ...extra });
};
const readOk = (live) => () => ({ live });

test('SD2 FAILS on a mirror table live does not have', () => {
  const live = bigLive();
  const mirror = new Map([...live, ['retrieval_docs', new Set(['key'])]]);
  const items = gateSD2(mirror, readOk(live));
  assert.ok(verdicts(items).includes(false), 'stale-present must fail, not warn');
  assert.match(text(items), /retrieval_docs/);
  assert.match(text(items), /PREPAREs clean/, 'the message must say why this direction is the dangerous one');
});

test('SD2 FAILS on a mirror column live does not have', () => {
  const live = bigLive({ user: ['id'] });
  const mirror = bigLive({ user: ['id', 'invented'] });
  const items = gateSD2(mirror, readOk(live));
  assert.ok(verdicts(items).includes(false));
  assert.match(text(items), /user\.invented/);
});

test('SD2 passes when the mirror is a subset of live', () => {
  const live = bigLive({ user: ['id', 'email', 'added_live_by_hand'] });
  const mirror = bigLive({ user: ['id', 'email'] });
  const items = gateSD2(mirror, readOk(live));
  assert.equal(verdicts(items).includes(false), false, 'live-only columns are SD3 business, not SD2');
});

test('SD2 warn-skips instead of failing when live is unreachable', () => {
  const items = gateSD2(bigLive({ ghost: ['id'] }), () => ({ error: 'wrangler d1 execute failed: not logged in' }));
  assert.deepEqual(verdicts(items), [null], 'an unreachable D1 must never block a deploy');
  assert.match(text(items), /skipped/);
});

test('SD2 warn-skips an implausibly small live read rather than reporting every table as drift', () => {
  // The vacuity guard. A successful-but-empty read would otherwise mark all 76
  // mirror tables stale-present, which is noise, and mark zero stale-absent,
  // which is silence.
  const items = gateSD2(bigLive(), readOk(schema({ user: ['id'] })));
  assert.deepEqual(verdicts(items), [null]);
  assert.match(text(items), /unreliable/);
});

test('SD2 skips both live gates in --quick mode', () => {
  assert.deepEqual(verdicts(gateSD2(bigLive({ ghost: ['id'] }), () => { throw new Error('must not read live'); }, { quick: true })), [null]);
  assert.deepEqual(verdicts(gateSD3(bigLive(), () => { throw new Error('must not read live'); }, { quick: true })), [null]);
});

// ------------------------------------------------- SD3: stale-absent --------

test('SD3 WARNS, never fails, on a live table the mirror lacks', () => {
  const live = bigLive({ brand_new: ['id'] });
  const mirror = bigLive();
  const items = gateSD3(mirror, readOk(live));
  assert.equal(verdicts(items).includes(false), false, 'stale-absent must never block a deploy');
  assert.ok(verdicts(items).includes(null), 'but it must say something');
  assert.match(text(items), /brand_new/);
});

test('SD3 tells the reader NOT to conclude the column is missing in production', () => {
  // This exact sentence is the artefact whose absence caused the email_log
  // incident: an agent read the mirror, inferred an outage, and started
  // rewriting production code around it.
  const live = bigLive({ email_log: ['id', 'ses_message_id'] });
  const mirror = bigLive({ email_log: ['id'] });
  const items = gateSD3(mirror, readOk(live));
  assert.equal(verdicts(items).includes(false), false);
  assert.match(text(items), /email_log\.ses_message_id/);
  assert.match(text(items), /Do NOT read the mirror as evidence/);
  assert.match(text(items), /Production is fine/);
});

test('SD3 passes clean when the mirror covers live', () => {
  const live = bigLive({ user: ['id', 'email'] });
  const items = gateSD3(new Map(live), readOk(live));
  assert.deepEqual(verdicts(items), [true]);
});

test('SD3 warn-skips an unreachable or implausible live read', () => {
  assert.deepEqual(verdicts(gateSD3(bigLive(), () => ({ error: 'boom' }))), [null]);
  assert.deepEqual(verdicts(gateSD3(bigLive(), readOk(schema({ user: ['id'] })))), [null]);
});

// ------------------------------------------------- SD1: allowlist -----------

test('SD1 passes on the real mirror with an empty allowlist', () => {
  const { tables, errors } = composeMirror();
  const items = gateSD1(tables, errors);
  assert.equal(verdicts(items).includes(false), false, text(items));
  assert.match(text(items), /MIRROR_ONLY_ALLOWED is empty/);
});

test('MIRROR_ONLY_ALLOWED is empty: no stale-present drift is being excused today', () => {
  // If this ever fails, read the reasons before doing anything else. An
  // allowlist entry is a deliberate, temporary, written-down exception.
  assert.deepEqual(Object.keys(MIRROR_ONLY_ALLOWED), []);
});

const REAL_REASON = 'Committed in this PR and applied to live rrm-auth at deploy time; remove after the apply.';

test('SD1 fails an allowlist entry whose reason is a placeholder', () => {
  const mirror = bigLive({ pending: ['id'] });
  const items = gateSD1(mirror, [], { pending: 'because' });
  assert.ok(verdicts(items).includes(false));
  assert.match(text(items), /substantive written reason/);
});

test('SD1 fails an allowlist key that is not `table` or `table.column`', () => {
  const mirror = bigLive({ pending: ['id'] });
  const items = gateSD1(mirror, [], { 'pending.id.extra': REAL_REASON });
  assert.ok(verdicts(items).includes(false));
  assert.match(text(items), /not `table` or `table\.column`/);
});

test('SD1 fails an allowlist entry the mirror no longer declares, so the list cannot rot', () => {
  // Without this, an entry added for one PR stays forever and permanently
  // blinds SD2 to whatever it names.
  const mirror = bigLive();
  const items = gateSD1(mirror, [], { long_gone: REAL_REASON });
  assert.ok(verdicts(items).includes(false));
  assert.match(text(items), /no longer declares/);

  const colItems = gateSD1(bigLive({ user: ['id'] }), [], { 'user.long_gone': REAL_REASON });
  assert.ok(verdicts(colItems).includes(false));
  assert.match(text(colItems), /column the mirror no longer declares/);
});

test('SD1 accepts a well-formed allowlist entry, as a warning rather than silence', () => {
  const items = gateSD1(bigLive({ pending: ['id'] }), [], { pending: REAL_REASON });
  assert.equal(verdicts(items).includes(false), false);
  assert.ok(verdicts(items).includes(null), 'an excused entry must still be visible in the output');
  assert.match(text(items), /allowlisted stale-present: pending/);
});

test('SD2 downgrades an allowlisted stale-present object to a warning, and names the reason', () => {
  const live = bigLive();
  const mirror = new Map([...live, ['pending', new Set(['id', 'label'])]]);
  const items = gateSD2(mirror, readOk(live), { allow: { pending: REAL_REASON } });
  assert.equal(verdicts(items).includes(false), false, 'an excused object must not block');
  assert.match(text(items), /allowlisted/);
  assert.match(text(items), /remove after the apply/);
});

test('a table-level allowlist entry covers that table columns too', () => {
  const allow = { pending: REAL_REASON };
  assert.equal(isAllowed('pending', allow), true);
  assert.equal(isAllowed('pending.label', allow), true);
  assert.equal(isAllowed('other.label', allow), false);
  assert.equal(allowedReason('pending.label', allow), REAL_REASON);
});

test('SD1 fails when the mirror will not compose', () => {
  const items = gateSD1(schema({}), ['near line 12: no such table: main.user']);
  assert.ok(verdicts(items).includes(false));
  assert.match(text(items), /failed to load/);
});

test('SD1 fails a mirror that composed to an implausibly small table count', () => {
  const items = gateSD1(schema({ user: ['id'] }), []);
  assert.ok(verdicts(items).includes(false), 'a tiny mirror means the composition broke, not that 75 tables were dropped');
  assert.match(text(items), /composition is broken/);
});

test('isAllowed / allowedReason resolve a column through its table entry', () => {
  // Behaviour of the lookup helpers, independent of today's empty list.
  assert.equal(isAllowed('not_allowlisted'), false);
  assert.equal(allowedReason('not_allowlisted'), null);
  assert.equal(isAllowed('nope.also_nope'), false);
});

// ------------------------------------------------- wiring -------------------

test('main() runs the real repository in --quick mode and returns 0', () => {
  const out = capture();
  const code = main(['--quick'], out);
  assert.equal(code, 0, out.lines.join('\n'));
  const joined = out.lines.join('\n');
  assert.match(joined, /Gate SD1/);
  assert.match(joined, /SD2 skipped/);
  assert.match(joined, /SD3 skipped/);
});

test('main() --json emits a machine-readable summary', () => {
  const out = capture();
  const code = main(['--quick', '--json'], out);
  assert.equal(code, 0);
  const parsed = JSON.parse(out.lines.join('\n'));
  assert.equal(parsed.summary.total, 3);
  assert.deepEqual(parsed.gates.map((g) => g.id), ['SD1', 'SD2', 'SD3']);
});

test('main() --gate runs exactly one gate', () => {
  const out = capture();
  main(['--quick', '--json', '--gate', 'SD1'], out);
  const parsed = JSON.parse(out.lines.join('\n'));
  assert.deepEqual(parsed.gates.map((g) => g.id), ['SD1']);
});

test('the gate is wired as gates:schema-drift and runs in deploy.yml', () => {
  // A gate nobody runs guards nothing. Both halves of the wiring are asserted
  // here so removing either one is a named test failure.
  const pkg = JSON.parse(readFileSync(resolve(PROJECT_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['gates:schema-drift'], 'node scripts/gates/validate-schema-drift.mjs');
  assert.equal(pkg.scripts['gates:schema-drift:check'], 'node scripts/gates/validate-schema-drift.mjs --quick');

  const deploy = readFileSync(resolve(PROJECT_ROOT, '.github/workflows/deploy.yml'), 'utf8');
  assert.match(deploy, /npm run gates:schema-drift\b/, 'deploy.yml must run the gate');
  const step = deploy.slice(deploy.indexOf('Validate schema.sql drift gates'), deploy.indexOf('npm run gates:schema-drift') + 40);
  assert.match(step, /CLOUDFLARE_API_TOKEN/, 'the live gates need a token in CI or they warn-skip into a no-op');
});

test('CLAUDE.md documents the gate in the proof-gate register', () => {
  const claude = readFileSync(resolve(PROJECT_ROOT, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /gates:schema-drift/);
  assert.match(claude, /stale-present/i);
  assert.match(claude, /stale-absent/i);
});
