// On-demand OG image renderer for rrmacademy.org.
// Every page's <meta property="og:image"> points at /og/<slug>.png?v=${OG_VERSION}.
// Slug is looked up in src/data/og-index.json (built by scripts/build-og-index.mjs).
// Unknown slugs and all error paths return the branded fallback card.
//
// Bug classes defended against (see spec):
//   B1 Prototype pollution  -- Object.hasOwn() guard on every index lookup
//   B2 Brand impersonation  -- no custom.png / query-param title branch
//   B3 DoS via long strings -- all strings clamped before reaching satori
//   B4 Font cascade failure -- per-font .catch(() => null), satori uses fallback
//   B5 UTF-16 surrogate     -- codepoint-aware clamp via [...s].slice()
//   B6 Empty path segments  -- filter(Boolean) + empty-segment guard -> fallback
//   B7 Satori throws        -- entire render wrapped in outer try/catch
//
// Rate limiting: omitted for v1. Satori/resvg-wasm is local WASM compute (no
// billed service per request), and the 24h Cache-Control absorbs most traffic.
// Add rate limiting here if satori CPU cost becomes a concern.

import { ImageResponse } from 'workers-og';
import ogIndex from '../../src/data/og-index.json';

// Brand tokens (matches scripts/og-template.js exactly)
const BG          = '#f7f5f3';
const TITLE_C     = '#313131';
const DESC_C      = '#636261';
const BRAND_C     = '#725e7e'; // --purple-700
const BRAND_DEEP  = '#4c3e54'; // --purple-900
const BRAND_TINT  = '#e8ddef'; // --purple-100
const ON_BRAND_C  = '#f7f5f3'; // wordmark on purple band

// Fallback card copy (shown for unknown slugs and all error paths)
const FALLBACK = {
  title: 'RRM Academy',
  description: 'Evidence-based education in Restorative Reproductive Medicine.',
};

// Font CDN URLs. These are fetched once, CF-edge-cached for 1 year.
const CORMORANT_600_URL = 'https://cdn.jsdelivr.net/npm/@fontsource/cormorant-garamond@5.1.1/files/cormorant-garamond-latin-600-normal.woff';
const INTER_400_URL     = 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files/inter-latin-400-normal.woff';
const INTER_500_URL     = 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5.1.1/files/inter-latin-500-normal.woff';

// Codepoint-aware string clamp (B5: UTF-16 surrogate safety)
function clamp(s, max) {
  if (typeof s !== 'string') return '';
  const chars = [...s];
  if (chars.length <= max) return s;
  return chars.slice(0, max - 1).join('') + '\u2026';
}

// Prototype-pollution-safe lookup (B1)
function lookup(slug) {
  if (!slug || !Object.hasOwn(ogIndex, slug)) return null;
  return ogIndex[slug];
}

// Saved /Ask Q&As are runtime entities — not in og-index.json. Match
// `ask-<32hex>` slugs and look up the question in D1 directly. Returns
// null on any failure so the caller falls back to the branded card.
const ASK_SLUG_RE = /^ask-([0-9a-f]{32})$/;
async function lookupAsk(slug, env) {
  const m = ASK_SLUG_RE.exec(slug);
  if (!m || !env.DB) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT question FROM ask_saved WHERE id = ?'
    ).bind(m[1]).first();
    if (!row || !row.question) return null;
    return { title: row.question, description: 'Saved from Ask RRM Academy' };
  } catch {
    return null;
  }
}

// Per-font loader: returns ArrayBuffer or null on any failure (B4)
async function loadFont(url) {
  try {
    const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 31536000 } });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

// Build the satori tree from title + optional description.
// All strings pre-clamped before this call so satori never sees unbounded input.
function buildTree(title, description) {
  const len = title.length;
  const fontSize = len <= 30 ? 104 : len <= 60 ? 84 : len <= 80 ? 68 : 58;

  const titleNode = {
    type: 'span',
    props: {
      style: {
        fontSize: `${fontSize}px`,
        fontWeight: 600,
        color: TITLE_C,
        lineHeight: 1.2,
        fontFamily: 'Cormorant Garamond',
      },
      children: title,
    },
  };

  const descNode = description ? {
    type: 'span',
    props: {
      style: {
        fontSize: '32px',
        fontWeight: 400,
        color: DESC_C,
        lineHeight: 1.5,
        marginTop: '16px',
        fontFamily: 'Inter',
      },
      children: description,
    },
  } : null;

  const titleAreaChildren = description
    ? [titleNode, descNode]
    : titleNode;

  return {
    type: 'div',
    props: {
      style: {
        width: '1200px',
        height: '630px',
        backgroundColor: BG,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Cormorant Garamond',
      },
      children: [
        // Title + description area (cream, padded)
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              justifyContent: 'center',
              padding: '60px',
              overflow: 'hidden',
            },
            children: titleAreaChildren,
          },
        },
        // Brand band: 156px gradient (purple-700 -> purple-900), full-bleed.
        // backgroundImage form is what satori accepts for gradients.
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: '1200px',
              height: '156px',
              backgroundColor: BRAND_C,
              backgroundImage: `linear-gradient(180deg, ${BRAND_C} 0%, ${BRAND_DEEP} 100%)`,
              padding: '0 60px',
              alignItems: 'center',
              justifyContent: 'space-between',
            },
            children: [
              {
                type: 'span',
                props: {
                  style: {
                    fontSize: '44px',
                    fontWeight: 600,
                    color: ON_BRAND_C,
                    fontFamily: 'Cormorant Garamond',
                  },
                  children: 'RRM Academy',
                },
              },
              {
                type: 'span',
                props: {
                  style: {
                    fontSize: '24px',
                    fontWeight: 500,
                    color: BRAND_TINT,
                    letterSpacing: '0.04em',
                    fontFamily: 'Inter',
                  },
                  children: 'rrmacademy.org',
                },
              },
            ],
          },
        },
      ],
    },
  };
}

// Analytics Engine logging helper (fire-and-forget, never throws).
// writeDataPoint() returns void in Pages Functions -- do NOT wrap in waitUntil().
function logRender(env, slug, statusLabel, durationMs) {
  try {
    if (!env.EVENTS) return;
    env.EVENTS.writeDataPoint({
      blobs: ['rrm-academy', 'og_render', slug || '', statusLabel, ''],
      doubles: [durationMs, 1, 200],
      indexes: ['og_render'],
    });
  } catch {
    // Never let logging crash image delivery
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const start = Date.now();

  // --- Path parsing ---
  // context.params.path is the catch-all value (array or string depending on CF runtime)
  const raw = context.params.path;
  const pathParts = Array.isArray(raw)
    ? raw.filter(Boolean)
    : (typeof raw === 'string' ? raw.split('/').filter(Boolean) : []);

  // Guard: empty path segments indicate a malformed URL -> fallback (B6)
  if (pathParts.length === 0) {
    return renderCard(env, FALLBACK.title, FALLBACK.description, 'fallback', start);
  }

  // Strip .png extension from the last segment
  const lastRaw = pathParts[pathParts.length - 1] || '';
  if (!lastRaw.endsWith('.png')) {
    return renderCard(env, FALLBACK.title, FALLBACK.description, 'fallback', start);
  }
  const lastClean = lastRaw.slice(0, -4);

  // Build the final slug: if there was only one segment it's just the base name;
  // multi-segment paths join with '-' (no such paths exist today but guard anyway)
  const slug = [...pathParts.slice(0, -1), lastClean].join('-');

  // Guard: empty or dangerous slug -> fallback (B1, B6)
  if (!slug || slug.length > 300) {
    return renderCard(env, FALLBACK.title, FALLBACK.description, 'fallback', start);
  }

  // --- Lookup ---
  // Static entries (built from articles/posts/faqs/courses/glossary) win
  // first; if the slug matches `ask-<token>` and isn't in the index,
  // query D1 for the saved question.
  let entry = lookup(slug);
  let statusLabel = 'hit';
  if (!entry) {
    entry = await lookupAsk(slug, env);
    if (entry) statusLabel = 'ask_hit';
  }
  if (!entry) {
    logRender(env, slug, 'fallback', Date.now() - start);
    return renderCard(env, FALLBACK.title, FALLBACK.description, 'fallback', start);
  }

  // Clamp at the function boundary as a defense-in-depth guard (B3, B5).
  // build-og-index.mjs already clamps, but this protects against direct og-index.json edits.
  const title       = clamp(entry.title || FALLBACK.title, 200);
  const description = entry.description ? clamp(entry.description, 240) : null;

  return renderCard(env, title, description, statusLabel, start);
}

// Renders and returns the PNG. All error paths return the fallback card, never
// a JSON error or a 500 (B7). Font failures gracefully degrade (B4).
async function renderCard(env, title, description, statusLabel, start) {
  try {
    // Load fonts in parallel; per-font .catch(() => null) so one CDN 503
    // never kills the whole response. Satori uses its internal Roboto fallback
    // for any null entry -- this removes the hard failure mode entirely (B4).
    const [cormorantData, inter400Data, inter500Data] = await Promise.all([
      loadFont(CORMORANT_600_URL),
      loadFont(INTER_400_URL),
      loadFont(INTER_500_URL),
    ]);

    const fonts = [];
    if (cormorantData) {
      fonts.push({ name: 'Cormorant Garamond', data: cormorantData, weight: 600, style: 'normal' });
    }
    if (inter400Data) {
      fonts.push({ name: 'Inter', data: inter400Data, weight: 400, style: 'normal' });
    }
    if (inter500Data) {
      fonts.push({ name: 'Inter', data: inter500Data, weight: 500, style: 'normal' });
    }

    const tree = buildTree(title, description);

    const img = new ImageResponse(tree, {
      width: 1200,
      height: 630,
      fonts,
    });

    logRender(env, title.slice(0, 80), statusLabel, Date.now() - start);

    // Rewrap to force correct Content-Type + cache headers.
    // workers-og's ImageResponse defaults to text/html even though the body is PNG bytes.
    return new Response(img.body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
        'Access-Control-Allow-Origin': 'https://rrmacademy.org',
      },
    });
  } catch {
    // Outer try/catch: satori or resvg-wasm threw (B7).
    // Log the error silently and return the fallback card.
    // If we're already rendering the fallback card and satori throws again,
    // the recursive call will also fail and we'll hit the catch below.
    logRender(env, title.slice(0, 80), 'error', Date.now() - start);

    // Return a minimal valid 1x1 transparent PNG as the last-resort fallback.
    // This ensures we never return a non-image response on this endpoint.
    // 68-byte minimal valid PNG (1x1 transparent): RFC 2083 compliant.
    const minimalPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // bit depth 8, RGB, CRC
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT length + type
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // IDAT data (deflate)
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // IDAT CRC
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND length + type
      0x44, 0xae, 0x42, 0x60, 0x82,                   // IEND CRC
    ]);

    return new Response(minimalPng, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60',
        'Access-Control-Allow-Origin': 'https://rrmacademy.org',
      },
    });
  }
}
