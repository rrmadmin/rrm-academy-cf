// src/lib/partners.ts
// Shared types and helpers for the Educational Partners program.
// See: rrm-academy-internal/superpowers/specs/2026-04-16-educational-partners-program-design.md (satellite repo)

export interface PartnerAffirmations {
  find_the_cause: boolean;
  treat_the_disease: boolean;
  restore_function: boolean;
  rrm_scope: boolean;
}

export type PartnerTier = 'friend' | 'partner' | 'accredited';
export type PartnerStatus = 'pending' | 'active' | 'rejected' | 'revoked';

export interface Partner {
  id: string;
  name: string;
  slug: string;
  site_url: string;
  country: string;
  city: string | null;
  provider_name: string;
  provider_credential: string;
  provider_directory_id: string | null;
  blurb: string | null;
  affirmations: PartnerAffirmations;
  contact_email: string;
  tier: PartnerTier;
  status: PartnerStatus;
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  revoked_at: string | null;
}

export interface PublicPartner {
  id: string;
  name: string;
  slug: string;
  site_url: string;
  country: string;
  city: string | null;
  provider_name: string;
  provider_credential: string;
  provider_directory_id: string | null;
  blurb: string | null;
  approved_at: string;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function generatePartnerId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'rec';
  for (let i = 0; i < 14; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

export const FRIEND_PRINCIPLES = [
  {
    key: 'find_the_cause',
    label: 'Find the cause',
    description:
      'Every evaluation begins with the question: what is producing these symptoms? Cycle-timed diagnostics, imaging, and targeted lab work are used to identify the specific condition. The workup does not stop at "unexplained."',
  },
  {
    key: 'treat_the_disease',
    label: 'Treat the disease',
    description:
      'Treatment is matched to the diagnosis. Hormonal support, surgery, metabolic intervention, or a combination, each targeted to the finding. Nothing is empiric. Nothing is generic.',
  },
  {
    key: 'restore_function',
    label: 'Restore function',
    description:
      'The goal is a body working as it should. When the disease is treated, reproductive function, including fertility, cycle regularity, hormonal balance, and pain resolution, often returns on its own.',
  },
] as const;

export const FRIEND_SCOPE_ATTESTATION =
  "Our care is delivered within the RRM clinical scope: treating diagnosable conditions with the goal of restoring healthy natural function, not suppressing symptoms or substituting for the body's own capacity.";
