#!/usr/bin/env node
/**
 * build-providers.mjs — transform the provider-directory SSOT (unified-v2.json)
 * into the lean static JSON the /providers/ Astro pages consume.
 *
 * Source of truth lives in the sibling repo rrm-provider-directory; this script
 * filters to the launch scope (core RRM: relevance R1+R2, listable) and maps
 * each record to a small display schema. Output is committed to git so the
 * Astro build never depends on the sibling repo (mirrors courses-overrides.json).
 *
 * Re-run after the provider-directory pipeline refreshes:
 *   node scripts/build-providers.mjs
 * Override the source path:
 *   RRM_PROVIDER_SOURCE=/path/to/unified-v2.json node scripts/build-providers.mjs
 *
 * Launch scope (v1): relevance in {R1,R2} AND listability in {full,basic,minimal}.
 * Excludes R3-R8 (general mental health, NFP-friendly primary care, general
 * Catholic healthcare) and all hard-gated (unlisted) records.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'src/data/providers.json');

// Slug-keyed name/credential corrections, applied to the source record before
// mapping. The upstream pipeline (normalize-all.py) mis-parsed some records,
// stuffing the surname + marketing prose into `credentials` and leaving `name`
// as a bare first name (e.g. "Monique" / "MD, ... Ruberu, FACOG"). Rather than
// edit the regenerated unified-v2.json (clobbered on the next pipeline run),
// corrections live here keyed by source slug. Each value overrides name and/or
// credentials. `credentials: null` clears the field. Every correction only
// rearranges/normalizes tokens already present upstream — no invented data.
// TODO(upstream): port these into normalize-all.py so new records parse clean.
const CORRECTIONS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(REPO, 'src/data/provider-name-corrections.json'), 'utf8'));
  } catch { return {}; }
})();

const DEFAULT_SOURCES = [
  process.env.RRM_PROVIDER_SOURCE,
  path.resolve(REPO, '../rrm-provider-directory/data/unified-v2.json'),
  path.resolve(REPO, '../../projects/rrm-provider-directory/data/unified-v2.json'),
  `${process.env.HOME}/iCode/projects/rrm-provider-directory/data/unified-v2.json`,
].filter(Boolean);

const SOURCE = DEFAULT_SOURCES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!SOURCE) {
  console.error('[build-providers] FATAL: could not locate unified-v2.json. Tried:\n  ' + DEFAULT_SOURCES.join('\n  '));
  process.exit(1);
}

// NPPES taxonomy fill: authoritative federal specialty for NPI providers whose
// `specialty` is blank upstream. Pulled by the provider-directory script
// fetch-nppes-details.py and stored beside unified-v2.json, keyed by NPI. Only
// fills a BLANK specialty (never overrides) and only the taxonomy desc — never
// addresses/phones (NPPES LOCATION can be a home address). Optional file: absent
// = no fills. Like unified-v2.json, this is consumed only at local build time;
// the committed providers.json is what ships.
const NPPES = (() => {
  try {
    const p = path.join(path.dirname(SOURCE), 'nppes-details.json');
    return JSON.parse(fs.readFileSync(p, 'utf8')).providers || {};
  } catch { return {}; }
})();
function nppesSpecialty(npi) {
  const rec = npi && NPPES[String(npi).trim()];
  if (!rec || rec._status) return null;
  const taxes = rec.taxonomies || [];
  const t = taxes.find((x) => x.primary) || taxes[0];
  return (t && t.desc) || null;
}

// ---- reference maps -------------------------------------------------------
const METHOD_LABELS = {
  napro: 'NaProTechnology', creighton: 'Creighton', neofertility: 'NeoFertility',
  femm: 'FEMM', marquette: 'Marquette', billings: 'Billings',
  'sympto-thermal': 'Sympto-Thermal', sensiplan: 'Sensiplan',
  'boston-crosscheck': 'Boston Crosscheck', lam: 'LAM',
  'two-day': 'Two-Day', 'standard-days': 'Standard Days', nfpta: 'NFPTA',
  'family-americas': 'Family of the Americas', 'sympto-hormonal': 'Sympto-Hormonal',
  nfnz: 'NFNZ', 'fertility-uk': 'Fertility UK', serena: 'SERENA', other: 'Other',
};
const methodLabel = (m) => METHOD_LABELS[m] || String(m).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// Decode the handful of pre-encoded HTML entities that upstream sometimes
// stores in display strings. Astro re-escapes already-encoded text at render
// time, so "&amp;" / "&#039;" would surface as literal mojibake. Decode ONCE
// here; never at render time.
const ENTITY_MAP = {
  '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>',
  '&#039;': "'", '&#39;': "'", '&apos;': "'", '&#8217;': '’', '&#34;': '"',
};
const decodeEntities = (s) => typeof s === 'string'
  ? s.replace(/&(?:amp|quot|lt|gt|apos|#0?39|#34|#8217);/g, (m) => ENTITY_MAP[m] || m)
  : s;

// A "machine slug" specialty is an internal lowercase token (or comma/dash
// joined list of them) that was never meant to face a human, e.g.
// "fertilitycare-practitioner" or "obgyn,ophthalmologist". Rendered verbatim it
// reads as garbage and title-casing it produces "Obgyn"/"Cfcmc", so we drop it
// instead. Mirrors build-og-index.mjs's dash-slug guard, but tightened so
// genuinely human values that merely contain a hyphen ("NFP-only OB/GYN",
// "Speech-Language Pathologist") survive.
function isMachineSpecialty(v) {
  if (typeof v !== 'string') return false;
  const t = v.replace(/[,\s]+$/, '').trim();
  if (!t) return false;
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(t)) return true; // single dash-slug
  if (t.includes(',')) {
    const toks = t.split(',').map((x) => x.trim()).filter(Boolean);
    if (toks.length > 1 && toks.every((x) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(x))) return true;
    if (toks.some((x) => /^[a-z0-9]+-[a-z0-9-]+$/.test(x))) return true;
  }
  return false;
}

// Slugs flow into URLs and the claim-page prefill regex /^[a-z0-9-]{1,120}$/.
// A valid all-lowercase-hyphen slug MUST pass through unchanged (changing it
// moves a live URL). Only genuinely-invalid slugs (underscores, email-domain
// fragments, stray chars) are sanitized.
function sanitizeSlug(slug) {
  if (typeof slug !== 'string' || /^[a-z0-9-]{1,120}$/.test(slug)) return slug;
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-(com|org|net|edu)$/, '')
    .replace(/-+$/, '')
    .slice(0, 120);
}

// practitioner_type -> {label, group}. group drives the badge palette family.
const TYPE_MAP = {
  medical: { label: 'Medical', group: 'clinical' },
  nurse_practitioner: { label: 'Nurse Practitioner', group: 'clinical' },
  nurse: { label: 'Nurse', group: 'clinical' },
  pharmacist: { label: 'Pharmacist', group: 'clinical' },
  chiropractor: { label: 'Chiropractor', group: 'clinical' },
  naturopath: { label: 'Naturopath', group: 'clinical' },
  therapist: { label: 'Therapist', group: 'wellness' },
  mental_health: { label: 'Therapist', group: 'wellness' },
  physical_therapist: { label: 'Physical Therapist', group: 'wellness' },
  nutritionist: { label: 'Nutritionist', group: 'wellness' },
  health_coach: { label: 'Health Coach', group: 'wellness' },
  doula_lactation: { label: 'Doula / Lactation', group: 'wellness' },
  educator: { label: 'Educator', group: 'educational' },
};

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'Washington, DC',
  PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa', MP: 'Northern Mariana Islands',
};
const COUNTRY_NAMES = {
  US: 'United States', IE: 'Ireland', GB: 'United Kingdom', UK: 'United Kingdom',
  CA: 'Canada', AU: 'Australia', NZ: 'New Zealand', NG: 'Nigeria', MX: 'Mexico',
  DE: 'Germany', AT: 'Austria', CH: 'Switzerland', FR: 'France', IT: 'Italy',
  ES: 'Spain', PT: 'Portugal', CR: 'Costa Rica', CO: 'Colombia', CL: 'Chile',
  KZ: 'Kazakhstan', HU: 'Hungary', HR: 'Croatia', ZA: 'South Africa', PL: 'Poland',
  BR: 'Brazil', AR: 'Argentina', PH: 'Philippines', IN: 'India', KE: 'Kenya', UG: 'Uganda',
};

// verification_tier -> confidence display tier
function confidenceOf(tier) {
  if (['npi_multi_source', 'npi_healthgrades', 'npi_verified'].includes(tier)) return { id: 'verified', label: 'Verified' };
  if (['multi_source', 'dual_source'].includes(tier)) return { id: 'multi', label: 'Multi-source' };
  return { id: 'single', label: 'Single source' };
}

const DOCTORATE = /\b(MD|DO|MBBS|PhD|PsyD|DPT|PharmD|DC|ND|NMD|DNP|DrPH|EdD|DDS|DMD)\b/;

function normalizeCreds(creds) {
  if (!creds) return '';
  return String(creds).split(',').map((s) => s.trim()).filter(Boolean).join(', ');
}

function displayName(r) {
  let name = r.name || '';
  const creds = normalizeCreds(r.credentials);
  const hasDoc = DOCTORATE.test(creds) || DOCTORATE.test(name);
  if (!hasDoc) name = name.replace(/^Dr\.?\s+/i, '');
  if (creds && !name.includes(creds)) name += ', ' + creds;
  return name.trim();
}

function isSurgeon(r) {
  if (r.practitioner_type !== 'medical') return false;
  const creds = r.credentials || '';
  if (/\bMIGS\b/.test(creds)) return true;
  const src = (r._all_sources || []).join(' ') + ' ' + (r.source || '');
  const fellowship = /\b(cfcmc|naprotechnology\.com|pope ?paul ?vi|saint ?paul ?vi)\b/i.test(src);
  const surgical = /\b(surg|excision|laparoscop|MIGS|minimally.invasive)\b/i.test(creds + ' ' + (r.specialty || ''));
  return fellowship && surgical;
}

function isPractice(r) {
  return r.record_type === 'practice' || r.is_practice === true || r.entity_type === 'solo_practice'
    || r.entity_type === 'group_practice' || r.entity_type === 'medical_center'
    || r.entity_type === 'hospital_or_health_system' || r.entity_type === 'university_clinic'
    || r.entity_type === 'training_institution' || r.entity_type === 'fertilitycare_center';
}

// ---- transform ------------------------------------------------------------
const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const records = Array.isArray(raw) ? raw : (raw.records || raw.providers || []);

const LISTABLE = new Set(['full', 'basic', 'minimal']);
const CORE = new Set(['R1', 'R2']);
// Stale legacy CSVs (2015 FertilityCare, 2018 NaPro). Per PRD §6 these are
// retired at MVP. We drop records sourced SOLELY from them; multi-sourced
// records that merely also appear in a legacy CSV are kept.
const LEGACY_SOURCES = new Set(['fertilitycare-practitioners-legacy', 'napro-doctors-legacy']);
const isLegacyOnly = (r) => {
  const srcs = (r._all_sources && r._all_sources.length ? r._all_sources : [r.source]).filter(Boolean);
  return srcs.length > 0 && srcs.every((s) => LEGACY_SOURCES.has(s));
};

const seenSlugs = new Set();
let slugCollisions = 0;
let droppedLegacyOnly = 0;
let correctionsApplied = 0;
let nppesSpecialtyFilled = 0;
const out = [];

for (const r of records) {
  if (!CORE.has(r.relevance)) continue;
  if (!LISTABLE.has(r.listability)) continue;
  if (!r.slug || !r.name) continue;
  if (isLegacyOnly(r)) { droppedLegacyOnly++; continue; }

  // apply manual name/credential corrections (keyed by source slug)
  const fix = CORRECTIONS[r.slug];
  if (fix) {
    if (typeof fix.name === 'string' && fix.name.trim()) r.name = fix.name;
    if ('credentials' in fix) r.credentials = fix.credentials; // may be null -> cleared
    correctionsApplied++;
  }

  // decode pre-encoded HTML entities + normalize credential token list ONCE,
  // before any field is read for display, JSON-LD, or slug derivation.
  r.name = decodeEntities(r.name);
  r.credentials = normalizeCreds(decodeEntities(r.credentials)) || null;
  r.practice_name = decodeEntities(r.practice_name);
  r.specialty = decodeEntities(r.specialty);
  if (Array.isArray(r.telehealth_states)) r.telehealth_states = r.telehealth_states.map(decodeEntities);

  // sanitize then guarantee unique slug (source has none today, but defend
  // against it). Sanitization is a no-op on already-valid lowercase-hyphen
  // slugs, so existing URLs never move.
  let slug = sanitizeSlug(r.slug);
  if (seenSlugs.has(slug)) { slugCollisions++; let n = 2; while (seenSlugs.has(`${slug}-${n}`)) n++; slug = `${slug}-${n}`; }
  seenSlugs.add(slug);

  const methods = Array.isArray(r.methods) ? r.methods.filter(Boolean) : [];
  const typeInfo = TYPE_MAP[r.practitioner_type] || null;
  const practice = isPractice(r);
  const websiteDead = (r.quality_flags || []).includes('website_dead');
  const country = (r.country || '').toUpperCase();
  const countryName = COUNTRY_NAMES[country] || r.country_name || r.country || '';
  const usState = country === 'US' && US_STATES[(r.state || '').toUpperCase()] ? (r.state || '').toUpperCase() : null;
  // A US record whose state is null/unrecognized must never read as INTL. It
  // gets the US-OTHER sentinel (kept out of state tiles, never labeled
  // international); a non-US record is INTL.
  const region = usState || (country === 'US' ? 'US-OTHER' : 'INTL');
  const conf = confidenceOf(r.verification_tier);
  const sources = (r._all_sources && r._all_sources.length ? r._all_sources : [r.source]).filter(Boolean);

  // specialty: keep upstream value; fall back to authoritative NPPES taxonomy
  // when blank. Drop internal machine-slug values (they render as mojibake).
  let specialty = r.specialty && !isMachineSpecialty(r.specialty) ? r.specialty.replace(/[,\s]+$/, '').trim() : null;
  if (!specialty) {
    const ns = nppesSpecialty(r.npi_number);
    if (ns) { specialty = ns; nppesSpecialtyFilled++; }
  }

  out.push({
    slug,
    name: r.name,
    displayName: displayName(r),
    credentials: r.credentials || null,
    recordType: practice ? 'practice' : 'individual',
    isPractice: practice,
    practiceName: r.practice_name && r.practice_name !== r.name ? r.practice_name : null,
    methods,
    methodLabels: methods.map(methodLabel),
    type: practice ? null : (r.practitioner_type || null),
    typeLabel: practice ? 'Practice' : (typeInfo ? typeInfo.label : null),
    typeGroup: typeInfo ? typeInfo.group : (practice ? 'entity' : null),
    isSurgeon: isSurgeon(r),
    specialty,
    telehealth: r.telehealth || 'unknown',
    telehealthStates: Array.isArray(r.telehealth_states) ? r.telehealth_states : [],
    city: r.city || null,
    state: usState || null,
    stateName: usState ? US_STATES[usState] : (country === 'US' ? null : (r.state_name || r.state || null)),
    country: country || null,
    countryName: countryName || null,
    region,
    zip: r.zip || null,
    phone: r.phone || null,
    email: r.email && r.email_public === true ? r.email : null,
    website: r.website && !websiteDead ? r.website : null,
    schedulingLink: r.scheduling_link || null,
    languages: Array.isArray(r.languages) ? r.languages : [],
    npi: r.npi_number || null,
    npiVerified: !!(r.npi_verified || r.npi_number),
    confidence: conf.id,
    confidenceLabel: conf.label,
    sources,
    sourceCount: r._source_count || sources.length || 1,
    lastVerified: r.last_verified || null,
    relevance: r.relevance,
    qualityFlags: r.quality_flags || [],
    dataQualityScore: typeof r.data_quality_score === 'number' ? r.data_quality_score : null,
  });
}

// ---- NPI dedup ------------------------------------------------------------
// One physician occasionally survives the launch-scope filter as two slugs
// (e.g. "stephen-hilgers" + "steven-hilgers", same NPI). Slug-dedup above can't
// see this; merge by valid 10-digit npi_number. The richer twin (higher
// dataQualityScore, then more methods, then more complete fields, then slug)
// is canonical and KEEPS its slug; methods + telehealthStates are unioned and
// telehealth becomes 'yes' if either twin is 'yes'. No NPI-bearing record is
// dropped without folding its data into the survivor; records without a valid
// NPI are never merged. Deterministic + order-independent.
const validNpi = (n) => (typeof n === 'string' && /^\d{10}$/.test(n)) || (typeof n === 'number' && /^\d{10}$/.test(String(n))) ? String(n) : null;
const completeness = (p) => Object.values(p).filter((v) => v != null && !(Array.isArray(v) && v.length === 0) && v !== '').length;
function richer(a, b) {
  const da = a.dataQualityScore || 0, db = b.dataQualityScore || 0;
  if (da !== db) return da > db ? a : b;
  if (a.methods.length !== b.methods.length) return a.methods.length > b.methods.length ? a : b;
  const ca = completeness(a), cb = completeness(b);
  if (ca !== cb) return ca > cb ? a : b;
  return String(a.slug).localeCompare(String(b.slug)) <= 0 ? a : b;
}
function mergeNpiTwins(canon, other) {
  const methods = Array.from(new Set([...canon.methods, ...other.methods]));
  const telehealthStates = Array.from(new Set([...(canon.telehealthStates || []), ...(other.telehealthStates || [])]));
  return {
    ...canon,
    methods,
    methodLabels: methods.map(methodLabel),
    telehealthStates,
    telehealth: (canon.telehealth === 'yes' || other.telehealth === 'yes') ? 'yes' : canon.telehealth,
  };
}
let npiMerges = 0;
const byNpi = new Map();
const deduped = [];
for (const p of out) {
  const npi = validNpi(p.npi);
  if (!npi) { deduped.push(p); continue; }
  const idx = byNpi.get(npi);
  if (idx === undefined) { byNpi.set(npi, deduped.length); deduped.push(p); continue; }
  const existing = deduped[idx];
  const canon = richer(existing, p);
  const loser = canon === existing ? p : existing;
  deduped[idx] = mergeNpiTwins(canon, loser);
  npiMerges++;
}
out.length = 0;
out.push(...deduped);

// sort: verified first, then data quality, then telehealth, then name — deterministic
const CONF_RANK = { verified: 2, multi: 1, single: 0 };
out.sort((a, b) =>
  (CONF_RANK[b.confidence] - CONF_RANK[a.confidence]) ||
  ((b.dataQualityScore || 0) - (a.dataQualityScore || 0)) ||
  ((a.telehealth === 'yes' ? -1 : 0) - (b.telehealth === 'yes' ? -1 : 0)) ||
  String(a.name).localeCompare(String(b.name))
);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + '\n');

// ---- stats ----------------------------------------------------------------
const count = (fn) => out.filter(fn).length;
const byMethod = {};
for (const p of out) for (const m of p.methods) byMethod[m] = (byMethod[m] || 0) + 1;
const byType = {};
for (const p of out) { const k = p.typeLabel || 'Unknown'; byType[k] = (byType[k] || 0) + 1; }
const usStates = new Set(out.filter((p) => p.region !== 'INTL' && p.region !== 'US-OTHER').map((p) => p.region));

console.log(`[build-providers] source: ${SOURCE}`);
console.log(`[build-providers] wrote ${out.length} providers -> ${path.relative(REPO, OUT)}`);
console.log(`  slug collisions resolved: ${slugCollisions}  legacy-only dropped: ${droppedLegacyOnly}  name/cred corrections applied: ${correctionsApplied}  NPPES specialty fills: ${nppesSpecialtyFilled}  NPI twins merged: ${npiMerges}`);
console.log(`  R1: ${count((p) => p.relevance === 'R1')}  R2: ${count((p) => p.relevance === 'R2')}`);
console.log(`  practices: ${count((p) => p.isPractice)}  telehealth=yes: ${count((p) => p.telehealth === 'yes')}`);
console.log(`  verified: ${count((p) => p.confidence === 'verified')}  multi: ${count((p) => p.confidence === 'multi')}  single: ${count((p) => p.confidence === 'single')}`);
console.log(`  w/ phone: ${count((p) => p.phone)}  w/ website: ${count((p) => p.website)}  w/ email: ${count((p) => p.email)}`);
console.log(`  US states represented: ${usStates.size}  international: ${count((p) => p.region === 'INTL')}`);
console.log(`  top methods: ${Object.entries(byMethod).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([m, c]) => `${m}:${c}`).join(' ')}`);
console.log(`  types: ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}:${c}`).join(' ')}`);
