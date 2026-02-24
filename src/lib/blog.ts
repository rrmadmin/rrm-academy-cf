/**
 * Blog data layer for RRM Academy Commentary.
 * Fetches editorial commentary posts from cached JSON or Airtable API.
 */

const AIRTABLE_BASE_ID = 'app1CKV1heL0qH2Oz';
const AIRTABLE_TABLE_ID = 'tblS8q3XHj6mhwxvl';
const API_URL = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`;

const FIELDS = [
  'Title',
  'Slug',
  'Content',
  'Excerpt',
  'Author',
  'Content Pillar',
  'Processed Cover URL',
  'Actual Publish Date',
  'Status',
  'Word Count',
  'SEO Keywords',
];

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  contentPillar: string;
  coverImageUrl: string;
  publishDate: string;
  wordCount: number;
  seoKeywords: string;
}

interface AirtableRecord {
  id: string;
  fields: Record<string, any>;
}

function transformRecord(record: AirtableRecord): BlogPost | null {
  const f = record.fields;

  if (f['Status'] !== 'Published') return null;

  const slug = f['Slug'];
  const title = f['Title'];
  if (!slug || !title) return null;

  return {
    id: record.id,
    slug: slug.trim(),
    title: title.trim(),
    excerpt: f['Excerpt'] || '',
    content: f['Content'] || '',
    author: f['Author'] || '',
    contentPillar: f['Content Pillar'] || '',
    coverImageUrl: f['Processed Cover URL'] || '',
    publishDate: f['Actual Publish Date'] || '',
    wordCount: f['Word Count'] ? Number(f['Word Count']) : 0,
    seoKeywords: f['SEO Keywords'] || '',
  };
}

function sortByDate(posts: BlogPost[]): BlogPost[] {
  return [...posts].sort((a, b) => {
    if (!a.publishDate && !b.publishDate) return 0;
    if (!a.publishDate) return 1;
    if (!b.publishDate) return -1;
    return b.publishDate.localeCompare(a.publishDate);
  });
}

export async function fetchAllPosts(): Promise<BlogPost[]> {
  // Try cached JSON first
  try {
    const cached = await import('../data/posts.json');
    const posts = (cached.default || cached) as BlogPost[];
    console.log(`[blog] Loaded ${posts.length} posts from cache`);
    return sortByDate(posts);
  } catch (err: any) {
    if (err?.code !== 'ERR_MODULE_NOT_FOUND' && err?.message?.includes?.('JSON')) {
      throw new Error(`posts.json exists but is corrupt: ${err.message}`);
    }
  }

  const pat = import.meta.env.AIRTABLE_PAT || process.env.AIRTABLE_PAT;
  if (!pat) {
    throw new Error('AIRTABLE_PAT required. Run: npm run fetch-blog');
  }

  const posts: BlogPost[] = [];
  let offset: string | undefined;

  const formula = encodeURIComponent("{Status}='Published'");
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
      const post = transformRecord(record);
      if (post) posts.push(post);
    }
  } while (offset);

  return sortByDate(posts);
}

/**
 * Find related posts by content pillar match.
 */
export function getRelatedPosts(
  post: BlogPost,
  allPosts: BlogPost[],
  limit = 3
): BlogPost[] {
  if (!post.contentPillar) return [];

  return allPosts
    .filter(p => p.id !== post.id && p.contentPillar === post.contentPillar)
    .slice(0, limit);
}
