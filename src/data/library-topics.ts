// src/data/library-topics.ts
// SINGLE source of truth for library category browse: which top-level topics get a browse
// page (allowlist), which appear as atlas tiles, their copy, and the build-time sentiment
// filter. Imported by index.astro + topics/[slug].astro so the surfaces can't drift.

export interface Category {
  label: string;          // canonical top-level topic label exactly as stored in D1 topics[]
  pageDescriptor: string; // intro line on /library/topics/<slug>/
  browsable: boolean;     // true => gets a browse page
  tile?: {                // present => also an atlas tile on /library/
    name: string;         // tile display name (may differ from label, e.g. "Hormones & Cycle")
    accent: string;       // y|r|g|p|s (existing tile CSS)
    desc: string;         // short tile copy (distinct purpose from pageDescriptor; co-located so no silent drift)
    iconKey: string;      // key into TOPIC_ICONS in index.astro
    match?: string[];     // top-level labels this tile counts (default [label]); MUST equal what the page shows
  };
}

// 16 browsable categories; 10 of them are atlas tiles. Everything NOT here is tag-only.
export const CATEGORIES: Category[] = [
  { label: 'Endometriosis', browsable: true, pageDescriptor: 'Excision, AMH, recurrence, biomarkers.',
    tile: { name: 'Endometriosis', accent: 'y', iconKey: 'Endometriosis', desc: 'Excision surgery, recurrence, biomarkers, fertility outcomes.' } },
  { label: 'Infertility', browsable: true, pageDescriptor: 'RRM work-up, IVF outcomes, recurrent loss.',
    tile: { name: 'Infertility', accent: 'r', iconKey: 'Infertility', desc: 'RRM work-up, IVF outcomes, recurrent loss, cumulative pregnancy rates.' } },
  { label: 'PCOS', browsable: true, pageDescriptor: 'Phenotype, insulin resistance, progesterone.',
    tile: { name: 'PCOS', accent: 'g', iconKey: 'PCOS', desc: 'Phenotypes, insulin resistance, ovulation, progesterone.' } },
  { label: 'Pregnancy', browsable: true, pageDescriptor: 'Progesterone support, miscarriage, neonatal outcomes.',
    tile: { name: 'Pregnancy', accent: 'r', iconKey: 'Pregnancy', desc: 'Progesterone support, miscarriage prevention, neonatal outcomes.' } },
  { label: 'Menstrual Cycle', browsable: true, pageDescriptor: 'Cycle physiology, mucus biomarkers, ovulation.',
    tile: { name: 'Hormones & Cycle', accent: 'p', iconKey: 'Hormones & Cycle', desc: 'Cycle physiology, mucus and temperature biomarkers, ovulation timing.' } },
  { label: 'Diagnostics', browsable: true, pageDescriptor: 'Hormone panels, ultrasound, ovarian reserve, cycle charting.',
    tile: { name: 'Diagnostics', accent: 's', iconKey: 'Diagnostics', desc: 'Hormone panels, ultrasound, ovarian reserve, cycle charting as a diagnostic.' } },
  { label: 'Contraception/Comparison', browsable: true, pageDescriptor: 'Side effects, long-term outcomes, comparison studies.',
    tile: { name: 'Contraception', accent: 's', iconKey: 'Contraception', desc: 'Side effects, long-term outcomes, head-to-head comparisons.' } },
  // NaPro tile counts ONLY NaProTECHNOLOGY so the number matches the destination page (RRM Methods has its own page).
  { label: 'NaProTECHNOLOGY', browsable: true, pageDescriptor: 'Cumulative pregnancy rates, protocols, vs IVF.',
    tile: { name: 'NaProTECHNOLOGY', accent: 'p', iconKey: 'NaProTECHNOLOGY', desc: 'Protocols, cumulative pregnancy rates, restorative vs IVF.', match: ['NaProTECHNOLOGY'] } },
  { label: 'Fertility Awareness', browsable: true, pageDescriptor: 'Method efficacy, Creighton, Marquette, Billings, FEMM.',
    tile: { name: 'Fertility Awareness', accent: 'g', iconKey: 'Fertility Awareness', desc: 'Method efficacy: Creighton, Marquette, Billings, FEMM, sympto-thermal.' } },
  { label: 'Surgery', browsable: true, pageDescriptor: 'Excision, laparoscopy, fertility-sparing approaches.',
    tile: { name: 'Surgery', accent: 's', iconKey: 'Surgery', desc: 'Excision, laparoscopy, fertility-sparing reproductive surgery.' } },
  // browsable, no tile:
  { label: 'RRM Methods', browsable: true, pageDescriptor: 'Restorative protocols and outcomes.' },
  { label: 'Body Literacy', browsable: true, pageDescriptor: 'Understanding the cycle as a vital sign.' },
  { label: 'Perimenopause/Menopause', browsable: true, pageDescriptor: 'Hormonal transition, symptoms, restorative options.' },
  { label: 'Bone Health', browsable: true, pageDescriptor: 'Estrogen, bone density, contraceptive and lifecycle effects.' },
  { label: 'Andrology', browsable: true, pageDescriptor: 'Male-factor evaluation and treatment.' },
  { label: 'Postpartum', browsable: true, pageDescriptor: 'Recovery, breastfeeding, return of fertility.' },
];

export const GENERIC_DESCRIPTOR = 'Research articles on this topic in the RRM Academy library.';

// Demoted top-level topics — tag-only, no page. 301 -> /library/. (Brian + fusion verdict 2026-06-14.)
export const DEMOTED_SLUGS = [
  'reproductive-endocrinology', 'research-methodology',
  'general-ob-gyn', 'ethics-philosophy', 'patient-education',
];

// Derived (single registry -> no parallel maps to drift)
export const CATEGORY_ALLOWLIST = new Set(CATEGORIES.filter(c => c.browsable).map(c => c.label.toLowerCase()));
export const TOPIC_DESCRIPTORS: Record<string, string> =
  Object.fromEntries(CATEGORIES.map(c => [c.label, c.pageDescriptor]));
export const ATLAS_TILES = CATEGORIES.filter(c => c.tile).map(c => ({
  name: c.tile!.name, accent: c.tile!.accent, desc: c.tile!.desc, iconKey: c.tile!.iconKey,
  match: c.tile!.match ?? [c.label],
}));

// top-level topic = text before the first " > "
export function topLevelTopics(topics: unknown): string[] {
  const out: string[] = [];
  for (const t of (Array.isArray(topics) ? topics : [])) {
    const seg = String(t).split(' > ')[0].trim();
    if (seg && !out.includes(seg)) out.push(seg);
  }
  return out;
}

// Anti-RRM papers excluded from curated browse (pages + atlas counts + recent). Still
// published, searchable, individually reachable, and present in /library/?topic= and the
// JSONL feed by design. Self-maintaining: future hostile/critical papers auto-drop.
const EXCLUDED_SENTIMENTS = new Set(['hostile', 'critical']);
export function isCategorySafe(article: { sentiment?: string }): boolean {
  return !EXCLUDED_SENTIMENTS.has(String(article?.sentiment || '').toLowerCase());
}

export function topicSlug(topic: string): string {
  return topic
    .toLowerCase().replace(/\//g, '-').replace(/\s+&\s+/g, '-and-').replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
