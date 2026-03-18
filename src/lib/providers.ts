// Provider data layer for RRM Provider Directory.
// Loads from cached JSON at build time.

import providersData from '../data/providers.json';

export interface Provider {
  slug: string;
  name: string;
  display_name: string;
  first_name: string;
  last_name: string;
  credentials: string;
  practitioner_type: string;
  city: string;
  state: string;
  country: string;
  zip: string;
  address: string;
  phone: string;
  phone_ext: string;
  email: string;
  website: string;
  practice_name: string;
  bio: string;
  photo_url: string;
  methods: string[];
  telehealth: string;
  telehealth_states: string[];
  languages: string[];
  gbp_rating: number | null;
  gbp_review_count: number | null;
  npi_verified: boolean;
  npi_number: string;
  npi_specialties: string[];
  npi_licenses: { state: string; license: string }[];
  healthgrades_url: string;
  webmd_url: string;
  source: string;
  source_directory_label: string;
  source_profile_url: string;
  _all_sources: string[];
  verification_badge: 'npi_verified' | 'verified' | null;
  accepting: boolean | null;
  practice_group_id: string;
  practice_slug: string | null;
  is_online_only: boolean;
  is_claimed: boolean;
  faqs: { q: string; a: string }[];
  meta: { title: string; description: string };
  similar_slugs: string[];
  phone_confirmed_by: string[];
  last_verified: string;
  methods_by_source: Record<string, string[]>;
}

export interface Practice {
  slug: string;
  name: string;
  group_id: string;
  city: string;
  state: string;
  country: string;
  phone: string;
  website: string;
  member_slugs: string[];
  is_online_only: boolean;
}

const data = providersData as { providers: Provider[]; practices: Practice[] };

export function fetchAllProviders(): Provider[] {
  return data.providers;
}

export function fetchAllPractices(): Practice[] {
  return data.practices;
}

export function getProviderBySlug(slug: string): Provider | undefined {
  return data.providers.find(p => p.slug === slug);
}

export function getPracticeBySlug(slug: string): Practice | undefined {
  return data.practices.find(p => p.slug === slug);
}

export function getProvidersByPractice(practiceSlug: string): Provider[] {
  const practice = getPracticeBySlug(practiceSlug);
  if (!practice) return [];
  return practice.member_slugs
    .map(slug => getProviderBySlug(slug))
    .filter((p): p is Provider => !!p);
}

export function getSimilarProviders(provider: Provider): Provider[] {
  return provider.similar_slugs
    .map(slug => getProviderBySlug(slug))
    .filter((p): p is Provider => !!p);
}

// Method display labels
export const METHOD_LABELS: Record<string, string> = {
  napro: 'NaPro', creighton: 'Creighton', femm: 'FEMM', neofertility: 'NeoFertility',
  marquette: 'Marquette', billings: 'Billings', 'sympto-thermal': 'Sympto-Thermal',
  'boston-crosscheck': 'Boston Crosscheck', lam: 'LAM', sensiplan: 'Sensiplan',
  'standard-days': 'Standard Days', other: 'Other'
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[method] || method.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
