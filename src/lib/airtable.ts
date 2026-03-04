/**
 * Airtable data fetcher for RRM Research Library.
 * Fetches all BIFID records at build time and transforms them for Astro pages.
 */
import { API_URL, FIELDS } from './airtable-config.mjs';

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
  oaType: string;
  license: string;
  oaUrl: string;
  accessLevel: 'open' | 'free' | 'restricted';
  sentiment: string;
  rrmRelevance: string;
  domain: string;
}

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

function transformRecord(record: AirtableRecord): Article | null {
  const f = record.fields;

  const slug = f['⚡️ SEO:Slug'];
  const title = f['⚡️ Title'];
  const enrichmentStatus = f['Sync to RRM Library'] || '';

  // Skip records without slug or title
  if (!slug || !title) return null;

  const oaFlag = f['⚡️ Is Open Access'] || '';
  const isOpenAccess = oaFlag === 'Open Access';
  const isCopyrighted = oaFlag === '©';
  const accessLevel: 'open' | 'free' | 'restricted' = isOpenAccess ? 'open' : 'restricted';
  // yellowbase has no 'free' (Bronze) tier — all non-OA records are 'restricted'

  return {
    id: record.id,
    slug: slug.trim().toLowerCase(),
    title: title.replace(/\.\s*$/, ''), // Strip trailing period (PubMed artifact)
    authors: f['⚡️ Author(s)'] || '',
    shortCitation: f['⚡️ Short Citation'] || '',
    year: f['⚡️ Year'] ? Number(f['⚡️ Year']) : null,
    abstract: f['⚡️ Abstract'] || '',
    journal: f['⚡️ Journal'] || '',
    journalAbbv: f['⚡️ Journal Abbv'] || '',
    doi: f['⚡️ DOI'] || '',
    pmid: '',
    sourceUrl: f['⚡️ Source URL'] || '',
    datePublished: f['⚡️ Date Published'] || '',
    volume: f['⚡️ Volume'] || '',
    issue: f['⚡️ Issue'] || '',
    pages: f['⚡️ Pages'] || '',
    keywords: f['⚡️ Keywords'] || '',
    apaCitation: f['⚡️ Citation'] || '',
    vancouverCitation: f['⚡️ Vancouver Citation'] || '',
    mlaCitation: f['⚡️ MLA Citation'] || '',
    topics: f['⚡️ Topics (AI)']
      ? f['⚡️ Topics (AI)'].split('\n').map((t: string) => t.trim()).filter(Boolean)
      : [],
    searchTerms: f['⚡️ Search Terms (AI)']
      ? f['⚡️ Search Terms (AI)'].split('\n').map((t: string) => t.trim()).filter(Boolean)
      : [],
    enrichmentStatus,
    identifiers: oaFlag ? [oaFlag] : [],
    isOpenAccess,
    isCopyrighted,
    oaType: '',
    license: '',
    oaUrl: '',
    accessLevel,
    sentiment: f['⚡️ Sentiment (AI)'] || '',
    rrmRelevance: f['⚡️ RRM Relevance (AI)'] || '',
    domain: f['⚡️ Domain (AI)'] || '',
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
  } catch (err: any) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      // No cache file — fall through to API fetch
    } else {
      throw new Error(`articles.json exists but failed to load: ${err?.message}`);
    }
  }

  const pat = import.meta.env.AIRTABLE_PAT || process.env.AIRTABLE_PAT;
  if (!pat) {
    throw new Error('AIRTABLE_PAT environment variable is required. Run: npm run fetch-data');
  }

  const articles: Article[] = [];
  let offset: string | undefined;

  // Filter: only records synced to the public library
  const formula = encodeURIComponent("{Sync to RRM Library}='Synced'");

  const fieldsParams = FIELDS.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');

  do {
    const url = `${API_URL}?${fieldsParams}&filterByFormula=${formula}&pageSize=100${
      offset ? `&offset=${offset}` : ''
    }`;

    let res: Response | undefined;
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${pat}` },
        });
        lastError = undefined;
        if (res.status !== 429) break;
      } catch (e: any) {
        lastError = e;
      }
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(r => setTimeout(r, delay));
    }

    if (lastError) throw lastError;
    if (!res || !res.ok) {
      const err = res ? await res.text() : 'No response';
      throw new Error(`Airtable API error ${res?.status}: ${err}`);
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
