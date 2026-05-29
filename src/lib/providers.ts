// Provider directory loader + helpers.
// Data source: src/data/providers.json (built by scripts/build-providers.mjs from
// the rrm-provider-directory unified-v2.json corpus). Static SSG over committed
// JSON, mirroring the library/articles pattern. No D1 at request time.
import providersData from '../data/providers.json';

export interface Provider {
  slug: string;
  name: string;
  displayName: string;
  credentials: string | null;
  recordType: 'individual' | 'practice';
  isPractice: boolean;
  practiceName: string | null;
  methods: string[];
  methodLabels: string[];
  type: string | null;
  typeLabel: string | null;
  typeGroup: 'clinical' | 'wellness' | 'educational' | 'entity' | null;
  isSurgeon: boolean;
  specialty: string | null;
  telehealth: 'yes' | 'no' | 'unknown';
  telehealthStates: string[];
  city: string | null;
  state: string | null;
  stateName: string | null;
  country: string | null;
  countryName: string | null;
  region: string; // US 2-letter code, 'US-OTHER' (US, no recognized state), or 'INTL'
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  schedulingLink: string | null;
  languages: string[];
  npi: string | null;
  npiVerified: boolean;
  confidence: 'verified' | 'multi' | 'single';
  confidenceLabel: string;
  sources: string[];
  sourceCount: number;
  lastVerified: string | null;
  relevance: 'R1' | 'R2';
  qualityFlags: string[];
  dataQualityScore: number | null;
}

const PROVIDERS = providersData as unknown as Provider[];

export function getAllProviders(): Provider[] {
  return PROVIDERS;
}

export function getProviderBySlug(slug: string): Provider | undefined {
  return PROVIDERS.find((p) => p.slug === slug);
}

// ---- method metadata ------------------------------------------------------
// Display order + labels for the canonical methods (mirrors provider-directory
// SSOT data_model.methods). Methods outside this list fall through to a
// title-cased label and sort last.
export const METHOD_ORDER: { id: string; label: string }[] = [
  { id: 'napro', label: 'NaProTechnology' },
  { id: 'creighton', label: 'Creighton' },
  { id: 'neofertility', label: 'NeoFertility' },
  { id: 'femm', label: 'FEMM' },
  { id: 'marquette', label: 'Marquette' },
  { id: 'billings', label: 'Billings' },
  { id: 'sympto-thermal', label: 'Sympto-Thermal' },
  { id: 'boston-crosscheck', label: 'Boston Crosscheck' },
  { id: 'lam', label: 'LAM' },
];
const METHOD_LABELS: Record<string, string> = Object.fromEntries(METHOD_ORDER.map((m) => [m.id, m.label]));

export function methodLabel(id: string): string {
  return METHOD_LABELS[id] || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Methods that get a dedicated /providers/method/<m>/ collection page (PRD §7.4).
export const COLLECTION_METHODS = ['napro', 'creighton', 'billings', 'sympto-thermal', 'femm', 'marquette', 'neofertility'];

// ---- US states ------------------------------------------------------------
export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
  MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'Washington, DC',
};
export const stateName = (code: string): string => US_STATE_NAMES[code] || code;

// ---- collections (for getStaticPaths) -------------------------------------
export function getProvidersByMethod(method: string): Provider[] {
  return PROVIDERS.filter((p) => p.methods.includes(method));
}

// "Located in" — physically in the given US state.
export function getProvidersInState(stateCode: string): Provider[] {
  return PROVIDERS.filter((p) => p.region === stateCode);
}

export function getTelehealthProviders(): Provider[] {
  return PROVIDERS.filter((p) => p.telehealth === 'yes');
}

// region values that are not a real per-state collection: 'INTL' (international)
// and 'US-OTHER' (US record with no recognized state — excluded from state tiles
// but never labeled international).
export const NON_STATE_REGIONS = new Set(['INTL', 'US-OTHER']);

// US states that have at least one located-in full-tier provider.
export function statesWithProviders(): { code: string; name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const p of PROVIDERS) if (!NON_STATE_REGIONS.has(p.region)) counts[p.region] = (counts[p.region] || 0) + 1;
  return Object.entries(counts)
    .map(([code, count]) => ({ code, name: stateName(code), count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- facets (for hub filters) ---------------------------------------------
export interface Facets {
  methods: { id: string; label: string; count: number }[];
  states: { code: string; name: string; count: number }[];
  languages: { name: string; count: number }[];
  entityTypes: { id: string; label: string; count: number }[];
  total: number;
  telehealthCount: number;
  partnerCount: number; // reserved (no partner data wired at MVP)
}

export function buildFacets(): Facets {
  const list = PROVIDERS;
  const methodCounts: Record<string, number> = {};
  for (const p of list) for (const m of p.methods) methodCounts[m] = (methodCounts[m] || 0) + 1;
  const methods = METHOD_ORDER
    .filter((m) => methodCounts[m.id])
    .map((m) => ({ id: m.id, label: m.label, count: methodCounts[m.id] }));

  const langCounts: Record<string, number> = {};
  for (const p of list) for (const l of p.languages) if (l) langCounts[l] = (langCounts[l] || 0) + 1;
  const languages = Object.entries(langCounts)
    .filter(([name]) => name.toLowerCase() !== 'english')
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const entityCounts: Record<string, number> = { individual: 0, practice: 0 };
  for (const p of list) entityCounts[p.isPractice ? 'practice' : 'individual']++;
  const entityTypes = [
    { id: 'individual', label: 'Individuals', count: entityCounts.individual },
    { id: 'practice', label: 'Practices & Centers', count: entityCounts.practice },
  ].filter((e) => e.count);

  return {
    methods,
    states: statesWithProviders(),
    languages,
    entityTypes,
    total: list.length,
    telehealthCount: list.filter((p) => p.telehealth === 'yes').length,
    partnerCount: 0,
  };
}

// ---- card helpers ---------------------------------------------------------
// Map practitioner_type/group → the badge palette family used by ProviderCard.
export function typeBadgeClass(p: Provider): string {
  if (p.isPractice) return 'entity';
  if (p.typeGroup === 'wellness') return 'wellness';
  if (p.typeGroup === 'educational') return 'educational';
  return 'clinical';
}

// Short, human location string: "Gilbert, AZ" or "Dublin, Ireland".
export function locationLine(p: Provider): string {
  const parts: string[] = [];
  if (p.city) parts.push(p.city);
  if (p.region !== 'INTL' && p.state) parts.push(p.state);
  else if (p.stateName) parts.push(p.stateName);
  let s = parts.join(', ');
  if (p.region === 'INTL' && p.countryName) s += (s ? ', ' : '') + p.countryName;
  return s;
}

// Split credentials into the primary degree/license (which leads the name line,
// e.g. "Jane Smith, MD") and the remaining post-nominals (shown beneath). The
// primary is the highest-ranked clinical degree/license present; method certs
// (FCP, CFCMC, NFPMC, etc.) and secondary degrees fall to `rest`. Returns
// primary=null when no degree/license is present (e.g. educators).
const PRIMARY_CRED_RANK = [
  'MD', 'DO', 'MBBS', 'MBChB', 'MB ChB', 'DDS', 'DMD', 'DPM',
  'PharmD', 'DNP', 'DPT', 'DC', 'ND', 'NMD', 'PsyD', 'PhD', 'DrPH', 'EdD',
  'PA-C', 'PA', 'APRN', 'FNP-BC', 'FNP-C', 'WHNP-BC', 'WHNP', 'PMHNP-BC', 'PMHNP',
  'AGNP', 'CNM', 'CRNA', 'ENP-C', 'CNS', 'NP', 'RN',
];
export function splitCredentials(credentials: string | null): { primary: string | null; rest: string[] } {
  if (!credentials) return { primary: null, rest: [] };
  const parts = credentials.split(',').map((s) => s.trim()).filter(Boolean);
  let idx = -1;
  let best = Infinity;
  parts.forEach((part, i) => {
    const r = PRIMARY_CRED_RANK.findIndex((c) => c.toLowerCase() === part.toLowerCase());
    if (r !== -1 && r < best) { best = r; idx = i; }
  });
  if (idx === -1) return { primary: null, rest: parts };
  return { primary: parts[idx], rest: parts.filter((_, i) => i !== idx) };
}

// ---- monogram avatars ------------------------------------------------------
// We do not scrape provider photographs (copyright + privacy). Until a provider
// uploads their own via the claim flow, every listing gets a clean initials
// monogram. Initials + tone are derived deterministically from the record so a
// given provider always renders the same avatar.
const HONORIFIC = /^(dr|mr|mrs|ms|prof)\.?\s+/i;
export function providerInitials(p: Provider): string {
  const base = (p.name || '').replace(/,.*$/, '').replace(HONORIFIC, '').trim();
  const words = base.split(/\s+/).filter((w) => /[a-z]/i.test(w) && !/^(and|&|the|of|for)$/i.test(w));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// 0-3 → one of four soft, on-brand tones (defined in ProviderAvatar.astro).
export function avatarTone(p: Provider): number {
  let h = 0;
  const s = p.slug || p.name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 4;
}

// Related providers for the detail-page rail: same primary method, prefer same state.
export function getRelatedProviders(p: Provider, limit = 6): Provider[] {
  const primary = p.methods[0];
  if (!primary) return [];
  const pool = PROVIDERS.filter((o) => o.slug !== p.slug && o.methods.includes(primary));
  pool.sort((a, b) => {
    const sa = (a.region === p.region ? 1 : 0) + (a.confidence === 'verified' ? 1 : 0);
    const sb = (b.region === p.region ? 1 : 0) + (b.confidence === 'verified' ? 1 : 0);
    return sb - sa;
  });
  return pool.slice(0, limit);
}
