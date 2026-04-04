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
  category: 'Foundational' | 'Condition-Specific' | 'Common Concerns';
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
