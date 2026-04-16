// src/lib/partners.ts
// Shared types and helpers for the Educational Partners program.
// See: docs/superpowers/specs/2026-04-16-educational-partners-program-design.md

export interface PartnerAffirmations {
  fabm_diagnosis: boolean;
  excision_over_ablation: boolean;
  rrm_primary_path: boolean;
  patient_education: boolean;
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
    key: 'fabm_diagnosis',
    label: 'FABM-informed diagnosis',
    description:
      'Fertility awareness-based methods are used for cycle tracking, diagnosis, and protocol design, including evaluation of male-factor contributors.',
  },
  {
    key: 'excision_over_ablation',
    label: 'Excision over ablation when surgery is indicated',
    description:
      'When endometriosis surgery is indicated, surgical excision is preferred over ablation. Clinics may take a medical-first approach to endometriosis management; this principle applies only to surgical choice.',
  },
  {
    key: 'rrm_primary_path',
    label: 'RRM as primary path',
    description:
      'Restorative reproductive medicine is offered as the primary fertility pathway. IVF is not promoted as a first-line option.',
  },
  {
    key: 'patient_education',
    label: 'Patient education as standard of care',
    description:
      'Patients are taught to understand their own cycles, symptoms, and treatment rationale.',
  },
] as const;
