/**
 * Falsification harness for compare-pillar-migration.mjs.
 *
 * The gate proves a pillar-page migration was ADDITIVE: moving markup from a
 * page file into a shared layout must not change the JSON-LD graph, the <head>,
 * the <title>, the <body> attributes, the byline DOM, or the page's guides.json
 * entry. It is the tool you reach for once, during a migration, when the thing
 * you are afraid of is a silent SEO regression that no page renders differently.
 *
 * Until 2026-09-18 it had no test. It is also the only one of this repo's gates
 * that takes its whole input as argv paths, so it is the cheapest to falsify:
 * two small HTML files in a temp directory, no repo state, no network, no root
 * override needed.
 *
 * Each test plants one non-additive change and asserts the gate goes RED and
 * names it. Two current behaviours are pinned rather than fixed and labelled as
 * such: the guides.json comparison silently skips unless all three of its flags
 * are present, and the success line claims guides.json was compared when only
 * one flag was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GATE = join(dirname(fileURLToPath(import.meta.url)), 'compare-pillar-migration.mjs');

/**
 * A minimal but realistic pillar page. Carries the four things the gate reads:
 * a JSON-LD @graph, a <head> with title/meta/link, <body> attributes, and an
 * author byline. Built as a function so each test can vary one part.
 */
function page({
  ldGraph = [
    { '@type': 'MedicalWebPage', '@id': 'https://rrmacademy.org/what-is-rrm/#page', headline: 'What is RRM' },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Guides' }] },
  ],
  title = 'What is Restorative Reproductive Medicine?',
  metas = ['<meta name="description" content="An introduction to RRM.">'],
  links = ['<link rel="canonical" href="https://rrmacademy.org/what-is-rrm/">'],
  bodyAttrs = 'data-track-scroll="true" class="guide"',
  byline = '<div class="author-byline"><span>Dr. Naomi Whittaker, MD</span><div>Reviewed</div></div>',
  cid = 'abc123',
} = {}) {
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': ldGraph })}</script>`;
  return `<!doctype html><html><head>
<title>${title}</title>
${metas.join('\n')}
${links.join('\n')}
${ld}
</head><body ${bodyAttrs} data-astro-cid-${cid}>
<h1 data-astro-cid-${cid}>Heading</h1>
${byline}
</body></html>`;
}

function fixture(preHtml, postHtml, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pillar-migration-gate-'));
  writeFileSync(join(root, 'pre.html'), preHtml);
  writeFileSync(join(root, 'post.html'), postHtml);
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(root, name), body);
  return root;
}

function run(root, args = ['pre.html', 'post.html']) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [GATE, ...args], { cwd: root, encoding: 'utf8' }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** Assert the gate refused, and refused for the reason we planted. */
function expectRed(root, pattern, args) {
  const r = run(root, args);
  assert.equal(r.code, 1, `expected NOT ADDITIVE:\n${r.out}`);
  assert.match(r.out, /NOT ADDITIVE/u);
  assert.match(r.out, pattern, `the failure must name the change; got:\n${r.out}`);
  return r;
}

test('an identical pre and post is additive', () => {
  const root = fixture(page(), page());
  try {
    const r = run(root);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /ADDITIVE: pre == post for all schema nodes, head, body, byline/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the Astro scope hash changing is NOT a change, which is the point of the gate', () => {
  // data-astro-cid-<hash> is stamped per component FILE, so moving byline
  // markup from a page into GuideLayout changes the hash legitimately on every
  // element. Without stripAstroCid the gate would fail every real migration and
  // be useless. This is the false-positive direction and it matters most here.
  const root = fixture(page({ cid: 'aaaaaa' }), page({ cid: 'zzzzzz' }));
  try {
    const r = run(root);
    assert.equal(r.code, 0, `a scope-hash change must be invisible:\n${r.out}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ADDING a JSON-LD node is additive and must pass', () => {
  // The gate is additive-ONLY by design: new schema is the expected outcome of
  // a migration. Pinned so nobody "tightens" it into an equality check.
  const extra = { '@type': 'FAQPage', '@id': 'https://rrmacademy.org/what-is-rrm/#faq' };
  const post = page({ ldGraph: [...JSON.parse(JSON.stringify([
    { '@type': 'MedicalWebPage', '@id': 'https://rrmacademy.org/what-is-rrm/#page', headline: 'What is RRM' },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Guides' }] },
  ])), extra] });
  const root = fixture(page(), post);
  try {
    assert.equal(run(root).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a REMOVED JSON-LD node fails and names it', () => {
  const post = page({ ldGraph: [{ '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Guides' }] }] });
  const root = fixture(page(), post);
  try {
    expectRed(root, /JSON-LD node removed: https:\/\/rrmacademy\.org\/what-is-rrm\/#page/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a CHANGED JSON-LD node fails, even by one field', () => {
  // The quiet SEO regression: the node is still there, so a presence check
  // would pass. canon() sorts keys deeply so field ORDER is not a change but
  // field VALUE is.
  const post = page({ ldGraph: [
    { '@type': 'MedicalWebPage', '@id': 'https://rrmacademy.org/what-is-rrm/#page', headline: 'What is RRM?' },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Guides' }] },
  ] });
  const root = fixture(page(), post);
  try {
    expectRed(root, /JSON-LD node changed: https:\/\/rrmacademy\.org\/what-is-rrm\/#page/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('key ORDER inside a JSON-LD node is not a change (canon sorts deeply)', () => {
  // A serializer reordering keys is not an SEO change, and failing on it would
  // make the gate fire on every framework upgrade.
  const root = fixture(
    page({ ldGraph: [{ '@type': 'MedicalWebPage', '@id': 'x#page', headline: 'H', description: 'D' },
      { '@type': 'BreadcrumbList' }] }),
    page({ ldGraph: [{ description: 'D', headline: 'H', '@id': 'x#page', '@type': 'MedicalWebPage' },
      { '@type': 'BreadcrumbList' }] }),
  );
  try {
    assert.equal(run(root).code, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BreadcrumbList is the one sanctioned page-to-layout move and is skipped', () => {
  // The single carve-out. Its breadcrumb may legitimately change shape when it
  // moves into the layout, so the gate skips comparing it -- but still requires
  // exactly one to exist afterwards.
  const post = page({ ldGraph: [
    { '@type': 'MedicalWebPage', '@id': 'https://rrmacademy.org/what-is-rrm/#page', headline: 'What is RRM' },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Different' }] },
  ] });
  const root = fixture(page(), post);
  try {
    assert.equal(run(root).code, 0, 'a changed BreadcrumbList is the sanctioned exception');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION the carve-out exists for: ZERO or TWO BreadcrumbLists fails', () => {
  // The carve-out is what makes a DUPLICATE breadcrumb the likeliest migration
  // defect: page and layout both emit one. Both directions asserted, because a
  // check that only counted "at least one" would miss the duplicate, and that
  // is the one that actually happens.
  const mwp = { '@type': 'MedicalWebPage', '@id': 'https://rrmacademy.org/what-is-rrm/#page', headline: 'What is RRM' };
  const bc = { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Guides' }] };

  const none = fixture(page(), page({ ldGraph: [mwp] }));
  try { expectRed(none, /expected exactly 1 BreadcrumbList post-migration, found 0/u); } finally { rmSync(none, { recursive: true, force: true }); }

  const two = fixture(page(), page({ ldGraph: [mwp, bc, { ...bc }] }));
  try { expectRed(two, /expected exactly 1 BreadcrumbList post-migration, found 2/u); } finally { rmSync(two, { recursive: true, force: true }); }
});

test('THE REGRESSION: a changed <title> fails and shows both values', () => {
  const root = fixture(page(), page({ title: 'What is RRM? A Guide' }));
  try {
    expectRed(root, /<title> changed: "What is Restorative Reproductive Medicine\?" -> "What is RRM\? A Guide"/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a dropped or added <meta> fails', () => {
  const dropped = fixture(page(), page({ metas: [] }));
  try { expectRed(dropped, /<head> <meta> set changed/u); } finally { rmSync(dropped, { recursive: true, force: true }); }

  const added = fixture(page(), page({ metas: [
    '<meta name="description" content="An introduction to RRM.">',
    '<meta name="robots" content="noindex">',
  ] }));
  try {
    // An ADDED meta is also a change here, deliberately: `noindex` arriving
    // during a migration is the worst case this gate exists to catch, and it
    // would be invisible to a removal-only check.
    expectRed(added, /<head> <meta> set changed/u);
  } finally { rmSync(added, { recursive: true, force: true }); }
});

test('THE REGRESSION: a changed canonical <link> fails', () => {
  const root = fixture(page(), page({ links: ['<link rel="canonical" href="https://rrmacademy.org/rrm/">'] }));
  try { expectRed(root, /<head> <link> set changed/u); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('meta and link ORDER is not a change, only the set', () => {
  // extractHead sorts both lists. A reorder is not an SEO change and failing
  // on it would make the gate unusable.
  const m = ['<meta name="description" content="D">', '<meta name="author" content="A">'];
  const root = fixture(page({ metas: m }), page({ metas: [...m].reverse() }));
  try { assert.equal(run(root).code, 0); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('whitespace inside a head tag is normalised, not read as a change', () => {
  const root = fixture(
    page({ metas: ['<meta name="description" content="D">'] }),
    page({ metas: ['<meta    name="description"\n   content="D">'] }),
  );
  try { assert.equal(run(root).code, 0); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a lost <body> attribute fails', () => {
  // data-track-scroll disappearing silently turns off analytics on the page
  // with nothing rendering differently. This is the check for it.
  const root = fixture(page(), page({ bodyAttrs: 'class="guide"' }));
  try { expectRed(root, /<body> attribute set changed/u); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a changed byline DOM fails', () => {
  const root = fixture(page(), page({ byline: '<div class="author-byline"><span>N. Whittaker</span><div>Reviewed</div></div>' }));
  try { expectRed(root, /byline DOM changed/u); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a byline that DISAPPEARS fails rather than comparing empty to empty', () => {
  // extractByline returns '' when the block is absent. If the pre page has one
  // and the post does not, '' !== the markup, so it fails -- but the reverse
  // (neither page has one) compares '' to '' and passes, which is correct and
  // worth pinning so the empty case is not read as coverage.
  const lost = fixture(page(), page({ byline: '' }));
  try { expectRed(lost, /byline DOM changed/u); } finally { rmSync(lost, { recursive: true, force: true }); }

  const neither = fixture(page({ byline: '' }), page({ byline: '' }));
  try {
    assert.equal(run(neither).code, 0,
      'two pages with no byline agree; a green run here does NOT mean a byline was checked');
  } finally { rmSync(neither, { recursive: true, force: true }); }
});

test('malformed JSON-LD is skipped rather than crashing the run', () => {
  // extractLdJson try/catches each block. A crash here would read as a
  // migration failure and send someone hunting a schema diff that does not
  // exist. Both sides carry the same broken block, so the run is clean.
  const broken = '<script type="application/ld+json">{ not json at all }</script>';
  const pre = page().replace('</head>', `${broken}</head>`);
  const post = page().replace('</head>', `${broken}</head>`);
  const root = fixture(pre, post);
  try { assert.equal(run(root).code, 0, run(root).out); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a bare @type node with no @id is still matched by type and headline', () => {
  // nodeKey falls back to `<type>::<headline|name>` when there is no @id, so
  // nodes without ids are still tracked. Without that fallback every such node
  // would key identically and removals would go unnoticed.
  const pre = page({ ldGraph: [{ '@type': 'Article', headline: 'One' }, { '@type': 'Article', headline: 'Two' }, { '@type': 'BreadcrumbList' }] });
  const post = page({ ldGraph: [{ '@type': 'Article', headline: 'One' }, { '@type': 'BreadcrumbList' }] });
  const root = fixture(pre, post);
  try { expectRed(root, /JSON-LD node removed: Article::Two/u); } finally { rmSync(root, { recursive: true, force: true }); }
});

// ---- the guides.json leg ---------------------------------------------------

const GUIDES = (title, description) => JSON.stringify([{ slug: 'what-is-rrm', title, description }]);

test('the guides.json leg compares title and description when all three flags are given', () => {
  const root = fixture(page(), page(), {
    'g0.json': GUIDES('What is RRM', 'Intro'),
    'g1.json': GUIDES('What is RRM', 'Intro'),
  });
  try {
    const r = run(root, ['pre.html', 'post.html', '--slug', 'what-is-rrm', '--guides-pre', 'g0.json', '--guides-post', 'g1.json']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /, guides\.json/u, 'the success line states guides.json was compared');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a changed guides.json title fails', () => {
  const root = fixture(page(), page(), {
    'g0.json': GUIDES('What is RRM', 'Intro'),
    'g1.json': GUIDES('What is RRM?', 'Intro'),
  });
  try {
    expectRed(root, /guides\.json title changed: "What is RRM" -> "What is RRM\?"/u,
      ['pre.html', 'post.html', '--slug', 'what-is-rrm', '--guides-pre', 'g0.json', '--guides-post', 'g1.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a changed guides.json description fails', () => {
  const root = fixture(page(), page(), {
    'g0.json': GUIDES('What is RRM', 'Intro'),
    'g1.json': GUIDES('What is RRM', 'A longer intro'),
  });
  try {
    expectRed(root, /guides\.json description changed/u,
      ['pre.html', 'post.html', '--slug', 'what-is-rrm', '--guides-pre', 'g0.json', '--guides-post', 'g1.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a slug missing from either guides file fails rather than comparing undefined', () => {
  const root = fixture(page(), page(), {
    'g0.json': GUIDES('What is RRM', 'Intro'),
    'g1.json': JSON.stringify([{ slug: 'something-else', title: 'X', description: 'Y' }]),
  });
  try {
    expectRed(root, /guides\.json entry for what-is-rrm missing in pre or post/u,
      ['pre.html', 'post.html', '--slug', 'what-is-rrm', '--guides-pre', 'g0.json', '--guides-post', 'g1.json']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: a PARTIAL flag set is refused, not silently skipped', () => {
  // This test used to assert the opposite. The guides leg ran only when all
  // three of gi/gj/si were present, and a partial set -- the easiest possible
  // typo, and the shape a half-remembered command line takes -- skipped the
  // whole comparison with no warning and exit 0. The guides files below have
  // DIFFERENT titles, which the tests above prove is a failure when all three
  // flags are given, so every one of these invocations was silently passing a
  // real regression. Fixed 2026-09-18 to exit 2.
  const root = fixture(page(), page(), {
    'g0.json': GUIDES('What is RRM', 'Intro'),
    'g1.json': GUIDES('COMPLETELY DIFFERENT', 'Also different'),
  });
  try {
    for (const [args, missing] of [
      [['pre.html', 'post.html', '--guides-pre', 'g0.json', '--guides-post', 'g1.json'], '--slug'],
      [['pre.html', 'post.html', '--slug', 'what-is-rrm', '--guides-pre', 'g0.json'], '--guides-post'],
      [['pre.html', 'post.html', '--slug', 'what-is-rrm', '--guides-post', 'g1.json'], '--guides-pre'],
    ]) {
      const r = run(root, args);
      assert.equal(r.code, 2, `a partial set must be refused, not skipped. args: ${args.join(' ')}\n${r.out}`);
      assert.match(r.out, /REFUSING: the guides\.json comparison needs/u);
      assert.match(r.out, new RegExp(`missing: .*${missing}`, 'u'),
        'the refusal must name which flag is missing, or it is a riddle');
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('exit 2 for a refusal is distinct from exit 1 for a real finding', () => {
  // A refusal collapsed into exit 1 would read as a non-additive migration and
  // send someone hunting a schema diff that does not exist; collapsed into 0
  // it is the original bug. Both neighbours asserted.
  const root = fixture(page(), page({ title: 'Changed' }), { 'g0.json': GUIDES('A', 'B') });
  try {
    assert.equal(run(root, ['pre.html', 'post.html']).code, 1, 'a real change is still exit 1');
    assert.equal(run(root, ['pre.html', 'post.html', '--guides-pre', 'g0.json']).code, 2,
      'a refusal outranks the finding, because the run was not the run that was asked for');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('THE REGRESSION: the success line no longer claims guides.json it did not read', () => {
  // The success message used to append ", guides.json" whenever --guides-pre
  // was present, regardless of whether the comparison ran. Combined with the
  // silent skip above, a command missing --slug printed
  //     ADDITIVE: … head, body, byline, guides.json
  // while guides.json was never opened. The operator's only evidence that the
  // check ran was the sentence saying it ran. The suffix is now gated on the
  // same condition as the check.
  //
  // HONEST NOTE ON THIS TEST'S TEETH, measured rather than assumed. With the
  // refusal in place, `gi > -1` and `checkGuides` are equivalent at every
  // point the success line is reachable, so the suffix fix has NO independent
  // tooth: reverting it alone turns nothing red here, and reverting it
  // together with the refusal turns only the two refusal tests red. It is
  // belt-and-braces behind the refusal, kept because the two conditions
  // drifting apart again is exactly how the false claim arose.
  //
  // What this test does pin is that the claim is truthful in both reachable
  // states: no flags means no claim, all three means a true claim.
  const root = fixture(page(), page(), {
    'g0.json': GUIDES('What is RRM', 'Intro'),
    'g1.json': GUIDES('What is RRM', 'Intro'),
  });
  try {
    const none = run(root, ['pre.html', 'post.html']);
    assert.equal(none.code, 0);
    assert.doesNotMatch(none.out, /guides\.json/u, 'no flags, no claim');

    const all = run(root, ['pre.html', 'post.html', '--slug', 'what-is-rrm', '--guides-pre', 'g0.json', '--guides-post', 'g1.json']);
    assert.equal(all.code, 0);
    assert.match(all.out, /, guides\.json/u, 'all three flags, and the claim is now earned');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ALL issues are reported together, not one per run', () => {
  // A migration usually breaks several things at once. Reporting one at a time
  // turns a five-minute fix into five runs.
  const root = fixture(page(), page({
    title: 'Changed', metas: [], bodyAttrs: 'class="guide"',
    byline: '<div class="author-byline"><span>Other</span><div>x</div></div>',
  }));
  try {
    const r = run(root);
    assert.equal(r.code, 1);
    assert.match(r.out, /NOT ADDITIVE \(4\)/u, 'four independent changes, four issues');
    for (const p of [/<title> changed/u, /<meta> set changed/u, /<body> attribute set changed/u, /byline DOM changed/u]) {
      assert.match(r.out, p);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
