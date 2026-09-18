/**
 * Falsification harness for validate-no-unfinished-copy.mjs.
 *
 * The gate bans accidental dev/editorial debris from shipped markup. It was
 * born 2026-07-19 after a session found three condition guides confessing they
 * were "actively edited … may change over the next few days", stale "Soon" nav
 * pills for tools that were already live, and an "Owner TBC" placeholder -- all
 * in production. Until 2026-09-18 it had no test.
 *
 * The gate has two halves and they are falsifiable in different ways:
 *   checkSource(src) is EXPORTED and pure, so the six rules are tested directly
 *     against strings -- no filesystem at all.
 *   the CLI driver reads bare relative SCAN_DIRS ('src/pages', 'src/components')
 *     from the process cwd, with no env override, so end-to-end tests run the
 *     gate with `cwd` set to a temp tree shaped like the repo.
 *
 * The distinction matters because the rules and the driver fail differently,
 * and the driver is where the interesting defect turned out to be: the
 * allowlist is FILE-level, so one legitimate phrase disables all six rules for
 * that whole file. That is pinned below, not fixed.
 *
 * Every test plants the exact debris its rule exists to catch and asserts RED,
 * and each was proven by weakening the rule and watching this file fail.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSource } from './validate-no-unfinished-copy.mjs';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'validate-no-unfinished-copy.mjs');

/**
 * A repo-shaped temp tree. `files` maps a path under the tree root to contents;
 * `allowlist` is the allowlist file's text (omit for none).
 *
 * The gate resolves SCAN_DIRS and ALLOWLIST_PATH from cwd, so the tree must
 * carry scripts/gates/ as well as src/. That is the whole reason this gate is
 * listed as testable-but-awkward rather than trivially testable.
 */
function fixture(files, allowlist) {
  const root = mkdtempSync(join(tmpdir(), 'unfinished-copy-gate-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(join(root, 'scripts/gates'), { recursive: true });
  if (allowlist !== undefined) writeFileSync(join(root, 'scripts/gates/unfinished-copy-allowlist.txt'), allowlist);
  // Both scan dirs must exist or the gate silently scans fewer files than the
  // test intends, and a green run would prove nothing.
  mkdirSync(join(root, 'src/pages'), { recursive: true });
  mkdirSync(join(root, 'src/components'), { recursive: true });
  return root;
}

function run(root) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [GATE], { cwd: root, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const CLEAN = '---\nconst title = "Endometriosis";\n---\n<h1>{title}</h1>\n<p>Ordinary shipped copy.</p>\n';

// ---- the six rules, via the exported pure function -------------------------

test('clean markup produces no hits', () => {
  assert.deepEqual(checkSource(CLEAN), []);
});

test('THE REGRESSION: each of the six banned markers is caught, with its label', () => {
  // These are the actual shapes found in production on 2026-07-19. One case
  // per rule, because a narrowing edit to any single rule is the likeliest
  // regression and a single-rule test would not see it.
  const cases = [
    ['<p>This guide is actively edited and may change.</p>', 'actively edited'],
    ['<td>Owner TBC</td>', 'Owner TBC'],
    ['<p>Lorem ipsum dolor sit amet.</p>', 'lorem ipsum'],
    ['<p>TODO: write the rest of this</p>', 'TODO/FIXME'],
    ['<p>placeholder text goes here</p>', 'placeholder text'],
    ['<span class="pill">Soon</span>', 'Soon'],
  ];
  for (const [markup, expectLabel] of cases) {
    const hits = checkSource(markup);
    assert.equal(hits.length, 1, `expected exactly one hit for ${JSON.stringify(markup)}, got ${JSON.stringify(hits)}`);
    assert.ok(hits[0].label.includes(expectLabel),
      `hit label ${JSON.stringify(hits[0].label)} should name ${expectLabel}`);
    assert.ok(hits[0].match.length > 0, 'the hit must quote what it matched, or the operator cannot find it');
  }
});

test('"Coming Soon" is a DESIGNED state and must NOT be flagged', () => {
  // The single most important false-negative in the file. Unreleased courses,
  // partner tiers and unwritten guides all ship "Coming Soon" deliberately. If
  // this goes red the gate fails the whole site and gets deleted.
  for (const markup of [
    '<span class="pill">Coming Soon</span>',
    '<span class="badge">Coming soon</span>',
    '<p>Coming Soon: the endometriosis module.</p>',
  ]) {
    assert.deepEqual(checkSource(markup), [], `${JSON.stringify(markup)} is a designed state`);
  }
});

test('the "Soon" pill rule requires a pill or badge class, not the bare word', () => {
  // "soon" appears in ordinary copy constantly ("we will publish soon"). The
  // class requirement is what keeps the rule specific, and without it the gate
  // would fire on prose across the site.
  assert.deepEqual(checkSource('<p>We will publish this soon.</p>'), []);
  assert.deepEqual(checkSource('<span>Soon</span>'), [], 'a bare span is not a status pill');
  assert.equal(checkSource('<span class="status-badge">Soon</span>').length, 1, 'a badge class IS a status pill');
});

test('TODO is only flagged when VISIBLE, not in a comment or frontmatter', () => {
  // The rule targets >TODO< between tags. A TODO in an HTML comment, a JS
  // comment or the Astro frontmatter is ordinary developer note-keeping and
  // flagging it would make the gate unusable.
  for (const markup of [
    '<!-- TODO: revisit this layout -->\n<p>Copy.</p>',
    '---\n// TODO: refactor this import\nconst x = 1;\n---\n<p>Copy.</p>',
    '---\n/* TODO: block comment */\nconst y = 2;\n---\n<p>Copy.</p>',
  ]) {
    assert.deepEqual(checkSource(markup), [], `${JSON.stringify(markup.slice(0, 40))} must not be flagged`);
  }
  // But the same word in rendered text is exactly the defect.
  assert.equal(checkSource('<p>TODO finish this section</p>').length, 1);
  assert.equal(checkSource('<li>FIXME broken link</li>').length, 1);
});

test('the banned markers are case-insensitive where they should be', () => {
  // "Actively Edited" in a heading is the same defect as "actively edited" in
  // prose. Five of the six rules carry /i and this pins that they do.
  assert.equal(checkSource('<h2>Actively Edited</h2>').length, 1);
  assert.equal(checkSource('<p>LOREM IPSUM</p>').length, 1);
  assert.equal(checkSource('<td>owner tbc</td>').length, 1);
  assert.equal(checkSource('<p>Placeholder Text</p>').length, 1);
});

test('ALL matching rules are reported for one file, not just the first', () => {
  // A file with three kinds of debris should say so, or the second pass is
  // needed to find the rest and the second pass is the one nobody runs.
  const hits = checkSource('<p>actively edited</p><td>Owner TBC</td><p>lorem ipsum</p>');
  assert.equal(hits.length, 3);
});

test('stripComments removes frontmatter WITHOUT eating the template below it', () => {
  // The frontmatter strip is a non-greedy match to the second ---. A greedy
  // one would delete the whole file up to the last --- it found, and every
  // rule would then scan an empty string: the gate would pass everything.
  // This is the vacuity failure mode for this gate, so it is asserted from
  // both sides.
  const withDivider = '---\nconst a = 1;\n---\n<p>actively edited</p>\n<hr />\n---\n<p>more</p>\n';
  assert.equal(checkSource(withDivider).length, 1,
    'debris after the frontmatter must still be found even when the body contains another ---');
});

// ---- the CLI driver, via a repo-shaped temp tree ---------------------------

test('the driver scans src/pages and src/components, and says how many files', () => {
  const root = fixture({
    'src/pages/index.astro': CLEAN,
    'src/components/Card.astro': CLEAN,
    'src/pages/nested/deep.astro': CLEAN,
  });
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no unfinished-state markers in 3 page\/component file\(s\)/u,
      'the count proves all three were read, including the nested one');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION end to end: debris in a page fails and names file and marker', () => {
  const root = fixture({
    'src/pages/index.astro': CLEAN,
    'src/pages/guide.astro': '<p>This guide is actively edited.</p>\n',
  });
  try {
    const r = run(root);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /src\/pages\/guide\.astro/u, 'the file must be named');
    assert.match(r.out, /actively edited/u, 'and the marker quoted');
    assert.match(r.out, /1 unfinished-state marker\(s\)/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('only .astro files are scanned, so a stray .md or .ts is not a false positive', () => {
  const root = fixture({
    'src/pages/index.astro': CLEAN,
    'src/pages/notes.md': '# TODO: lorem ipsum, Owner TBC\n',
    'src/components/helper.ts': 'const s = "placeholder text";\n',
  });
  try {
    const r = run(root);
    assert.equal(r.code, 0, `non-astro files are out of scope:\n${r.out}`);
    assert.match(r.out, /in 1 page\/component file\(s\)/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing scan directory does not crash the gate', () => {
  // collect() returns [] for a missing dir. Worth pinning because the
  // alternative is a throw that reads like a content failure.
  const root = mkdtempSync(join(tmpdir(), 'unfinished-copy-gate-'));
  try {
    mkdirSync(join(root, 'scripts/gates'), { recursive: true });
    const r = run(root);
    assert.equal(r.code, 0);
    assert.match(r.out, /in 0 page\/component file\(s\)/u,
      'zero files must be stated, not left as a bare green tick');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an allowlist entry suppresses the file it names', () => {
  const root = fixture(
    { 'src/pages/legit.astro': '<p>Our placeholder text policy is documented.</p>\n' },
    'placeholder text policy is documented\n',
  );
  try {
    assert.equal(run(root).code, 0, 'a listed substring must suppress the match');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('allowlist comments and blank lines are ignored, not treated as substrings', () => {
  // An empty string passed to src.includes('') is true for EVERY file, so a
  // blank line in the allowlist would suppress the entire repo. The filter on
  // falsy lines is what prevents that, and it is the highest-consequence line
  // in the loader.
  const root = fixture(
    { 'src/pages/bad.astro': '<p>lorem ipsum</p>\n' },
    '# a comment about the list\n\n   \n',
  );
  try {
    const r = run(root);
    assert.equal(r.code, 1, 'a blank allowlist line must NOT suppress every file in the repo');
    assert.match(r.out, /lorem ipsum/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('WEAKNESS, pinned not fixed: an allowlist entry disables ALL SIX rules for that file', () => {
  // HONEST FAILURE, NOT A PASSING ASSERTION.
  //
  // The allowlist is applied per FILE, not per match:
  //     if (allow.some((a) => src.includes(a))) continue;
  // so one legitimate phrase anywhere in a file exempts that file from every
  // rule. A page allowlisted for a documented "placeholder text" policy can
  // then ship "actively edited", "Owner TBC" and lorem ipsum with a green run.
  //
  // The gate's own header describes the list as "one substring per line" for
  // "a false positive", which reads as per-match suppression. It is not.
  //
  // NOT FIXED HERE: making it per-match means changing the gate's contract and
  // re-checking the live allowlist's entries against it, which is Brian's
  // call. This test asserts the current behaviour so it goes RED when that
  // lands, which is the signal to invert it.
  const root = fixture(
    {
      'src/pages/exempted.astro':
        '<p>Our placeholder text policy is documented.</p>\n'
        + '<p>This guide is actively edited and may change.</p>\n'
        + '<td>Owner TBC</td>\n<p>Lorem ipsum dolor.</p>\n<p>TODO finish</p>\n',
    },
    'placeholder text policy is documented\n',
  );
  try {
    const r = run(root);
    assert.equal(r.code, 0,
      'FIX LANDED: suppression is now per-match -- invert this test and assert the four other markers fail');
    // Proof that the debris really is there and really is detectable: the pure
    // function finds five markers in the same string the driver passes.
    const hits = checkSource(
      '<p>Our placeholder text policy is documented.</p>\n'
      + '<p>This guide is actively edited and may change.</p>\n'
      + '<td>Owner TBC</td>\n<p>Lorem ipsum dolor.</p>\n<p>TODO finish</p>\n');
    assert.equal(hits.length, 5,
      'the rules do fire on this content; only the file-level allowlist hides them');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing allowlist file is treated as no allowlist, not as a crash', () => {
  const root = fixture({ 'src/pages/bad.astro': '<p>lorem ipsum</p>\n' });
  try {
    const r = run(root);
    assert.equal(r.code, 1, `with no allowlist the gate must still fail on real debris:\n${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
