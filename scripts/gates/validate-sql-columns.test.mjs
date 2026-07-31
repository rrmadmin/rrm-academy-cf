import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PROJECT_ROOT,
  SENTINEL_TABLES,
  MIN_TABLES,
  INTERP,
  attributeDatabase,
  buildSchemaDb,
  checkStatement,
  displaySql,
  extractSql,
  fileDatabaseNames,
  foldConcat,
  listSources,
  looksLikeSql,
  main,
  readD1Bindings,
  resolveReceiver,
  runGates,
  scan,
  skipBuckets,
  splitStatements,
  substituteInterpolations,
} from './validate-sql-columns.mjs';

/** Writes a throwaway .js file and returns its absolute path. */
function fixture(name, source) {
  const dir = mkdtempSync(join(tmpdir(), 'sqlgate-'));
  const abs = join(dir, name);
  writeFileSync(abs, source, 'utf8');
  return abs;
}

// ------------------------------------------------------------- schema ------

test('SQ1: the composed schema loads with every sentinel table', () => {
  const { db, errors, tables } = buildSchemaDb();
  assert.deepEqual(errors, [], 'schema DDL must load without errors');
  for (const t of SENTINEL_TABLES) assert.ok(tables.includes(t), `missing table ${t}`);
  assert.ok(tables.length >= MIN_TABLES, `only ${tables.length} tables`);
  db.close();
});

test('the composed schema carries the real step_progress shape (no id column)', () => {
  const { db } = buildSchemaDb();
  const cols = db.prepare("SELECT name FROM pragma_table_info('step_progress')").all().map((r) => r.name);
  assert.deepEqual(cols.slice(0, 3), ['user_id', 'course_id', 'step_id']);
  assert.ok(!cols.includes('id'), 'step_progress must NOT have an id column, or the gate proves nothing');
  db.close();
});

// -------------------------------------------------------- SQL splitting ----

test('splitStatements ignores semicolons inside comments and string literals', () => {
  const sql = `
    -- a comment; with a semicolon
    CREATE TABLE t (a TEXT DEFAULT 'x;y');
    CREATE INDEX i ON t(a);
  `;
  const parts = splitStatements(sql);
  assert.equal(parts.length, 2);
  assert.match(parts[0], /CREATE TABLE t/);
  assert.match(parts[1], /CREATE INDEX i/);
});

test('splitStatements drops comment-only fragments', () => {
  assert.deepEqual(splitStatements('-- nothing here\n'), []);
});

// ------------------------------------------------------- SQL recognition ---

test('looksLikeSql accepts real statements and rejects prose', () => {
  assert.ok(looksLikeSql('SELECT id FROM course WHERE id = ?'));
  assert.ok(looksLikeSql('INSERT INTO user (id) VALUES (?)'));
  assert.ok(looksLikeSql('INSERT OR IGNORE INTO user_label (user_id, label) VALUES (?, ?)'));
  assert.ok(looksLikeSql('UPDATE faq SET basic_answer = ? WHERE id = ?'));
  assert.ok(looksLikeSql('DELETE FROM session WHERE id = ?'));
  assert.ok(looksLikeSql('WITH x AS (SELECT 1) SELECT * FROM x'));
  assert.ok(!looksLikeSql('Select a course to continue'));
  assert.ok(!looksLikeSql('update your billing details'));
});

// --------------------------------------------------------- extraction ------

test('extractSql folds a concatenated statement into ONE statement, not two', () => {
  const src = [
    "env.DB.prepare(",
    "  'DELETE FROM course_step WHERE section_id = ?' +",
    "  ' AND NOT EXISTS (SELECT 1 FROM step_progress WHERE step_id = course_step.id)'",
    ").bind(sectionId);",
  ].join('\n');
  const { statements } = extractSql(src, 'fixture.js');
  assert.equal(statements.length, 1, 'the operands must not be reported separately');
  assert.match(statements[0].text, /NOT EXISTS/);
  assert.equal(statements[0].receiver, 'env.DB');
});

test('foldConcat marks a non-literal operand as an interpolation', () => {
  const src = "const q = 'SELECT id FROM course WHERE id = ' + courseId;";
  const { statements } = extractSql(src, 'fixture.js');
  assert.equal(statements.length, 1);
  assert.equal(statements[0].interpolations, 1);
  assert.ok(statements[0].text.endsWith(INTERP));
});

test('foldConcat on a lone literal returns it unchanged', () => {
  const folded = foldConcat({ type: 'Literal', value: 'SELECT 1' });
  assert.deepEqual(folded, { text: 'SELECT 1', interpolations: 0 });
});

test('extractSql records template interpolations and the prepare receiver', () => {
  const src = 'const db = env.SURVEY_DB;\ndb.prepare(`SELECT id FROM quiz_result WHERE id = ${x}`).all();';
  const { statements, assignments } = extractSql(src, 'fixture.js');
  assert.equal(statements.length, 1);
  assert.equal(statements[0].interpolations, 1);
  assert.equal(statements[0].receiver, 'db');
  assert.equal(assignments.get('db'), 'env.SURVEY_DB');
});

test('extractSql reports a parse failure instead of pretending the file has no SQL', () => {
  const { statements, parseError } = extractSql('function ( { SELECT', 'broken.js');
  assert.equal(statements.length, 0);
  assert.ok(parseError, 'a syntactically broken file must surface an error');
});

test('displaySql renders the internal marker as a visible interpolation', () => {
  assert.equal(displaySql(`SELECT ${INTERP}  FROM t`), 'SELECT ${..} FROM t');
});

// ------------------------------------------------------- attribution -------

test('readD1Bindings reads the wrangler.toml bindings', () => {
  const bindings = readD1Bindings();
  assert.equal(bindings.get('DB'), 'rrm-auth');
  assert.equal(bindings.get('SURVEY_DB'), 'rrm-survey');
  assert.equal(bindings.get('SURVEY_SYMPTOMS_DB'), 'rrm-survey-symptoms');
});

test('resolveReceiver walks env.X, context.env.X and a local alias', () => {
  const bindings = readD1Bindings();
  const assignments = new Map([['db', 'env.SURVEY_DB']]);
  assert.equal(resolveReceiver('env.DB', assignments, bindings), 'rrm-auth');
  assert.equal(resolveReceiver('context.env.ANALYTICS_DB', assignments, bindings), 'rrm-analytics');
  assert.equal(resolveReceiver('db', assignments, bindings), 'rrm-survey');
  assert.equal(resolveReceiver('somethingElse', assignments, bindings), null);
  assert.equal(resolveReceiver(null, assignments, bindings), null);
});

test('fileDatabaseNames does not mistake rrm-survey-symptoms for rrm-survey', () => {
  const names = fileDatabaseNames("d1('rrm-survey-symptoms', sql)");
  assert.deepEqual([...names], ['rrm-survey-symptoms']);
});

test('an explicit d1(<name>, sql) argument outranks the file-level mention', () => {
  // The shape that produced a false positive on scripts/femtech-ab-send.mjs:
  // the file says "rrm-auth" all over, but this one call names another database.
  const src = "d1('rrm-auth', 'SELECT id FROM contact');\nd1('femtech-mvp', 'SELECT lower(email) AS email FROM waitlist');";
  const { statements, assignments } = extractSql(src, 'scripts/x.mjs');
  const ctx = {
    assignments,
    bindings: readD1Bindings(),
    fileNames: fileDatabaseNames(src),
    relPath: 'scripts/x.mjs',
    hasNonAuthBinding: false,
  };
  const targets = statements.map((s) => attributeDatabase(s, ctx));
  assert.deepEqual(targets.map((t) => t.db), ['rrm-auth', 'femtech-mvp']);
  assert.equal(targets[1].how, 'explicit-d1-helper-argument');
});

test('attributeDatabase names the reason it cannot decide', () => {
  const bindings = readD1Bindings();
  const base = { assignments: new Map(), bindings, hasNonAuthBinding: false };
  const ambiguous = attributeDatabase(
    { receiver: null },
    { ...base, fileNames: new Set(['rrm-auth', 'rrm-library']), relPath: 'scripts/x.mjs' }
  );
  assert.equal(ambiguous.db, null);
  assert.match(ambiguous.reason, /^ambiguous-database/);

  const unknown = attributeDatabase(
    { receiver: null },
    { ...base, fileNames: new Set(), relPath: 'scripts/x.mjs' }
  );
  assert.equal(unknown.db, null);
  assert.match(unknown.reason, /^no-database-identified/);

  const fnDefault = attributeDatabase(
    { receiver: null },
    { ...base, fileNames: new Set(), relPath: 'functions/api/x.js' }
  );
  assert.equal(fnDefault.db, 'rrm-auth');

  const fnAmbiguous = attributeDatabase(
    { receiver: null },
    { ...base, hasNonAuthBinding: true, fileNames: new Set(), relPath: 'functions/api/x.js' }
  );
  assert.equal(fnAmbiguous.db, null);
  assert.match(fnAmbiguous.reason, /^ambiguous-database/);
});

// ----------------------------------------------------- statement checks ----

test('checkStatement flags a missing column, a missing table, and passes a good one', () => {
  const { db } = buildSchemaDb();

  const bad = checkStatement(db, { text: 'SELECT id FROM step_progress WHERE course_id = ? LIMIT 1', interpolations: 0 });
  assert.equal(bad.status, 'finding');
  assert.equal(bad.kind, 'column');
  assert.equal(bad.identifier, 'id');

  const noTable = checkStatement(db, { text: 'SELECT id FROM nope_not_a_table', interpolations: 0 });
  assert.equal(noTable.status, 'finding');
  assert.equal(noTable.kind, 'table');

  const good = checkStatement(db, { text: 'SELECT user_id FROM step_progress WHERE course_id = ? LIMIT 1', interpolations: 0 });
  assert.equal(good.status, 'checked');

  db.close();
});

test('checkStatement skips, with a reason, what it cannot prepare', () => {
  const { db } = buildSchemaDb();

  const multi = checkStatement(db, { text: 'SELECT 1 FROM user; SELECT 2 FROM user', interpolations: 0 });
  assert.equal(multi.status, 'skipped');
  assert.match(multi.reason, /multi-statement/);

  const dynamicTable = checkStatement(db, { text: `SELECT id FROM ${INTERP} WHERE x = 1`, interpolations: 1 });
  assert.equal(dynamicTable.status, 'skipped');
  assert.match(dynamicTable.reason, /^interpolated/);

  const junk = checkStatement(db, { text: 'SELECT FROM WHERE', interpolations: 0 });
  assert.equal(junk.status, 'skipped');
  assert.match(junk.reason, /^unpreparable/);

  db.close();
});

test('substituting a placeholder still checks the surrounding identifiers', () => {
  const { db } = buildSchemaDb();
  const sql = `SELECT id, slug FROM faq WHERE published_answer LIKE '%/glossary/${INTERP}/%'`;
  assert.equal(substituteInterpolations(sql).includes('?'), true);
  assert.equal(checkStatement(db, { text: sql, interpolations: 1 }).status, 'checked');

  // Same shape, wrong column: the interpolation does not hide it.
  const wrong = `SELECT id, slug FROM faq WHERE answer LIKE '%/glossary/${INTERP}/%'`;
  const r = checkStatement(db, { text: wrong, interpolations: 1 });
  assert.equal(r.status, 'finding');
  assert.equal(r.identifier, 'answer');
  db.close();
});

// ------------------------------------------------------------- scan --------

test('scan catches the step_progress.id defect in a fixture endpoint', () => {
  const abs = fixture('handler.js', `
    export async function onRequestDelete({ env, params }) {
      const [rows] = await Promise.all([
        env.DB.prepare('SELECT id FROM step_progress WHERE course_id = ? LIMIT 1').bind(params.id).all(),
      ]);
      return new Response(rows.length);
    }
  `);
  const result = scan({ files: [abs] });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, 'column');
  assert.equal(result.findings[0].identifier, 'id');
  assert.match(result.findings[0].sql, /step_progress/);
});

test('scan attributes a SURVEY_DB statement away from rrm-auth instead of failing it', () => {
  const abs = fixture('survey.js', `
    export async function onRequestGet({ env }) {
      return env.SURVEY_DB.prepare('SELECT id FROM quiz_result WHERE token = ?').bind('x').first();
    }
  `);
  const result = scan({ files: [abs] });
  assert.equal(result.findings.length, 0);
  assert.equal(result.skips.length, 1);
  assert.match(result.skips[0].reason, /^other-database \(rrm-survey/);
});

test('scan reports a parse failure rather than silently covering nothing', () => {
  const abs = fixture('broken.js', 'const x = ; SELECT id FROM user');
  const result = scan({ files: [abs] });
  assert.equal(result.parseFailures.length, 1);
  assert.equal(result.checked, 0);
});

test('the admin DM queue endpoints prepare cleanly (the dm_* tables are real)', () => {
  // An adversarial verifier reading only schema.sql called these five tables
  // nonexistent and proposed deleting the endpoints. They are live; this test
  // is the standing refutation.
  const result = scan({
    files: [
      join(PROJECT_ROOT, 'functions/api/admin/dm-queue.js'),
      join(PROJECT_ROOT, 'functions/api/admin/dm-queue/[id].js'),
    ],
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.skips.length, 0);
  assert.ok(result.checked >= 5, `expected the dm-queue SQL to be checked, prepared ${result.checked}`);
});

test('rename-slugs.mjs SQL prepares: no faq.answer, no course_step.content_md', () => {
  const abs = join(PROJECT_ROOT, 'scripts/glossary/rename-slugs.mjs');
  const result = scan({ files: [abs] });
  assert.deepEqual(result.findings, []);
  assert.ok(result.checked > 0, 'the script must still contribute checked statements');

  const { statements } = extractSql(readFileSync(abs, 'utf8'), 'scripts/glossary/rename-slugs.mjs');
  const all = statements.map((s) => s.text).join('\n');
  assert.ok(!/\bcontent_md\b/.test(all), 'content_md has never existed on course_step');
  assert.ok(/published_answer/.test(all) && /basic_answer/.test(all) && /schema_answer/.test(all));
});

// ------------------------------------------------------------ reporting ----

test('runGates fails SQ2 on a finding and SQ3 on a collapsed statement count', () => {
  const gates = runGates({
    findings: [{ file: 'a.js', line: 1, kind: 'column', identifier: 'id', message: 'no such column: id', sql: 'SELECT id FROM step_progress' }],
    skips: [{ reason: 'other-database (rrm-library)' }, { reason: 'other-database (rrm-library)' }, { reason: 'interpolated (x)' }],
    parseFailures: [],
    checked: 3,
    statementsSeen: 6,
    tables: [],
    schemaErrors: ['boom'],
    fileCount: 1,
  });
  const byId = Object.fromEntries(gates.map((g) => [g.id, g]));
  assert.ok(byId.SQ1.items.some((i) => i.ok === false), 'a schema load error must fail SQ1');
  assert.ok(byId.SQ2.items.some((i) => i.ok === false));
  assert.ok(byId.SQ3.items.some((i) => i.ok === false), 'a collapsed prepared count must fail SQ3');
});

test('runGates does not enforce the statement floor in --quick mode', () => {
  const gates = runGates(
    { findings: [], skips: [], parseFailures: [], checked: 3, statementsSeen: 3, tables: [], schemaErrors: [], fileCount: 1 },
    { quick: true }
  );
  const sq3 = gates.find((g) => g.id === 'SQ3');
  assert.ok(!sq3.items.some((i) => i.ok === false));
  assert.ok(sq3.items.some((i) => /--quick/.test(i.msg)));
});

test('skipBuckets groups by reason head', () => {
  const buckets = skipBuckets([
    { reason: 'other-database (rrm-library)' },
    { reason: 'other-database (rrm-survey)' },
    { reason: 'interpolated (near "?")' },
  ]);
  assert.deepEqual(buckets, [['other-database', 2], ['interpolated', 1]]);
});

test('listSources in --quick mode scans functions/ only', () => {
  const quick = listSources(PROJECT_ROOT, { quick: true });
  assert.ok(quick.length > 50);
  assert.ok(quick.every((p) => p.includes('/functions/')));
  assert.ok(quick.every((p) => !/\.test\.m?js$/.test(p)));
  assert.ok(listSources(PROJECT_ROOT).length > quick.length);
});

test('main() prints a report and returns 0 over the real repository', () => {
  const lines = [];
  const out = { log: (s) => lines.push(String(s)), error: (s) => lines.push(String(s)) };
  const code = main(['--verbose'], out);
  const text = lines.join('\n');
  assert.equal(code, 0, `gate must be green on this tree:\n${text}`);
  assert.match(text, /Gate SQ1/);
  assert.match(text, /Gate SQ2/);
  assert.match(text, /Gate SQ3/);
  assert.match(text, /skipped \d+:/);
});

test('main() --json emits a machine-readable summary with the skip breakdown', () => {
  const lines = [];
  const out = { log: (s) => lines.push(String(s)), error: (s) => lines.push(String(s)) };
  const code = main(['--json', '--quick', '--gate', 'SQ2'], out);
  assert.equal(code, 0);
  const parsed = JSON.parse(lines.join('\n'));
  assert.equal(parsed.gates.length, 1);
  assert.equal(parsed.gates[0].id, 'SQ2');
  assert.equal(parsed.summary.failed, 0);
  assert.ok(parsed.summary.checked > 0);
  assert.ok(Array.isArray(parsed.skipBuckets));
});
