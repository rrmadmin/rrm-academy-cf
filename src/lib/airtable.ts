/**
 * Airtable data fetcher for RRM Research Library.
 * Fetches all BIFID records at build time and transforms them for Astro pages.
 */

const AIRTABLE_BASE_ID = 'appyZWo2G7iByXCgZ';
const BIFID_TABLE_ID = 'tbloxbruSGmhZ23BC';
const API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${BIFID_TABLE_ID}`;

// Fields to fetch from Airtable
const FIELDS = [
  '1️⃣ Title (static)',
  '1️⃣ Author(s)',
  '1️⃣ Year (static)',
  '1️⃣ Abstract (static)',
  '1️⃣ Journal (static)',
  '1️⃣ Journal Abbv (static)',
  '1️⃣ DOI (static)',
  '1️⃣ PMID (static)',
  '1️⃣ Source URL (static)',
  '1️⃣ SEO:Base-Slug (static)',
  '1️⃣ Date Published (static)',
  '1️⃣ Volume (static)',
  '1️⃣ Issue (static)',
  '1️⃣ Pages (static)',
  '1️⃣ Keywords (static)',
  '1️⃣ APA Citation (static)',
  '1️⃣ Vancouver Citation (static)',
  '1️⃣ MLA Citation (static)',
  '1️⃣ Topics (AI)',
  '1️⃣ Search Terms (AI)',
  '1️⃣ Approved or Not',
  'Enrichment Status',
  '1️⃣ Short Citation',
  '1️⃣ Identifier (static)',
];

export interface Article {
  id: string;
  slug: string;
  title: string;
  authors: string;
  shortCitation: string;
  year: number | null;
  abstract: string;
  journal: string;
  journalAbbv: string;
  doi: string;
  pmid: string;
  sourceUrl: string;
  datePublished: string;
  volume: string;
  issue: string;
  pages: string;
  keywords: string;
  apaCitation: string;
  vancouverCitation: string;
  mlaCitation: string;
  topics: string[];
  searchTerms: string[];
  enrichmentStatus: string;
  identifiers: string[];
  isOpenAccess: boolean;
  isCopyrighted: boolean;
}

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

function transformRecord(record: AirtableRecord): Article | null {
  const f = record.fields;

  const slug = f['1️⃣ SEO:Base-Slug (static)'];
  const title = f['1️⃣ Title (static)'];
  const enrichmentStatus = f['Enrichment Status'] || '';

  // Skip records without slug or title
  if (!slug || !title) return null;

  const keywords = f['1️⃣ Keywords (static)'] || '';
  const identifiers: string[] = Array.isArray(f['1️⃣ Identifier (static)'])
    ? f['1️⃣ Identifier (static)']
    : [];
  const isOpenAccess = identifiers.includes('Open Access');
  const isCopyrighted = identifiers.includes('©');

  // Parse topics — stored as comma-separated string
  const topicsRaw = f['1️⃣ Topics (AI)'] || '';
  const topics = topicsRaw
    ? topicsRaw.split('\n').map((t: string) => t.trim()).filter(Boolean)
    : [];

  // Parse search terms
  const searchTermsRaw = f['1️⃣ Search Terms (AI)'] || '';
  const searchTerms = searchTermsRaw
    ? searchTermsRaw.split('\n').map((t: string) => t.trim()).filter(Boolean)
    : [];

  return {
    id: record.id,
    slug: slug.trim(),
    title: title.replace(/\.\s*$/, ''), // Strip trailing period (PubMed artifact)
    authors: Array.isArray(f['1️⃣ Author(s)']) ? f['1️⃣ Author(s)'].join('; ') : (f['1️⃣ Author(s)'] || ''),
    shortCitation: f['1️⃣ Short Citation'] || '',
    year: f['1️⃣ Year (static)'] ? Number(f['1️⃣ Year (static)']) : null,
    abstract: f['1️⃣ Abstract (static)'] || '',
    journal: f['1️⃣ Journal (static)'] || '',
    journalAbbv: f['1️⃣ Journal Abbv (static)'] || '',
    doi: f['1️⃣ DOI (static)'] || '',
    pmid: f['1️⃣ PMID (static)'] || '',
    sourceUrl: f['1️⃣ Source URL (static)'] || '',
    datePublished: f['1️⃣ Date Published (static)'] || '',
    volume: f['1️⃣ Volume (static)'] || '',
    issue: f['1️⃣ Issue (static)'] || '',
    pages: f['1️⃣ Pages (static)'] || '',
    keywords,
    apaCitation: f['1️⃣ APA Citation (static)'] || '',
    vancouverCitation: f['1️⃣ Vancouver Citation (static)'] || '',
    mlaCitation: f['1️⃣ MLA Citation (static)'] || '',
    topics,
    searchTerms,
    enrichmentStatus,
    identifiers,
    isOpenAccess,
    isCopyrighted,
  };
}

export async function fetchAllArticles(): Promise<Article[]> {
  // Try cached JSON first (created by fetch-data.mjs)
  try {
    const cached = await import('../data/articles.json');
    const articles = (cached.default || cached) as Article[];
    if (articles.length > 0) {
      console.log(`[airtable] Loaded ${articles.length} articles from cache`);
      return articles;
    }
  } catch {
    // No cache file — fetch from API
  }

  const pat = import.meta.env.AIRTABLE_PAT || process.env.AIRTABLE_PAT;
  if (!pat) {
    throw new Error('AIRTABLE_PAT environment variable is required. Run: npm run fetch-data');
  }

  const articles: Article[] = [];
  let offset: string | undefined;

  // Filter: exclude DIS Approved + must have enrichment status
  const formula = encodeURIComponent(
    "AND({1️⃣ Approved or Not}!='DIS Approved',{Enrichment Status}!='')"
  );

  const fieldsParams = FIELDS.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');

  do {
    const url = `${API_URL}?${fieldsParams}&filterByFormula=${formula}&pageSize=100${
      offset ? `&offset=${offset}` : ''
    }`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Airtable API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    offset = data.offset;

    for (const record of data.records) {
      const article = transformRecord(record);
      if (article) articles.push(article);
    }
  } while (offset);

  // Sort by date published (newest first)
  articles.sort((a, b) => {
    if (!a.datePublished && !b.datePublished) return 0;
    if (!a.datePublished) return 1;
    if (!b.datePublished) return -1;
    return b.datePublished.localeCompare(a.datePublished);
  });

  return articles;
}

/**
 * Get all unique topics with article counts.
 */
export function getTopicCounts(articles: Article[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const article of articles) {
    for (const topic of article.topics) {
      counts.set(topic, (counts.get(topic) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Find related articles using weighted multi-signal scoring:
 *   topics (×3) + search terms (×1) + same journal (×2)
 * Tiebreaker: more recent articles rank higher.
 */
export function getRelatedArticles(
  article: Article,
  allArticles: Article[],
  limit = 4
): Article[] {
  if (article.topics.length === 0 && article.searchTerms.length === 0) return [];

  const topicSet = new Set(article.topics);
  const termSet = new Set(article.searchTerms.map(t => t.toLowerCase()));
  const journal = article.journal.toLowerCase();

  const scored = allArticles
    .filter(a => a.id !== article.id)
    .map(a => {
      const topicOverlap = a.topics.filter(t => topicSet.has(t)).length;
      const termOverlap = a.searchTerms.filter(t => termSet.has(t.toLowerCase())).length;
      const journalMatch = journal && a.journal.toLowerCase() === journal ? 1 : 0;
      return {
        article: a,
        score: (topicOverlap * 3) + (termOverlap * 1) + (journalMatch * 2),
      };
    })
    .filter(s => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Tiebreaker: prefer more recent
      const da = a.article.datePublished || '';
      const db = b.article.datePublished || '';
      return db.localeCompare(da);
    });

  return scored.slice(0, limit).map(s => s.article);
}
