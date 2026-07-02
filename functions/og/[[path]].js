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
import { CUTERUS_OG } from './_cuterus-image.js';

// Brand tokens (matches scripts/og-template.js exactly)
const BG          = '#f7f5f3';
const TITLE_C     = '#313131';
const DESC_C      = '#636261';
const BRAND_C     = '#725e7e'; // --purple-700, solid brand band
const BRAND_TINT  = '#e8ddef'; // --purple-100, URL text on band
const ON_BRAND_C  = '#f7f5f3'; // wordmark on band

// Provider-card badge tokens (mirror the detail-page hero pills + global.css).
const NPI_BG      = '#fef3c7'; // --amber-100
const NPI_FG      = '#b45309'; // --amber-700
const TELE_BG     = '#e8f5e9'; // --green-100
const TELE_FG     = '#2e7d32'; // --green-700
const LOC_C       = '#8a8784'; // muted location line

// Fallback card copy (shown for unknown slugs and all error paths)
const FALLBACK = {
  title: 'RRM Academy',
  description: 'Evidence-based education in Restorative Reproductive Medicine.',
};

// Branded fallback card render. Centralizes the fallback tree so every unknown
// slug / malformed path returns the same title + description card.
function renderFallback(env, start) {
  return renderCard(env, buildTree(FALLBACK.title, FALLBACK.description), FALLBACK.title, 'fallback', start);
}

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
const SUPPORTER_SLUG_RE = /^supporter-(\d{1,9})$/;
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
        // Brand band: 132px solid --purple-700, full-bleed.
        brandBand(),
      ],
    },
  };
}

// Save the Uterus Club card. Keeps the standard branding (cream bg, Cormorant
// title, Inter description, purple brand band) but features the Cuterus mascot
// prominently on the left. Image is an inlined JPEG data URI (CUTERUS_OG),
// flattened on the card BG so it blends without a visible edge.
function buildStucTree(title, description) {
  const contentChildren = [
    // Cuterus mascot, featured large at top (image is pre-cropped tight to the
    // mascot; 430x402 preserves the 940x880 crop aspect).
    {
      type: 'img',
      props: {
        src: CUTERUS_OG,
        width: 430,
        height: 402,
        style: { marginBottom: '6px' },
      },
    },
    {
      type: 'span',
      props: {
        style: { fontSize: '52px', fontWeight: 600, color: TITLE_C, lineHeight: 1.1, textAlign: 'center', fontFamily: 'Cormorant Garamond' },
        children: title,
      },
    },
  ];
  if (description) {
    contentChildren.push({
      type: 'span',
      props: {
        style: { fontSize: '26px', fontWeight: 400, color: DESC_C, lineHeight: 1.4, marginTop: '14px', textAlign: 'center', maxWidth: '900px', fontFamily: 'Inter' },
        children: description,
      },
    });
  }

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
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 60px',
              overflow: 'hidden',
            },
            children: contentChildren,
          },
        },
        brandBand(),
      ],
    },
  };
}

// Brand band (shared between the default card and the provider card). Returns
// the 132px solid --purple-700 footer with the wordmark + domain.
function brandBand() {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        width: '1200px',
        height: '132px',
        backgroundColor: BRAND_C,
        padding: '0 60px',
        alignItems: 'center',
        justifyContent: 'space-between',
      },
      children: [
        {
          type: 'span',
          props: {
            style: { fontSize: '44px', fontWeight: 600, color: ON_BRAND_C, fontFamily: 'Cormorant Garamond' },
            children: 'RRM Academy',
          },
        },
        {
          type: 'span',
          props: {
            style: { fontSize: '24px', fontWeight: 500, color: BRAND_TINT, letterSpacing: '0.04em', fontFamily: 'Inter' },
            children: 'rrmacademy.org',
          },
        },
      ],
    },
  };
}

// Supporter recognition badge (runtime slug `supporter-<seq>` + ?name=). The
// donor's display name is passed as a satori TEXT node only (satori renders
// strings as text, never markup); seq and name are clamped before this call.
function buildSupporterTree({ seq, name }) {
  const sub = name
    ? `${name} is building the verified directory of RRM-trained clinicians.`
    : 'Building the verified directory of RRM-trained clinicians.';
  return {
    type: 'div',
    props: {
      style: {
        width: '1200px', height: '630px', backgroundColor: BG,
        display: 'flex', flexDirection: 'column', fontFamily: 'Cormorant Garamond',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex', flexDirection: 'column', flexGrow: 1,
              justifyContent: 'center', padding: '60px', overflow: 'hidden',
            },
            children: [
              { type: 'span', props: {
                style: { fontSize: '28px', fontWeight: 500, color: BRAND_C, letterSpacing: '0.08em', fontFamily: 'Inter' },
                children: 'RRM CARE DIRECTORY' } },
              { type: 'span', props: {
                style: { fontSize: '128px', fontWeight: 600, color: TITLE_C, lineHeight: 1.1, marginTop: '8px', fontFamily: 'Cormorant Garamond' },
                children: `Supporter #${seq}` } },
              { type: 'span', props: {
                style: { fontSize: '38px', fontWeight: 400, color: DESC_C, lineHeight: 1.4, marginTop: '20px', fontFamily: 'Inter' },
                children: sub } },
            ],
          },
        },
        brandBand(),
      ],
    },
  };
}

// One pill badge for the provider card. bg/fg are token hexes; label is text.
function badgePill(label, bg, fg) {
  return {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        backgroundColor: bg,
        color: fg,
        fontSize: '24px',
        fontWeight: 600,
        fontFamily: 'Inter',
        padding: '8px 20px',
        borderRadius: '999px',
        marginRight: '16px',
      },
      children: label,
    },
  };
}

// Build the satori tree for a provider detail card (kind:'provider') or the
// provider hub (kind:'provider-hub'). Renders the provider name in Cormorant
// Garamond, a subtitle (specialty / methods) in Inter, a muted location line,
// and a badge row (NPI verified amber, Telehealth green). All strings are
// pre-clamped before this call.
function buildProviderTree(entry) {
  const isHub = entry.kind === 'provider-hub';
  const name = entry.title || FALLBACK.title;
  const subtitle = entry.subtitle || '';
  const location = isHub ? '' : (entry.location || '');

  const len = name.length;
  const fontSize = len <= 24 ? 96 : len <= 40 ? 80 : len <= 60 ? 64 : 54;

  const children = [
    {
      type: 'span',
      props: {
        style: { fontSize: `${fontSize}px`, fontWeight: 600, color: TITLE_C, lineHeight: 1.15, fontFamily: 'Cormorant Garamond' },
        children: name,
      },
    },
  ];

  if (subtitle) {
    children.push({
      type: 'span',
      props: {
        style: { fontSize: '32px', fontWeight: 400, color: DESC_C, lineHeight: 1.4, marginTop: '18px', fontFamily: 'Inter' },
        children: subtitle,
      },
    });
  }

  if (location) {
    children.push({
      type: 'span',
      props: {
        style: { fontSize: '28px', fontWeight: 500, color: LOC_C, lineHeight: 1.3, marginTop: '12px', fontFamily: 'Inter' },
        children: location,
      },
    });
  }

  const badges = [];
  if (!isHub && entry.verified) badges.push(badgePill('NPI verified', NPI_BG, NPI_FG));
  if (!isHub && entry.telehealth) badges.push(badgePill('Telehealth', TELE_BG, TELE_FG));
  if (badges.length > 0) {
    children.push({
      type: 'div',
      props: {
        style: { display: 'flex', marginTop: '32px' },
        children: badges,
      },
    });
  }

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
            children,
          },
        },
        brandBand(),
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
    return renderFallback(env, start);
  }

  // Strip .png extension from the last segment
  const lastRaw = pathParts[pathParts.length - 1] || '';
  if (!lastRaw.endsWith('.png')) {
    return renderFallback(env, start);
  }
  const lastClean = lastRaw.slice(0, -4);

  // Build the final slug: if there was only one segment it's just the base name;
  // multi-segment paths join with '-' (no such paths exist today but guard anyway)
  const slug = [...pathParts.slice(0, -1), lastClean].join('-');

  // Guard: empty or dangerous slug -> fallback (B1, B6)
  if (!slug || slug.length > 300) {
    return renderFallback(env, start);
  }

  // Supporter recognition badge: runtime slug `supporter-<seq>` with ?name=.
  // Not in og-index; intercept before the index lookup. The name is UNTRUSTED
  // -> clamped and passed as a satori text node only (never markup).
  const supMatch = SUPPORTER_SLUG_RE.exec(slug);
  if (supMatch) {
    const seq = clamp(supMatch[1], 9);
    const name = clamp(new URL(request.url).searchParams.get('name') || '', 40);
    return renderCard(env, buildSupporterTree({ seq, name }), `supporter-${seq}`, 'supporter_hit', start);
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
    return renderFallback(env, start);
  }

  // Clamp at the function boundary as a defense-in-depth guard (B3, B5).
  // build-og-index.mjs already clamps, but this protects against direct og-index.json edits.
  const title       = clamp(entry.title || FALLBACK.title, 200);

  // Provider directory entries (kind:'provider' / 'provider-hub') get a
  // dedicated card layout: name + subtitle + location + verified/telehealth
  // badge. Everything else uses the default title + description card.
  if (entry.kind === 'provider' || entry.kind === 'provider-hub') {
    const provEntry = {
      kind: entry.kind,
      title,
      subtitle: entry.subtitle ? clamp(entry.subtitle, 240) : '',
      location: entry.location ? clamp(entry.location, 80) : '',
      verified: Boolean(entry.verified),
      telehealth: Boolean(entry.telehealth),
    };
    return renderCard(env, buildProviderTree(provEntry), title, statusLabel, start);
  }

  const description = entry.description ? clamp(entry.description, 240) : null;

  // Save the Uterus Club: featured-Cuterus card. Same branding as the default
  // card, mascot foregrounded. Uses fixed short club copy (not the augmented
  // SEO title/meta description, which are too long for a hero card and clamp
  // mid-word beneath the 300px mascot).
  if (slug === 'save-the-uterus-club') {
    return renderCard(
      env,
      buildStucTree(
        'Save the Uterus Club',
        'A community for restorative reproductive medicine.'
      ),
      'save-the-uterus-club',
      statusLabel,
      start
    );
  }

  return renderCard(env, buildTree(title, description), title, statusLabel, start);
}

// Renders and returns the PNG from a pre-built satori tree. `logSlug` is the
// short string used for Analytics Engine logging. All error paths return the
// fallback card, never a JSON error or a 500 (B7). Font failures gracefully
// degrade (B4).
async function renderCard(env, tree, logSlug, statusLabel, start) {
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

    const img = new ImageResponse(tree, {
      width: 1200,
      height: 630,
      fonts,
    });

    logRender(env, String(logSlug || '').slice(0, 80), statusLabel, Date.now() - start);

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
    logRender(env, String(logSlug || '').slice(0, 80), 'error', Date.now() - start);

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
