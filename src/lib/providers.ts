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
  region: string; // US 2-letter code, or 'INTL'
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

// US states that have at least one located-in full-tier provider.
export function statesWithProviders(): { code: string; name: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const p of PROVIDERS) if (p.region !== 'INTL') counts[p.region] = (counts[p.region] || 0) + 1;
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
