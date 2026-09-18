/**
 * Falsification harness for validate-post-markdown.mjs.
 *
 * The gate exists because of the 2026-07-10 burn: a commentary post stored as
 * <p>-wrapped HTML rendered as a wall of visible literal tags, because the
 * template runs parseMarkdown() over the body. Until 2026-09-18 the gate had no
 * test, so an edit narrowing BLOCK_HTML would have gone green and the next
 * HTML-pasted post would have shipped exactly as the first one did.
 *
 * Each test plants the shape the gate must refuse and asserts it goes RED and
 * NAMES the post, and each was proven by weakening the gate and watching this
 * file fail. The gate takes --data, so every fixture is a two-row JSON file in a
 * temp directory: no repo state, no network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'validate-post-markdown.mjs');

/** A posts.json holding exactly the rows given, in a temp dir. */
function fixture(posts) {
  const root = mkdtempSync(join(tmpdir(), 'post-markdown-gate-'));
  const file = join(root, 'posts.json');
  writeFileSync(file, JSON.stringify(posts, null, 2));
  return { root, file };
}

function run(file) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [GATE, '--data', file], { encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const MARKDOWN = '## A heading\n\nSome **bold** prose with a [link](https://example.org/).\n';

test('a Markdown body passes', () => {
  const { root, file } = fixture([{ slug: 'clean', content: MARKDOWN }]);
  try {
    const r = run(file);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /all 1 commentary post bodies are Markdown/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a <p>-wrapped body fails and names the post', () => {
  // The 2026-07-10 shape exactly.
  const { root, file } = fixture([
    { slug: 'clean', content: MARKDOWN },
    { slug: 'pasted-as-html', content: '<p>Some prose that will render as literal tags.</p>' },
  ]);
  try {
    const r = run(file);
    assert.equal(r.code, 1, 'an HTML-pasted body must not pass');
    assert.match(r.out, /pasted-as-html/u, 'the operator cannot act on a failure that does not name the post');
    assert.match(r.out, /<p>/u, 'the offending tag is reported');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('every block-level tag in the list is actually caught', () => {
  // The list is the gate's whole substance. A narrowing edit that drops one tag
  // is the likeliest regression, and testing only <p> would not see it.
  const tags = ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote', 'section',
    'article', 'figure', 'figcaption', 'header', 'footer', 'main', 'aside', 'pre'];
  for (const tag of tags) {
    const { root, file } = fixture([{ slug: `has-${tag}`, content: `text <${tag}>x</${tag}> text` }]);
    try {
      const r = run(file);
      assert.equal(r.code, 1, `<${tag}> must be refused as block HTML`);
      assert.match(r.out, new RegExp(`has-${tag}`, 'u'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('an opening tag WITH attributes is caught, not just the bare tag', () => {
  // Real pasted HTML carries classes and styles. A pattern without [^>]* would
  // pass every realistic instance of the defect while passing the test above.
  const { root, file } = fixture([
    { slug: 'attrs', content: '<div class="wp-block-group" style="margin:0">prose</div>' },
  ]);
  try {
    assert.equal(run(file).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the tag match is case-insensitive, so pasted <P> or <DIV> is caught', () => {
  const { root, file } = fixture([{ slug: 'shouty', content: '<DIV>prose</DIV>' }]);
  try {
    assert.equal(run(file).code, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('inline HTML is tolerated by design and must NOT fail', () => {
  // Markdown allows raw inline HTML and these render correctly. If this test
  // ever goes red, the gate has been broadened into a false-positive machine
  // and will be bypassed, which is worse than not having it.
  const inline = ['br', 'sub', 'sup', 'em', 'strong', 'a href="https://example.org/"', 'code', 'mark', 'span'];
  for (const tag of inline) {
    const name = tag.split(' ')[0];
    const { root, file } = fixture([
      { slug: `inline-${name}`, content: `H<${tag}>2</${name}>O and a <br> break` },
    ]);
    try {
      const r = run(file);
      assert.equal(r.code, 0, `<${name}> is inline HTML and must be tolerated:\n${r.out}`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('a tag NAME that merely starts with a block tag is not a false positive', () => {
  // \b in the pattern is what stops <pre> matching <predicate> and <li>
  // matching <link>. Without it the inline test above would still pass while
  // ordinary custom elements started failing.
  const { root, file } = fixture([{ slug: 'custom', content: '<pill-badge>x</pill-badge> <tdata>y</tdata>' }]);
  try {
    const r = run(file);
    assert.equal(r.code, 0, `custom elements must not be read as block HTML:\n${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a row with no content, or non-string content, is skipped rather than crashing', () => {
  // posts.json is generated from D1 and a null body is a real possibility. A
  // crash here would read as a gate failure and send someone hunting for HTML
  // that does not exist.
  const { root, file } = fixture([
    { slug: 'nulled', content: null },
    { slug: 'missing' },
    { slug: 'numeric', content: 42 },
    { slug: 'fine', content: MARKDOWN },
  ]);
  try {
    const r = run(file);
    assert.equal(r.code, 0, r.out);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ALL offending posts are reported, not just the first', () => {
  // The loop must not break early: a partial list means a second pass is needed
  // to find the rest, and the second pass is the one nobody runs.
  const { root, file } = fixture([
    { slug: 'bad-one', content: '<p>a</p>' },
    { slug: 'bad-two', content: '<div>b</div>' },
    { slug: 'bad-three', content: '<h2>c</h2>' },
  ]);
  try {
    const r = run(file);
    assert.equal(r.code, 1);
    assert.match(r.out, /3 commentary post\(s\)/u);
    for (const s of ['bad-one', 'bad-two', 'bad-three']) assert.match(r.out, new RegExp(s, 'u'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a missing data file exits 2, distinct from a content failure', () => {
  // 2 means "I could not look", 1 means "I looked and it is wrong". Collapsing
  // them lets a bad path read as a clean repo, or as a real defect.
  const r = run(join(tmpdir(), 'definitely-absent-posts-file.json'));
  assert.equal(r.code, 2);
  assert.match(r.out, /Data file not found/u);
});

test('a posts.json wrapped as {posts:[...]} is read, not silently treated as empty', () => {
  // The CLI accepts three shapes. An unwrapping bug would make the gate scan
  // zero posts and print OK, which is the vacuous pass this harness exists to
  // make impossible.
  const root = mkdtempSync(join(tmpdir(), 'post-markdown-gate-'));
  const file = join(root, 'posts.json');
  try {
    writeFileSync(file, JSON.stringify({ posts: [{ slug: 'wrapped-bad', content: '<p>x</p>' }] }));
    const r = run(file);
    assert.equal(r.code, 1, `the {posts:[...]} shape must still be scanned:\n${r.out}`);
    assert.match(r.out, /wrapped-bad/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an EMPTY post set reports the count it actually scanned', () => {
  // Zero posts passing is correct, but the count must be visible: "all 0
  // bodies are Markdown" is the line that tells a reader the input was empty,
  // rather than leaving a green tick to imply the corpus was checked.
  const { root, file } = fixture([]);
  try {
    const r = run(file);
    assert.equal(r.code, 0);
    assert.match(r.out, /all 0 commentary post bodies/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
