/**
 * Blog data layer for RRM Academy Commentary.
 * Reads from cached posts.json (populated by fetch-blog-data.mjs from D1).
 */

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
  audioUrl: string;
  lastModified: string;
}

/**
 * Normalize image URLs to /api/assets/ proxy paths for R2 caching.
 * Handles absolute site URLs, relative static paths, and R2 public URLs.
 */
function normalizeImageUrl(url: string): string {
  if (!url) return url;
  const sitePrefix = 'https://rrmacademy.org/images/';
  if (url.startsWith(sitePrefix)) {
    return '/api/assets/' + url.slice(sitePrefix.length);
  }
  if (url.startsWith('/images/')) {
    return '/api/assets/' + url.slice('/images/'.length);
  }
  return url;
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
  try {
    const cached = await import('../data/posts.json');
    const posts = (cached.default || cached) as BlogPost[];
    for (const p of posts) p.coverImageUrl = normalizeImageUrl(p.coverImageUrl);
    console.log(`[blog] Loaded ${posts.length} posts from cache`);
    return sortByDate(posts);
  } catch (err: any) {
    throw new Error(`posts.json not found. Run: WORKER_AUTH_TOKEN=xxx npm run fetch-blog (blog uses WORKER_AUTH_TOKEN)`);
  }
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
