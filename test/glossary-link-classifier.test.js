/**
 * Tests for scripts/lib/glossary-link-classifier.mjs
 * Run with: node --test test/glossary-link-classifier.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { classifyAnchor, hasClassToken } from '../scripts/lib/glossary-link-classifier.mjs';

const KNOWN_SLUGS = new Set(['endometriosis', 'progesterone', 'pcos', 'asherman-s-syndrome']);
const SECTION_IDS = new Set([
  'overview','core-rrm-principles','fertility-awareness','clinical-approaches',
  'diagnostic-tools','surgical-techniques','conditions','overlapping-disciplines',
  'broader-framework','abbreviations','references',
]);

function classifyFirst(html) {
  const root = parse(html);
  const a = root.querySelector('a');
  return classifyAnchor({
    attrs: Object.fromEntries(a.rawAttributes ? Object.entries(a.rawAttributes) : []),
    href: a.getAttribute('href'),
    classList: (a.getAttribute('class') || '').split(/\s+/).filter(Boolean),
    parentTagName: a.parentNode && a.parentNode.tagName ? a.parentNode.tagName.toLowerCase() : null,
    parentClassList: a.parentNode && a.parentNode.getAttribute
      ? (a.parentNode.getAttribute('class') || '').split(/\s+/).filter(Boolean)
      : [],
    knownTermSlugs: KNOWN_SLUGS,
    sectionIds: SECTION_IDS,
  });
}

describe('hasClassToken (word-boundary)', () => {
  it('matches exact token', () => assert.equal(hasClassToken(['gloss-xref'], 'gloss-xref'), true));
  it('matches token among others', () => assert.equal(hasClassToken(['foo','gloss-xref','bar'], 'gloss-xref'), true));
  it('does not match substring', () => assert.equal(hasClassToken(['my-gloss-xref-fake'], 'gloss-xref'), false));
  it('does not match suffix', () => assert.equal(hasClassToken(['gloss-xref-extended'], 'gloss-xref'), false));
  it('handles empty list', () => assert.equal(hasClassToken([], 'gloss-xref'), false));
});

describe('classifyAnchor — noop variants', () => {
  it('in-page anchor with gloss-xref already', () => {
    assert.equal(classifyFirst('<a class="gloss-xref" href="#endometriosis">e</a>'), 'noop');
  });
  it('citation already in <sup class="cite-ref">', () => {
    assert.equal(classifyFirst('<sup class="cite-ref"><a href="#ref-1">1</a></sup>'), 'noop');
  });
});

describe('classifyAnchor — add-gloss-xref', () => {
  it('bare in-page anchor to a known term', () => {
    assert.equal(classifyFirst('<a href="#endometriosis">e</a>'), 'add-gloss-xref');
  });
  it('case-mismatched (NOCASE) target still resolves', () => {
    assert.equal(classifyFirst('<a href="#PROgesterone">p</a>'), 'add-gloss-xref');
  });
  it('anchor with unrelated existing class', () => {
    assert.equal(classifyFirst('<a class="emphasis" href="#endometriosis">e</a>'), 'add-gloss-xref');
  });
  it('does NOT match substring-class false-positive', () => {
    assert.equal(classifyFirst('<a class="my-gloss-xref-fake" href="#endometriosis">e</a>'), 'add-gloss-xref');
  });
});

describe('classifyAnchor — citation transforms', () => {
  it('add-cite-ref-class-to-sup when parent is bare <sup>', () => {
    assert.equal(classifyFirst('<sup><a href="#ref-7">7</a></sup>'), 'add-cite-ref-class-to-sup');
  });
  it('add-cite-ref-class-to-sup when parent <sup> has other class', () => {
    assert.equal(classifyFirst('<sup class="emphasis"><a href="#ref-7">7</a></sup>'), 'add-cite-ref-class-to-sup');
  });
  it('wrap-cite-ref when no <sup> parent', () => {
    assert.equal(classifyFirst('<p><a href="#ref-7">7</a></p>'), 'wrap-cite-ref');
  });
});

describe('classifyAnchor — manual-review', () => {
  it('section anchor', () => {
    assert.equal(classifyFirst('<a href="#references">refs</a>'), 'manual-review:section-anchor');
  });
  it('part section anchor', () => {
    assert.equal(classifyFirst('<a href="#core-rrm-principles">part 1</a>'), 'manual-review:section-anchor');
  });
  it('broken target', () => {
    assert.equal(classifyFirst('<a href="#nonexistent-term">x</a>'), 'manual-review:broken-target');
  });
  it('multi-cite comma form', () => {
    assert.equal(classifyFirst('<a href="#ref-7,8">7,8</a>'), 'manual-review:multi-cite');
  });
  it('zero-padded ref', () => {
    assert.equal(classifyFirst('<a href="#ref-007">7</a>'), 'manual-review:zero-padded');
  });
  it('non-canonical #cite-N form', () => {
    assert.equal(classifyFirst('<a href="#cite-3">3</a>'), 'manual-review:non-canonical-citation');
  });
  it('empty href', () => {
    assert.equal(classifyFirst('<a href="">x</a>'), 'manual-review:malformed-href');
  });
  it('hash-only href', () => {
    assert.equal(classifyFirst('<a href="#">x</a>'), 'manual-review:malformed-href');
  });
  it('javascript: href', () => {
    assert.equal(classifyFirst('<a href="javascript:alert(1)">x</a>'), 'manual-review:malformed-href');
  });
  it('href with query string', () => {
    assert.equal(classifyFirst('<a href="#term?param=1">x</a>'), 'manual-review:malformed-href');
  });
});

describe('classifyAnchor — pass-through variants', () => {
  it('mailto', () => {
    assert.equal(classifyFirst('<a href="mailto:foo@bar.com">contact</a>'), 'mailto-or-tel');
  });
  it('tel', () => {
    assert.equal(classifyFirst('<a href="tel:+15551234567">call</a>'), 'mailto-or-tel');
  });
  it('external https', () => {
    assert.equal(classifyFirst('<a href="https://pubmed.ncbi.nlm.nih.gov/12345/">pubmed</a>'), 'external');
  });
  it('external http', () => {
    assert.equal(classifyFirst('<a href="http://example.com/">e</a>'), 'external');
  });
  it('pillar / on-site', () => {
    assert.equal(classifyFirst('<a href="/what-is-rrm/">RRM</a>'), 'pillar-or-onsite');
  });
});

import { spawnSync } from 'node:child_process';

describe('audit-glossary-links smoke', () => {
  it('runs against current src/data/glossary.json without error', () => {
    const r = spawnSync('node', ['scripts/audit-glossary-links.mjs'], { encoding: 'utf-8' });
    assert.equal(r.status, 0);
    const report = JSON.parse(r.stdout);
    assert.ok(typeof report.actionCounts === 'object');
    assert.ok(typeof report.termCount === 'number');
    assert.ok(report.termCount > 100);
  });
});

import { applyTransforms } from '../scripts/lib/glossary-link-transforms.mjs';

describe('applyTransforms — add-gloss-xref', () => {
  it('adds gloss-xref to bare anchor', () => {
    const out = applyTransforms('<p><a href="#endometriosis">e</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /class="gloss-xref"/);
  });
  it('adds gloss-xref alongside existing class', () => {
    const out = applyTransforms('<p><a class="emphasis" href="#endometriosis">e</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /class="emphasis gloss-xref"|class="gloss-xref emphasis"/);
  });
  it('is idempotent', () => {
    const once = applyTransforms('<p><a href="#endometriosis">e</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    const twice = applyTransforms(once, {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.equal(once, twice);
  });
});

describe('applyTransforms — citation', () => {
  it('adds cite-ref to bare <sup>', () => {
    const out = applyTransforms('<p><sup><a href="#ref-7">7</a></sup></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /<sup class="cite-ref">/);
  });
  it('adds cite-ref alongside existing class', () => {
    const out = applyTransforms('<p><sup class="emphasis"><a href="#ref-7">7</a></sup></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /class="emphasis cite-ref"|class="cite-ref emphasis"/);
  });
  it('wraps bare <a> when no <sup>', () => {
    const out = applyTransforms('<p><a href="#ref-7">7</a></p>', {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /<sup class="cite-ref"><a href="#ref-7">7<\/a><\/sup>/);
  });
});

describe('applyTransforms — manual-review skip', () => {
  it('does not transform terms with manual-review anchors', () => {
    const input = '<p><a href="#nonexistent">x</a></p>';
    const out = applyTransforms(input, {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    // applyTransforms returns null so caller knows to skip.
    assert.equal(out, null);
  });
});

describe('applyTransforms — preserves non-anchor content', () => {
  it('keeps <strong>, text, <p> intact', () => {
    const input = '<p><strong>Bold</strong> text and <a href="#endometriosis">e</a></p>';
    const out = applyTransforms(input, {
      knownTermSlugs: KNOWN_SLUGS, sectionIds: SECTION_IDS,
    });
    assert.match(out, /<strong>Bold<\/strong>/);
    assert.match(out, /text and/);
  });
});
