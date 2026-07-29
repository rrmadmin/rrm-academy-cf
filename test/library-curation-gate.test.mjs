/**
 * scripts/gates/verify-library-curation.mjs -- the build-output proof gate that
 * decides whether the library render surface is allowed to ship.
 *
 * It was at 0%. That is the worst place for a zero: a gate that silently stops
 * catching things is indistinguishable from a clean build. Its three real jobs
 * are (a) exactly the browsable category pages exist, (b) no article the corpus
 * marks hostile/critical is linked from a category page, and (c) demoted slugs
 * are gone from the pages and the schemamap. If (b) stops firing, anti-RRM
 * research starts appearing on RRM Academy's own topic pages and nothing says so.
 *
 * HOW IT IS EXERCISED
 * The gate reads `dist/...` and `src/data/articles.json` through CWD-RELATIVE
 * paths, so each case builds a throwaway dist tree in a temp directory and runs
 * the real script there as a subprocess. No production change, no fixture
 * indirection: the file under test is the file that runs in CI.
 *
 * WHAT THIS CANNOT DISTINGUISH
 *  - Whether Astro actually emits the pages this fixture fakes. The temp tree is
 *    hand-built, so the gate's INPUT contract (a dist directory of category
 *    pages) is asserted, not the build that produces it. `npm run build` is the
 *    instrument for that.
 *  - The real `sentiment` values in D1. Articles here are fixtures; what is
 *    proven is that hostile/critical is the flagged set and that the match is on
 *    the full `/library/<slug>/` href, not a prefix.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CATEGORIES, DEMOTED_SLUGS, topicSlug } from '../src/data/library-topics.ts';

const REPO = resolve(import.meta.dirname, '..');
const GATE = join(REPO, 'scripts/gates/verify-library-curation.mjs');
const BROWSABLE = CATEGORIES.filter((c) => c.browsable).map((c) => topicSlug(c.label));

const HERO = '<h1>Library</h1><p>Search 1,234 academic scholarly works.</p>';

/**
 * Builds a dist tree in a temp cwd and runs the gate there.
 * @param {object} opts
 * @param {string[]} [opts.pages]   category slugs to emit under dist/library/topics
 * @param {Record<string,string>} [opts.pageHtml] per-slug body override
 * @param {Array<object>} [opts.articles] contents of src/data/articles.json
 * @param {string|null} [opts.index] dist/library/index.html body (null = do not write)
 * @param {string} [opts.schemamap] dist/schemamap.xml body (absent = do not write)
 */
function runGate({ pages = BROWSABLE, pageHtml = {}, articles = [], index = HERO, schemamap } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'library-curation-'));
  try {
    mkdirSync(join(dir, 'src/data'), { recursive: true });
    writeFileSync(join(dir, 'src/data/articles.json'), JSON.stringify(articles));
    for (const slug of pages) {
      mkdirSync(join(dir, 'dist/library/topics', slug), { recursive: true });
      writeFileSync(join(dir, 'dist/library/topics', slug, 'index.html'), pageHtml[slug] ?? '<ul></ul>');
    }
    mkdirSync(join(dir, 'dist/library'), { recursive: true });
    if (index !== null) writeFileSync(join(dir, 'dist/library/index.html'), index);
    if (schemamap !== undefined) writeFileSync(join(dir, 'dist/schemamap.xml'), schemamap);

    const r = spawnSync(process.execPath, ['--experimental-strip-types', GATE], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const card = (slug) => `<a class="article-card" href="/library/${slug}/">x</a>`;

describe('verify-library-curation gate -- happy path', () => {
  it('passes on a clean build and reports the page count it saw', () => {
    const r = runGate();
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /library-curation gate: PASS/);
    assert.match(r.out, new RegExp(`category pages: ${BROWSABLE.length} \\(expected ${BROWSABLE.length}\\)`));
  });

  it('passes when supportive articles are linked from category pages', () => {
    const r = runGate({
      articles: [{ slug: 'excision-outcomes', sentiment: 'supportive' }],
      pageHtml: { [BROWSABLE[0]]: card('excision-outcomes') },
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /anti-RRM slugs checked \(0\)/);
  });
});

describe('verify-library-curation gate -- page inventory', () => {
  it('fails when a browsable category page is missing', () => {
    const r = runGate({ pages: BROWSABLE.slice(1) });
    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`missing category page: ${BROWSABLE[0]}`));
    assert.match(r.out, /library-curation gate: FAILED/);
  });

  it('fails when an unexpected category page is present', () => {
    const r = runGate({ pages: [...BROWSABLE, 'not-a-category'] });
    assert.equal(r.code, 1);
    assert.match(r.out, /unexpected category page present: not-a-category/);
  });

  it('fails when a demoted slug still has a page', () => {
    const demoted = DEMOTED_SLUGS[0];
    const r = runGate({ pages: [...BROWSABLE, demoted] });
    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`demoted slug still has a page: ${demoted}`));
  });

  it('fails when the whole topics directory is absent, rather than passing vacuously', () => {
    const r = runGate({ pages: [] });
    assert.equal(r.code, 1);
    assert.match(r.out, /missing category page/);
    assert.match(r.out, /category pages: 0/);
  });
});

describe('verify-library-curation gate -- anti-RRM leak detection', () => {
  it('fails when a hostile article is linked from a category page', () => {
    const r = runGate({
      articles: [{ slug: 'ivf-is-the-only-way', sentiment: 'hostile' }],
      pageHtml: { [BROWSABLE[0]]: card('ivf-is-the-only-way') },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /anti-RRM slug "ivf-is-the-only-way" leaked/);
  });

  it('treats critical the same as hostile, and is case-insensitive about it', () => {
    const r = runGate({
      articles: [{ slug: 'a-critical-review', sentiment: 'CRITICAL' }],
      pageHtml: { [BROWSABLE[1]]: card('a-critical-review') },
    });
    assert.equal(r.code, 1);
    assert.match(r.out, /a-critical-review/);
  });

  it('does not flag a supportive rebuttal whose slug is a prefix of a flagged one', () => {
    // The href match is on the FULL `/library/<slug>/`, so `napro-critique` must
    // not trip on `napro-critique-rebuttal` being present.
    const r = runGate({
      articles: [
        { slug: 'napro-critique', sentiment: 'hostile' },
        { slug: 'napro-critique-rebuttal', sentiment: 'supportive' },
      ],
      pageHtml: { [BROWSABLE[0]]: card('napro-critique-rebuttal') },
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /anti-RRM slugs checked \(1\).*: 0 leaks/s);
  });

  it('reports every page a flagged slug leaked onto, not just the first', () => {
    const r = runGate({
      articles: [{ slug: 'bad-one', sentiment: 'hostile' }],
      pageHtml: { [BROWSABLE[0]]: card('bad-one'), [BROWSABLE[2]]: card('bad-one') },
    });
    assert.equal(r.code, 1);
    assert.equal((r.out.match(/leaked onto/g) || []).length, 2);
    assert.match(r.out, /: 2 leaks/);
  });

  it('ignores articles with no sentiment and articles with no slug', () => {
    const r = runGate({
      articles: [{ slug: 'unscored' }, { sentiment: 'hostile' }, { slug: null, sentiment: 'hostile' }],
      pageHtml: { [BROWSABLE[0]]: card('unscored') },
    });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /anti-RRM slugs checked \(0\)/);
  });

  it('accepts the wrapped {results:[...]} shape the worker returns', () => {
    const r = runGate({
      articles: { results: [{ slug: 'bad-one', sentiment: 'hostile' }] },
      pageHtml: { [BROWSABLE[0]]: card('bad-one') },
    });
    assert.equal(r.code, 1, 'the results[] envelope was not unwrapped');
    assert.match(r.out, /bad-one/);
  });
});

describe('verify-library-curation gate -- schemamap and hero', () => {
  it('fails when the schemamap still lists a demoted topic', () => {
    const demoted = DEMOTED_SLUGS[0];
    const r = runGate({ schemamap: `<urlset><url><loc>https://rrmacademy.org/library/topics/${demoted}/</loc></url></urlset>` });
    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`schemamap still lists demoted ${demoted}`));
  });

  it('passes when the schemamap lists only browsable topics', () => {
    const r = runGate({ schemamap: `<urlset><url><loc>https://rrmacademy.org/library/topics/${BROWSABLE[0]}/</loc></url></urlset>` });
    assert.equal(r.code, 0, r.out);
  });

  it('skips the schemamap check when the file was not built', () => {
    const r = runGate();
    assert.equal(r.code, 0, r.out);
    assert.ok(!/schemamap/.test(r.out));
  });

  it('fails when the index hero corpus-count text is gone', () => {
    const r = runGate({ index: '<h1>Library</h1><p>Browse the collection.</p>' });
    assert.equal(r.code, 1);
    assert.match(r.out, /index hero corpus-count text missing/);
  });

  it('CRASHES rather than failing cleanly when dist/library/index.html is absent', () => {
    // Documented, not endorsed: step 4 readFileSync's the index unconditionally,
    // so a build that never emitted it throws ENOENT out of the gate instead of
    // printing "FAIL:". CI still blocks (non-zero exit), but the operator gets a
    // stack trace rather than the gate's own diagnosis. Asserting the real
    // behaviour keeps this from being quietly "fixed" into a silent pass.
    const r = runGate({ index: null });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /ENOENT/);
    assert.ok(!/library-curation gate: (PASS|FAILED)/.test(r.out), 'the gate reached its own verdict line');
  });
});
