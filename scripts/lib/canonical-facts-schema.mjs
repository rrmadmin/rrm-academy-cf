/**
 * Canonical Facts SSOT schema + entity filter definitions.
 *
 * Single source of truth for which D1 facts belong to which entity's
 * canonical-facts JSON. Edit ONLY here — builder and fact-checker both
 * import ENTITIES from this file.
 */

export const SCHEMA_VERSION = '1.0.0';

/**
 * Normalize the `tradition` column from D1 into a string[].
 * Accepts: "napro", "rrm-shared", '["rrm-shared"]', '["rrm-shared","napro"]', null.
 */
export function normalizeTradition(raw) {
  if (!raw) return [];
  const s = String(raw).trim();
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  }
  return [s];
}

/**
 * Entity definitions. Each entity claims a set of tradition tags.
 * `matches(traditionList)` returns true if the fact belongs to this entity.
 * Facts can belong to multiple entities (e.g. a shared napro+rrm-shared fact).
 */
export const ENTITIES = {
  naprotechnology: {
    slug: 'naprotechnology',
    name: 'NaProTechnology',
    editorial_owner: 'Thomas W. Hilgers, MD (historical canon); Naomi M. Whittaker, MD (contemporary)',
    editorial_owner_refs: [
      { '@id': 'https://rrmacademy.org/about/#naomi-whittaker' },
    ],
    output_path: 'docs/fact-check/naprotechnology-canonical-facts.json',
    matches: (traditions) => traditions.some((t) => t === 'napro'),
  },
  rrm: {
    slug: 'rrm',
    name: 'Restorative Reproductive Medicine (shared)',
    editorial_owner: 'Naomi M. Whittaker, MD',
    editorial_owner_refs: [
      { '@id': 'https://rrmacademy.org/about/#naomi-whittaker' },
    ],
    output_path: 'docs/fact-check/rrm-canonical-facts.json',
    matches: (traditions) =>
      traditions.some((t) => t === 'rrm-shared' || t === 'independent'),
  },
  creighton: {
    slug: 'creighton',
    name: 'Creighton Model FertilityCare System',
    editorial_owner: 'Thomas W. Hilgers, MD; FertilityCare Centers of America',
    editorial_owner_refs: [],
    output_path: 'docs/fact-check/creighton-canonical-facts.json',
    matches: (traditions) => traditions.some((t) => t === 'fabm'),
  },
  neofertility: {
    slug: 'neofertility',
    name: 'NeoFertility',
    editorial_owner:
      'Phil C. Boyle, MD (clinical); Linda (practice operations only)',
    editorial_owner_refs: [
      { '@id': 'https://iirrm.org/people/phil-boyle' },
    ],
    // This file lives outside rrm-academy-cf. Builder resolves relative to --project-root.
    output_path:
      '../neofertility-ie/docs/fact-check/neofertility-canonical-facts.json',
    matches: (traditions) => traditions.some((t) => t === 'neofertility'),
  },
  femm: {
    slug: 'femm',
    name: 'FEMM (Fertility Education and Medical Management)',
    editorial_owner:
      'Pilar Vigil, MD, PhD, OB/GYN, FACOG (RHRI); Erin (FEMM-trained reviewer, RRM Academy side)',
    editorial_owner_refs: [
      { '@id': 'https://rrmacademy.org/femm/' },
    ],
    output_path: 'docs/fact-check/femm-canonical-facts.json',
    matches: (traditions) => traditions.some((t) => t === 'femm'),
  },
};

export const ENTITY_SLUGS = Object.keys(ENTITIES);

/**
 * Empty SSOT document shell (for first-time generation).
 * _manual block is hand-editable; builder preserves it verbatim on regen.
 */
export function emptyDocument(entitySlug) {
  const entity = ENTITIES[entitySlug];
  if (!entity) throw new Error(`Unknown entity: ${entitySlug}`);
  return {
    _meta: {
      entity: entity.slug,
      entity_name: entity.name,
      editorial_owner: entity.editorial_owner,
      editorial_owner_refs: entity.editorial_owner_refs || [],
      schema_version: SCHEMA_VERSION,
      ssot: true,
      generated_at: null,
      generated_by: 'scripts/build-canonical-facts.mjs',
      source: 'D1 rrm-library.facts (tradition filter) + _manual overrides',
      regenerable: true,
      record_count: 0,
    },
    _manual: {
      editorial_notes: [],
      evidence_tier_definitions: {
        peer_reviewed: 'Published in a peer-reviewed journal, verified PMID/DOI.',
        clinic_presentation:
          'Clinic document, slide deck, or non-peer-reviewed manuscript. Usable with caveat.',
        clinical_experience:
          'Clinician-attributed statement without a traceable document. Cite with explicit framing.',
      },
      curator_overrides: [],
    },
    facts: [],
  };
}
