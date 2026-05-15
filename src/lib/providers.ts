// src/lib/providers.ts
// Types + helpers for the Provider Directory. Mirrors src/lib/partners.ts.
// See: rrm-provider-directory/docs/superpowers/specs/2026-05-09-provider-directory-prd.md

export type EntityType =
  | 'individual_person'
  | 'solo_practice'
  | 'group_practice'
  | 'medical_center'
  | 'hospital_or_health_system'
  | 'university_clinic'
  | 'training_institution'
  | 'fertilitycare_center'
  | 'educational_org';

export type Listability = 'full' | 'basic' | 'minimal' | 'unlisted';

export type Telehealth = 'yes' | 'no' | 'unknown' | 'likely_capable';

export type AcceptingNewPatients = 'yes' | 'no' | 'unknown';

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface SourceRecord {
  source: string;
  source_id?: string;
  source_url?: string;
  scraped_at?: string;
}

export interface Provider {
  id: string;
  slug: string;
  entity_type: EntityType;
  parent_id: string | null;
  name: string;
  credentials: string | null;
  bio: string | null;
  photo_url: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  website_url: string | null;
  address: Address | null;
  latitude: number | null;
  longitude: number | null;
  npi: string | null;
  methods: string[];
  languages: string[];
  telehealth: Telehealth;
  telehealth_states_licensed: string[];
  telehealth_states_attested: string[];
  telehealth_states_negative: string[];
  accepting_new_patients: AcceptingNewPatients;
  listability: Listability;
  relevance: string;
  verification_tier: string | null;
  badges: string[];
  partner_id: string | null;
  verified_contact: boolean;
  do_not_contact: boolean;
  created_at: string;
  updated_at: string;
  last_verified_by_provider_at: string | null;
  source_records: SourceRecord[];
}

export const INDIVIDUAL_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  'individual_person',
]);

export const ORG_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  'solo_practice',
  'group_practice',
  'medical_center',
  'hospital_or_health_system',
  'university_clinic',
  'training_institution',
  'fertilitycare_center',
  'educational_org',
]);

export function isIndividual(p: Provider): boolean {
  return INDIVIDUAL_ENTITY_TYPES.has(p.entity_type);
}

export function isOrg(p: Provider): boolean {
  return ORG_ENTITY_TYPES.has(p.entity_type);
}

export function displayName(p: Provider): string {
  if (isIndividual(p) && p.credentials) {
    return `${p.name}, ${p.credentials}`;
  }
  return p.name;
}

export function fullTier(providers: Provider[]): Provider[] {
  return providers.filter((p) => p.listability === 'full');
}

// PRD §7.4 method codes
export const METHOD_CODES = [
  'napro',
  'creighton',
  'billings',
  'sympto-thermal',
  'femm',
  'marquette',
] as const;

export type MethodCode = (typeof METHOD_CODES)[number];

export const METHOD_DISPLAY: Record<MethodCode, string> = {
  napro: 'NaProTechnology',
  creighton: 'Creighton Model',
  billings: 'Billings Ovulation Method',
  'sympto-thermal': 'Sympto-Thermal Method',
  femm: 'FEMM',
  marquette: 'Marquette Method',
};

// US state codes (PRD §7.5)
export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC',
] as const;

export type StateCode = (typeof US_STATES)[number];
