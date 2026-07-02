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
// v5 (2026-06-19): /providers/ became the fundraiser; OG cards are now derived
// per-page from the rendered HTML (scripts/augment-og-index.mjs). Bump forces
// scrapers to drop the stale provider-directory card cached at ?v=v4.
// v6 (2026-07-02): Save the Uterus Club OG card now features the Cuterus mascot
// (functions/og/[[path]].js buildStucTree). Bump re-unfurls the STUC card.
// v7 (2026-07-02): STUC card uses fixed short club copy so the hero title/desc
// don't wrap+clamp under the mascot. Bump re-unfurls the corrected card.
export const OG_VERSION = 'v7';
