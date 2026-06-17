/**
 * Pure schema.org JSON-LD builders.
 *
 * This module holds the SSOT-independent builders (Speakable, FAQPage,
 * BreadcrumbList, ScholarlyArticleStub, plus the library author-dedup helpers).
 * SSOT-dependent builders (Organization-aware Article, MedicalWebPage, Course,
 * MedicalScholarlyArticle) live in identity.ts and call into this module.
 *
 * Pure-JS so node --test can import directly without JSON-import attributes
 * or TypeScript-strip stages. identity.ts re-exports from here.
 */

const LICENSE_URLS_LIB = {
  'CC-BY': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA': 'https://creativecommons.org/licenses/by-sa/4.0/',
  'CC-BY-NC': 'https://creativecommons.org/licenses/by-nc/4.0/',
  'CC-BY-NC-SA': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  'CC-BY-ND': 'https://creativecommons.org/licenses/by-nd/4.0/',
  'CC-BY-NC-ND': 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};

export const AUTHOR_CAP_LIB = 20;

/**
 * SpeakableSpecification node. Returns null if both arrays are empty/missing.
 */
export function buildSpeakable(opts = {}) {
  const css = (opts.cssSelectors || []).filter(Boolean);
  const xp = (opts.xpath || []).filter(Boolean);
  if (css.length === 0 && xp.length === 0) return null;
  const node = {
    '@context': 'https://schema.org',
    '@type': 'SpeakableSpecification',
  };
  if (css.length > 0) node.cssSelector = css;
  if (xp.length > 0) node.xpath = xp;
  return node;
}

/**
 * FAQPage with Question + acceptedAnswer Answer pairs. Filters empty entries.
 */
export function buildFAQPage(faqs) {
  const items = (faqs || [])
    .filter((f) => f && f.question && f.answer)
    .map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.answer,
      },
    }));
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items,
  };
}

/**
 * BreadcrumbList from {name, url} pairs. Position is 1-N (1-indexed per spec).
 */
export function buildBreadcrumbList(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: (items || []).map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/**
 * Lightweight ScholarlyArticle for inline reference citations on pillar pages.
 */
export function buildScholarlyArticleStub(props) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'ScholarlyArticle',
    name: props.name,
    author: { '@type': 'Person', name: props.author },
    datePublished: props.datePublished,
  };
  if (props.journal) {
    node.isPartOf = { '@type': 'Periodical', name: props.journal };
  }
  return node;
}

// =============================================================================
// MedicalCondition — concept-level (no dosing/protocols)
// =============================================================================

/**
 * Graph-ready MedicalCondition node (no @context — for embedding in @graph arrays).
 * Concept-level only: signs and treatments are named strings, not clinical protocols.
 */
export function buildMedicalCondition({ name, alternateName = [], icd10, signs = [], treatments = [], specialty = 'Gynecology' } = {}) {
  const node = { '@type': 'MedicalCondition', name };
  if (alternateName.length) node.alternateName = alternateName;
  if (icd10) node.code = { '@type': 'MedicalCode', codeValue: icd10, codingSystem: 'ICD-10-CM' };
  if (signs.length) node.signOrSymptom = signs.map((s) => ({ '@type': 'MedicalSignOrSymptom', name: s }));
  if (treatments.length) node.possibleTreatment = treatments.map((t) => ({ '@type': 'MedicalTherapy', name: t }));
  node.relevantSpecialty = { '@type': 'MedicalSpecialty', name: specialty };
  return node;
}

// =============================================================================
// MedicalScholarlyArticle (library) — PARITY-CRITICAL helpers
// =============================================================================

export function orcidUrlLib(orcid) {
  if (!orcid) return null;
  const clean = String(orcid).trim();
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(clean)) return null;
  return `https://orcid.org/${clean.toUpperCase()}`;
}

export function nameKeyLib(fullName) {
  if (!fullName) return '';
  const n = String(fullName)
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const parts = n.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const last = parts[parts.length - 1];
  const firstInitial = parts[0][0] || '';
  return `${last} ${firstInitial}`;
}

export function cleanAffiliationNameLib(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/^Authors['’]?\s*Affiliations?\s*:?\s*/i, '');
  s = s.replace(/^\d+\s*/, '');
  s = s.trim();
  if (!s) return null;
  if (s.length <= 200) return s;
  return s.slice(0, 197) + '...';
}

export function dedupeAuthorRecordsLib(records) {
  const byOrcid = new Map();
  const noOrcid = [];
  for (const r of records) {
    if (r.orcid) {
      const prev = byOrcid.get(r.orcid);
      if (!prev) { byOrcid.set(r.orcid, r); continue; }
      const prevScore = (prev.primary_ror_id ? 2 : 0) + (prev.primary_institution_name ? 1 : 0);
      const nextScore = (r.primary_ror_id ? 2 : 0) + (r.primary_institution_name ? 1 : 0);
      if (nextScore > prevScore) byOrcid.set(r.orcid, r);
    } else {
      noOrcid.push(r);
    }
  }
  const orcidNameKeys = new Set([...byOrcid.values()].map((r) => nameKeyLib(r.full_name || r.name)));
  const seenNoOrcidKey = new Set();
  const keptNoOrcid = [];
  for (const r of noOrcid) {
    const key = nameKeyLib(r.full_name || r.name);
    if (key && orcidNameKeys.has(key)) continue;
    if (key && seenNoOrcidKey.has(key)) continue;
    if (key) seenNoOrcidKey.add(key);
    keptNoOrcid.push(r);
  }
  return [...byOrcid.values(), ...keptNoOrcid];
}

export function personFromRecordLib(rec) {
  const person = {
    '@type': 'Person',
    name: rec.full_name || rec.name,
  };
  const orcid = orcidUrlLib(rec.orcid);
  if (orcid) person.sameAs = orcid;
  const institutionName = cleanAffiliationNameLib(rec.primary_institution_name);
  const fallbackAff = cleanAffiliationNameLib(rec.affiliation);
  if (institutionName) {
    const org = { '@type': 'Organization', name: institutionName };
    if (rec.primary_ror_id) org.sameAs = rec.primary_ror_id;
    person.affiliation = org;
  } else if (fallbackAff) {
    person.affiliation = { '@type': 'Organization', name: fallbackAff };
  }
  return person;
}

/**
 * MedicalScholarlyArticle for library pages. Mirrors the inline implementation
 * in src/pages/library/[...slug].astro — same dedup/cap/affiliation/license/OA
 * behavior. Returns the @context-bearing top-level node ready to JSON.stringify.
 */
export function buildMedicalScholarlyArticle(article) {
  const node = {
    '@context': 'https://schema.org',
    '@type': 'MedicalScholarlyArticle',
    '@id': `https://rrmacademy.org/library/${article.slug}/`,
    name: article.title,
    headline: article.title,
    url: `https://rrmacademy.org/library/${article.slug}/`,
    publisher: {
      '@id': 'https://rrmacademy.org/#organization',
      '@type': 'Organization',
      name: 'RRM Academy',
      url: 'https://rrmacademy.org',
    },
  };

  const authorRecordsRaw = Array.isArray(article.authorRecords) ? article.authorRecords : [];
  const authorRecords = dedupeAuthorRecordsLib(authorRecordsRaw);

  if (authorRecords.length > AUTHOR_CAP_LIB) {
    node.author = article.authors
      ? [{ '@type': 'Organization', name: String(article.authors).trim() }]
      : [{ '@type': 'Organization', name: 'Consortium Authors' }];
  } else if (authorRecords.length > 0) {
    node.author = authorRecords.map(personFromRecordLib);
  } else if (article.authors) {
    node.author = String(article.authors).split(',').map((name) => ({
      '@type': 'Person',
      name: name.trim(),
    }));
  }

  if (article.datePublished) node.datePublished = article.datePublished;
  if (article.abstract) node.abstract = article.abstract;

  if (article.journal) {
    const isPartOf = {
      '@type': 'Periodical',
      name: article.journal,
    };
    if (article.volume) {
      node.isPartOf = {
        '@type': 'PublicationVolume',
        volumeNumber: article.volume,
        isPartOf: article.issue
          ? { '@type': 'PublicationIssue', issueNumber: article.issue, isPartOf: isPartOf }
          : isPartOf,
      };
    } else {
      node.isPartOf = isPartOf;
    }
  }

  // Pages
  const pageMatch = article.pages ? String(article.pages).match(/^(\d+)\s*[-–]\s*(\d+)$/) : null;
  const pageStart = pageMatch ? pageMatch[1] : (article.pages || undefined);
  const pageEnd = pageMatch ? pageMatch[2] : undefined;
  if (pageStart) node.pageStart = pageStart;
  if (pageEnd) node.pageEnd = pageEnd;

  // Identifiers
  const identifiers = [];
  const doiUrl = article.doi ? `https://doi.org/${article.doi}` : '';
  // sameAs collects external-identity links (DOI + Wikidata) so the entity
  // graph resolves the paper across authorities. Promoted from a scalar DOI
  // string to an array so a Wikidata link never clobbers the DOI link.
  const sameAs = [];
  if (article.doi) {
    identifiers.push({ '@type': 'PropertyValue', propertyID: 'doi', value: article.doi });
    sameAs.push(doiUrl);
  }
  if (article.pmid) {
    identifiers.push({ '@type': 'PropertyValue', propertyID: 'PMID', value: article.pmid });
  }
  // Wikidata QID (verified n==1 match). Empty string on unmatched rows → emit nothing.
  if (article.wikidataQid) {
    identifiers.push({ '@type': 'PropertyValue', propertyID: 'wikidata', value: article.wikidataQid });
    sameAs.push(`https://www.wikidata.org/wiki/${article.wikidataQid}`);
  }
  if (sameAs.length === 1) {
    node.sameAs = sameAs[0];
  } else if (sameAs.length > 1) {
    node.sameAs = sameAs;
  }
  if (identifiers.length) node.identifier = identifiers;

  // Access
  if (article.accessLevel === 'open' || article.accessLevel === 'free') {
    node.isAccessibleForFree = true;
  } else {
    node.isAccessibleForFree = false;
  }

  // License
  if (article.license && LICENSE_URLS_LIB[article.license]) {
    node.license = LICENSE_URLS_LIB[article.license];
  }

  // Editorial type: emit ScholarlyArticle subtype + citation relationship to the
  // paper this editorial responds to. Drives LLM/citation-graph linkage so that
  // RRM Academy editorials surface alongside the papers they engage with.
  if (article.type === 'editorial') {
    node['@type'] = 'ScholarlyArticle';
    node.genre = 'editorial';
  }
  if (article.respondsTo && typeof article.respondsTo === 'object') {
    const cited = {
      '@type': 'ScholarlyArticle',
      name: article.respondsTo.title,
    };
    if (article.respondsTo.doi) {
      cited.sameAs = `https://doi.org/${article.respondsTo.doi}`;
      cited.identifier = [
        { '@type': 'PropertyValue', propertyID: 'doi', value: article.respondsTo.doi },
      ];
      if (article.respondsTo.pmid) {
        cited.identifier.push({ '@type': 'PropertyValue', propertyID: 'PMID', value: String(article.respondsTo.pmid) });
      }
    }
    if (article.respondsTo.url) cited.url = article.respondsTo.url;
    if (article.respondsTo.authors) {
      cited.author = String(article.respondsTo.authors).split(',').map((name) => ({
        '@type': 'Person',
        name: name.trim(),
      }));
    }
    if (article.respondsTo.journal) {
      cited.isPartOf = { '@type': 'Periodical', name: article.respondsTo.journal };
    }
    if (article.respondsTo.year) cited.datePublished = String(article.respondsTo.year);
    node.citation = cited;
  }

  return node;
}
