// OG image cache-busting version.
//
// Bump this when you change the satori template design (palette, typography,
// layout, fallback card). The version is appended as `?v=${OG_VERSION}` to
// every og:image URL emitted by BaseLayout.astro, which forces social
// scrapers (Facebook, LinkedIn, Twitter, iMessage, Slack) and the CF edge
// cache to re-fetch on their next unfurl.
//
// Why string, not number: lets us move to v2, v2a, v3, etc. if we need to
// invalidate only a subset of pages without a full bump.
export const OG_VERSION = 'v1';
