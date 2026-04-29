/**
 * Phase 2 schema-builder tests.
 *
 * Exercises the pure-JS builders in src/lib/schema-builders.mjs. The
 * SSOT-dependent builders in identity.ts (buildArticle, buildMedicalWebPage,
 * buildCourse) are not covered here; they need the build-time snapshot which
 * isn't present at `node --test` time. Phase 4-7's smoke tests cover them via
 * the actual `npm run build` output.
 *
 * Run: node --test test/schema-builders.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSpeakable,
  buildFAQPage,
  buildBreadcrumbList,
  buildScholarlyArticleStub,
  buildMedicalScholarlyArticle,
  orcidUrlLib,
  nameKeyLib,
  cleanAffiliationNameLib,
  dedupeAuthorRecordsLib,
  AUTHOR_CAP_LIB,
} from '../src/lib/schema-builders.mjs';

describe('buildSpeakable', () => {
  it('emits CSS selectors when present', () => {
    const out = buildSpeakable({ cssSelectors: ['.lead', 'h1'] });
    assert.equal(out['@type'], 'SpeakableSpecification');
    assert.deepEqual(out.cssSelector, ['.lead', 'h1']);
    assert.equal(out.xpath, undefined);
  });

  it('emits xpath when present', () => {
    const out = buildSpeakable({ xpath: ['//h1', '//p[1]'] });
    assert.deepEqual(out.xpath, ['//h1', '//p[1]']);
    assert.equal(out.cssSelector, undefined);
  });

  it('returns null when both arrays empty', () => {
    assert.equal(buildSpeakable({}), null);
    assert.equal(buildSpeakable({ cssSelectors: [], xpath: [] }), null);
    assert.equal(buildSpeakable(), null);
  });

  it('strips falsy entries', () => {
    const out = buildSpeakable({ cssSelectors: ['.lead', '', null, '.body'].filter(Boolean) });
    assert.deepEqual(out.cssSelector, ['.lead', '.body']);
  });
});

describe('buildFAQPage', () => {
  it('emits Question + acceptedAnswer pairs', () => {
    const out = buildFAQPage([
      { question: 'What is RRM?', answer: 'Restorative Reproductive Medicine.' },
      { question: 'Who founded it?', answer: 'Dr. Naomi Whittaker.' },
    ]);
    assert.equal(out['@type'], 'FAQPage');
    assert.equal(out.mainEntity.length, 2);
    assert.equal(out.mainEntity[0]['@type'], 'Question');
    assert.equal(out.mainEntity[0].name, 'What is RRM?');
    assert.equal(out.mainEntity[0].acceptedAnswer['@type'], 'Answer');
    assert.equal(out.mainEntity[0].acceptedAnswer.text, 'Restorative Reproductive Medicine.');
  });

  it('strips empty / partial entries', () => {
    const out = buildFAQPage([
      { question: 'Valid?', answer: 'Yes.' },
      { question: '', answer: 'No question' },
      { question: 'No answer', answer: '' },
      null,
    ]);
    assert.equal(out.mainEntity.length, 1);
  });

  it('handles empty input', () => {
    const out = buildFAQPage([]);
    assert.deepEqual(out.mainEntity, []);
  });
});

describe('buildBreadcrumbList', () => {
  it('emits 1-indexed ListItems', () => {
    const out = buildBreadcrumbList([
      { name: 'Home', url: 'https://rrmacademy.org/' },
      { name: 'Library', url: 'https://rrmacademy.org/library/' },
      { name: 'Article', url: 'https://rrmacademy.org/library/foo/' },
    ]);
    assert.equal(out['@type'], 'BreadcrumbList');
    assert.equal(out.itemListElement.length, 3);
    assert.equal(out.itemListElement[0].position, 1);
    assert.equal(out.itemListElement[2].position, 3);
    assert.equal(out.itemListElement[0].name, 'Home');
    assert.equal(out.itemListElement[2].item, 'https://rrmacademy.org/library/foo/');
  });

  it('handles empty input', () => {
    const out = buildBreadcrumbList([]);
    assert.deepEqual(out.itemListElement, []);
  });
});

describe('buildScholarlyArticleStub', () => {
  it('emits minimal ScholarlyArticle', () => {
    const out = buildScholarlyArticleStub({
      name: 'Endometriosis prevalence study',
      author: 'D\'Hooghe',
      datePublished: '2003',
      journal: 'Fertility and Sterility',
    });
    assert.equal(out['@type'], 'ScholarlyArticle');
    assert.equal(out.author.name, 'D\'Hooghe');
    assert.equal(out.isPartOf.name, 'Fertility and Sterility');
  });

  it('omits isPartOf when journal missing', () => {
    const out = buildScholarlyArticleStub({
      name: 'Foo',
      author: 'Bar',
      datePublished: '2020',
    });
    assert.equal(out.isPartOf, undefined);
  });
});

// =============================================================================
// MedicalScholarlyArticle helper coverage
// =============================================================================

describe('orcidUrlLib', () => {
  it('builds canonical orcid URL', () => {
    assert.equal(orcidUrlLib('0000-0002-1825-0097'), 'https://orcid.org/0000-0002-1825-0097');
  });
  it('uppercases trailing X', () => {
    assert.equal(orcidUrlLib('0000-0001-5109-372x'), 'https://orcid.org/0000-0001-5109-372X');
  });
  it('returns null on invalid format', () => {
    assert.equal(orcidUrlLib('1234'), null);
    assert.equal(orcidUrlLib(''), null);
    assert.equal(orcidUrlLib(null), null);
    assert.equal(orcidUrlLib(undefined), null);
  });
});

describe('nameKeyLib', () => {
  it('collapses tolerant of middle initials', () => {
    assert.equal(nameKeyLib('Lauren A Wise'), nameKeyLib('Lauren Wise'));
    assert.equal(nameKeyLib('Lauren A. Wise'), nameKeyLib('Lauren Wise'));
  });
  it('lowercases and strips diacritics', () => {
    assert.equal(nameKeyLib('NAOMI Whittaker'), 'whittaker n');
  });
  it('handles single-name', () => {
    assert.equal(nameKeyLib('Hippocrates'), 'hippocrates');
  });
});

describe('cleanAffiliationNameLib', () => {
  it("strips Authors' Affiliations: prefix", () => {
    assert.equal(
      cleanAffiliationNameLib("Authors' Affiliations: Slone Epidemiology Center"),
      'Slone Epidemiology Center'
    );
  });
  it('strips leading numeric prefix', () => {
    assert.equal(cleanAffiliationNameLib('1Slone Epi Center'), 'Slone Epi Center');
    assert.equal(cleanAffiliationNameLib('2 Lombardi Center'), 'Lombardi Center');
  });
  it('caps long names at ~200 chars with ellipsis', () => {
    const long = 'X'.repeat(300);
    const out = cleanAffiliationNameLib(long);
    assert.ok(out.length <= 200);
    assert.ok(out.endsWith('...'));
  });
});

describe('dedupeAuthorRecordsLib', () => {
  it('collapses by ORCID, prefers richer record', () => {
    const records = [
      { orcid: '0000-0002-1825-0097', full_name: 'Jane Doe' },
      { orcid: '0000-0002-1825-0097', full_name: 'Jane Doe', primary_ror_id: 'https://ror.org/123', primary_institution_name: 'Foo U' },
    ];
    const out = dedupeAuthorRecordsLib(records);
    assert.equal(out.length, 1);
    assert.equal(out[0].primary_institution_name, 'Foo U');
  });

  it('drops no-orcid entry whose nameKey matches an orcid-bearing record', () => {
    const records = [
      { orcid: '0000-0002-1825-0097', full_name: 'Lauren A Wise', primary_institution_name: 'Boston U' },
      { full_name: 'Lauren Wise' },
    ];
    const out = dedupeAuthorRecordsLib(records);
    assert.equal(out.length, 1);
    assert.equal(out[0].orcid, '0000-0002-1825-0097');
  });
});

describe('buildMedicalScholarlyArticle (smoke)', () => {
  it('emits MedicalScholarlyArticle with publisher + authors', () => {
    const article = {
      title: 'Sample paper on RRM',
      slug: 'sample-paper-on-rrm',
      authors: 'Jane Doe, John Roe',
      datePublished: '2023-06-01',
      abstract: 'Sample abstract.',
      journal: 'J. RRM',
      volume: '12',
      issue: '3',
      pages: '101-110',
      doi: '10.1234/foo',
      pmid: '123456',
      accessLevel: 'open',
      license: 'CC-BY',
    };
    const out = buildMedicalScholarlyArticle(article);
    assert.equal(out['@type'], 'MedicalScholarlyArticle');
    assert.equal(out.url, 'https://rrmacademy.org/library/sample-paper-on-rrm/');
    assert.equal(out.publisher.name, 'RRM Academy');
    assert.equal(out.author.length, 2);
    assert.equal(out.author[0].name, 'Jane Doe');
    assert.equal(out.pageStart, '101');
    assert.equal(out.pageEnd, '110');
    assert.equal(out.identifier.length, 2);
    assert.equal(out.sameAs, 'https://doi.org/10.1234/foo');
    assert.equal(out.isAccessibleForFree, true);
    assert.equal(out.license, 'https://creativecommons.org/licenses/by/4.0/');
    assert.equal(out.isPartOf['@type'], 'PublicationVolume');
    assert.equal(out.isPartOf.volumeNumber, '12');
    assert.equal(out.isPartOf.isPartOf['@type'], 'PublicationIssue');
    assert.equal(out.isPartOf.isPartOf.issueNumber, '3');
  });

  it('uses authorRecords when provided (with ORCID + ROR)', () => {
    const article = {
      title: 'Authored properly',
      slug: 'authored-properly',
      authorRecords: [
        {
          full_name: 'Naomi Whittaker',
          orcid: '0000-0002-1234-5678',
          primary_ror_id: 'https://ror.org/abc',
          primary_institution_name: 'RRM Academy',
        },
      ],
    };
    const out = buildMedicalScholarlyArticle(article);
    assert.equal(out.author.length, 1);
    assert.equal(out.author[0].sameAs, 'https://orcid.org/0000-0002-1234-5678');
    assert.equal(out.author[0].affiliation.sameAs, 'https://ror.org/abc');
    assert.equal(out.isAccessibleForFree, false);
  });

  it('falls back to consortium Organization when authors > AUTHOR_CAP', () => {
    const big = Array.from({ length: AUTHOR_CAP_LIB + 1 }, (_, i) => ({
      full_name: `Author ${i}`,
      orcid: `0000-0001-0000-${String(1000 + i).padStart(4, '0')}`,
    }));
    const article = {
      title: 'Mega paper',
      slug: 'mega-paper',
      authors: 'GBD 2023 Study Collaborators',
      authorRecords: big,
    };
    const out = buildMedicalScholarlyArticle(article);
    assert.equal(out.author.length, 1);
    assert.equal(out.author[0]['@type'], 'Organization');
    assert.equal(out.author[0].name, 'GBD 2023 Study Collaborators');
  });

  it('isAccessibleForFree always present (defaults false)', () => {
    const out = buildMedicalScholarlyArticle({ title: 't', slug: 's' });
    assert.equal(out.isAccessibleForFree, false);
  });
});
