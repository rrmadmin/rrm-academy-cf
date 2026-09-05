// scripts/lib/cta-vocabulary.mjs
// Single source of truth for CTA id validation: the id shape, the 64-char
// cap (LEDGER_SHORT_CAP in functions/api/_ga4.js), and membership in the
// closed page/zone/intent vocabulary (src/data/cta-vocabulary.json).
// Shared by scripts/check-cta-map.mjs (build-time gate) and this module's
// own test. Never hand-list the vocabulary anywhere else.
//
// Spec: docs/superpowers/specs/2026-09-05-attribution-cta-map-ltv-design.md §4.1

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VOCAB_PATH = resolve(__dirname, '../../src/data/cta-vocabulary.json');

// data-cta="<page>.<zone>.<intent>", lowercase, hyphenated tokens.
export const CTA_ID_REGEX = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/;

// Matches LEDGER_SHORT_CAP in functions/api/_ga4.js -- the ledger's `type`
// column binds a cta_click id verbatim, so a composed id longer than this
// would be silently truncated at the ledger boundary. NOT derivable from
// CTA_ID_REGEX alone (a naive reading of the regex allows well over 100
// chars); this is a separate, explicit cap.
export const CTA_ID_MAX_LENGTH = 64;

let cached = null;

/** Loads and validates src/data/cta-vocabulary.json. Cached after first call. */
export function loadCtaVocabulary() {
  if (cached) return cached;
  const raw = readFileSync(VOCAB_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  for (const key of ['pages', 'zones', 'intents']) {
    if (!Array.isArray(parsed[key]) || parsed[key].length === 0) {
      throw new Error(`cta-vocabulary.json: "${key}" must be a non-empty array`);
    }
    for (const token of parsed[key]) {
      if (typeof token !== 'string' || !/^[a-z0-9-]+$/.test(token)) {
        throw new Error(`cta-vocabulary.json: "${key}" contains an invalid token "${token}"`);
      }
    }
  }
  cached = {
    pages: new Set(parsed.pages),
    zones: new Set(parsed.zones),
    intents: new Set(parsed.intents),
  };
  return cached;
}

/**
 * Validates one candidate CTA id against the regex, the length cap, and
 * vocabulary membership. Returns a reason string (not just a boolean) so
 * the lint gate can name the exact defect at the exact file/line.
 */
export function validateCtaId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    return { ok: false, reason: 'data-cta value is empty or not a string' };
  }
  if (id.length > CTA_ID_MAX_LENGTH) {
    return { ok: false, reason: `data-cta "${id}" exceeds the ${CTA_ID_MAX_LENGTH}-char cap (LEDGER_SHORT_CAP)` };
  }
  if (!CTA_ID_REGEX.test(id)) {
    return { ok: false, reason: `data-cta "${id}" does not match ^[a-z0-9-]+\\.[a-z0-9-]+\\.[a-z0-9-]+$` };
  }
  const [page, zone, intent] = id.split('.');
  const vocab = loadCtaVocabulary();
  if (!vocab.pages.has(page)) return { ok: false, reason: `data-cta "${id}": page token "${page}" is not in cta-vocabulary.json pages` };
  if (!vocab.zones.has(zone)) return { ok: false, reason: `data-cta "${id}": zone token "${zone}" is not in cta-vocabulary.json zones` };
  if (!vocab.intents.has(intent)) return { ok: false, reason: `data-cta "${id}": intent token "${intent}" is not in cta-vocabulary.json intents` };
  return { ok: true };
}

/** Boolean convenience wrapper for call sites that don't need the reason. */
export function isValidCtaId(id) {
  return validateCtaId(id).ok;
}
