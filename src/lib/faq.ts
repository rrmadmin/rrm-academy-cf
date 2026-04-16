/**
 * FAQ data layer for RRM Academy.
 * Loads published FAQs from cached JSON (built by fetch-faq-data.mjs).
 */

export interface EvidenceLink {
  title: string;
  url: string;
  sortOrder?: number;
}

export interface LibraryRef {
  articleId: string;
  label?: string | null;
  sortOrder?: number;
  author?: string;
  year?: number | null;
  slug?: string;
  title?: string;
  shortCitation?: string;
}

export interface FAQ {
  id: string;
  faqId: string;
  slug: string;
  question: string;
  publishedAnswer: string;
  basicAnswer: string;
  schemaAnswer: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: number;
  status: string;
  category: 'Foundational' | 'Condition-Specific' | 'Common Concerns';
  updatedAt: string;
  createdAt: string;
  evidence: EvidenceLink[];
  libraryRefs: LibraryRef[];
}

export async function fetchAllFaqs(): Promise<FAQ[]> {
  try {
    const cached = await import('../data/faqs.json');
    const faqs = (cached.default || cached) as FAQ[];
    console.log(`[faq] Loaded ${faqs.length} FAQs from cache`);
    return faqs;
  } catch {
    throw new Error('faqs.json not found. Run: npm run fetch-faqs');
  }
}

/**
 * Group FAQs by category, preserving sortOrder within each group.
 */
export function groupByCategory(faqs: FAQ[]): { category: string; faqs: FAQ[] }[] {
  const groups: Record<string, FAQ[]> = {};

  for (const faq of faqs) {
    if (!groups[faq.category]) groups[faq.category] = [];
    groups[faq.category].push(faq);
  }

  // Fixed order: Foundational first, then Condition-Specific, then Common Concerns
  const order = ['Foundational', 'Condition-Specific', 'Common Concerns'];
  return order
    .filter(cat => groups[cat]?.length)
    .map(cat => ({ category: cat, faqs: groups[cat] }));
}

/**
 * Find related FAQs from the same category.
 */
export function getRelatedFaqs(faq: FAQ, allFaqs: FAQ[], limit = 5): FAQ[] {
  return allFaqs
    .filter(f => f.id !== faq.id && f.category === faq.category)
    .slice(0, limit);
}

export interface PillarCTA {
  href: string;
  label: string;
}

/**
 * Maps FAQ code (F01, C10, etc.) to a pillar-page CTA.
 * `null` means fall back to the generic Courses + Library block.
 * Unknown codes fall through to `null` via `?? null` at the call site.
 */
export const PILLAR_CTA_MAP: Record<string, PillarCTA | null> = {
  // /what-is-rrm/ — broad intro, clinical detail, cost/insurance/timeline
  F01: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F02: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F03: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F05: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F07: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F08: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F10: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F11: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F12: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F13: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F17: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F18: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  F20: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  C10: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },
  C35: { href: '/what-is-rrm/', label: 'Read the Restorative Reproductive Medicine guide' },

  // /naprotechnology/
  F04: { href: '/naprotechnology/', label: 'Read the NaProTechnology guide' },

  // /femm/ — comparison angle
  F22: { href: '/femm/', label: 'Compare fertility-awareness methods' },

  // /neofertility/ — consult-oriented
  F09: { href: '/neofertility/', label: 'Read the NeoFertility guide' },
  F15: { href: '/neofertility/', label: 'Read the NeoFertility guide' },

  // /common-questions-about-rrm — critic-response / skeptic-framed
  F06: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F16: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F21: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F23: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },
  F24: { href: '/common-questions-about-rrm', label: 'Read answers to common RRM questions' },

  // F14 (Do I need to be Catholic?) — deliberately null, uses fallback block
  F14: null,
};
