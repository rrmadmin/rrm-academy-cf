/**
 * Public, shareable per-event landing page.
 *
 * URL: /events/<slug>
 * Source: D1 community_post (channel='stuc', type='event')
 *
 * NOT auth-gated. Anonymous + non-member visitors see a "Join STUC" CTA;
 * STUC members see "Join Call" pointing at the Meet link.
 *
 * Returns full HTML with OG/Twitter tags and Event schema.org JSON-LD so
 * social/text-message link previews render the flyer + title + date.
 */
import { getSessionIdFromCookie, validateSession, roleAtLeast } from '../api/auth/_shared.js';

const SITE_ORIGIN = 'https://rrmacademy.org';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip any line that exposes joining credentials (Meet URL, dial-in, PIN).
// Members get the Meet link via the "Join Call" button (sourced from event_link);
// joining info MUST NOT appear in body, og:description, or JSON-LD.
const JOIN_INFO_PATTERNS = [
  /^\s*(?:google\s+meet|meet)\s*link\s*:.*$/im,
  /^\s*join\s+(?:via\s+)?google\s+meet\s*:.*$/im,
  /^\s*join\s+(?:the\s+)?call\s*:.*$/im,
  /^\s*dial(?:-?in)?\s*:.*$/im,
  /^\s*phone\s*:.*$/im,
  /^\s*pin\s*:.*$/im,
  /^.*meet\.google\.com.*$/im,
  /^.*tel\.meet.*$/im,
  /^\s*tel:.*$/im,
];

function scrubJoinInfo(text) {
  if (!text) return text;
  let out = text;
  for (const re of JOIN_INFO_PATTERNS) {
    out = out.replace(new RegExp(re.source, 'gim'), '');
  }
  // Catch any leftover bare meet URLs that weren't on their own line.
  out = out.replace(/https?:\/\/meet\.google\.com\/[A-Za-z0-9?=&-]+/gi, '');
  out = out.replace(/https?:\/\/tel\.meet\/[A-Za-z0-9?=&-]+/gi, '');
  // Collapse blank lines created by removals.
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

// Strip markdown image embeds, scrub join info, return chunked safe content.
function summarize(content, { scrub = true } = {}) {
  if (!content) return { title: '', description: '', firstImage: null, chunks: [] };
  let firstImage = null;
  const noImages = content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, _alt, src) => {
    if (!firstImage) firstImage = src;
    return '';
  });
  const cleaned = scrub ? scrubJoinInfo(noImages) : noImages;
  const chunks = cleaned.split('\n\n').map(s => s.trim()).filter(Boolean);
  const title = chunks[0] || '';
  const description = chunks.slice(1).join(' ').replace(/\s+/g, ' ').trim();
  return { title, description, firstImage, chunks };
}

function extractSpeaker(content) {
  const m = (content || '').match(/^\s*Speaker:\s*(.+?)\s*$/m);
  return m ? m[1].trim() : null;
}

// Render a body chunk with markdown link support: [label](url) -> <a>.
// Escapes everything else, only allows http/https URLs in hrefs.
function renderBodyChunk(text) {
  const safeUrl = (u) => {
    try {
      const p = new URL(u);
      if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
      return p.toString();
    } catch {
      return null;
    }
  };
  const MD_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  const tokens = [];
  let last = 0;
  let m;
  while ((m = MD_LINK.exec(text)) !== null) {
    if (m.index > last) tokens.push({ t: 'text', v: text.slice(last, m.index) });
    const url = safeUrl(m[2]);
    if (url) {
      tokens.push({ t: 'link', label: m[1], href: url });
    } else {
      tokens.push({ t: 'text', v: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ t: 'text', v: text.slice(last) });
  return tokens.map(tok => {
    if (tok.t === 'text') return escapeHtml(tok.v);
    return `<a class="link" href="${escapeHtml(tok.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(tok.label)}</a>`;
  }).join('');
}

function abs(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return SITE_ORIGIN + url;
  return SITE_ORIGIN + '/' + url;
}

// Same membership classification as requireMember in api/community/_shared.js,
// but non-blocking: returns 'staff' | 'member' | 'authenticated' | 'anonymous'.
async function classifyVisitor(request, env) {
  const sessionId = getSessionIdFromCookie(request);
  if (!sessionId) return { tier: 'anonymous', user: null };
  const session = await validateSession(env.DB, sessionId);
  if (!session) return { tier: 'anonymous', user: null };

  const user = await env.DB.prepare(
    'SELECT id, email, role, blocked, stripe_customer_id FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user || user.blocked) return { tier: 'anonymous', user: null };

  if (roleAtLeast(user.role, 'mod')) return { tier: 'staff', user };

  // Grandfathered Wix STUC label
  const stucLabel = await env.DB.prepare(
    "SELECT 1 FROM user_label WHERE user_id = ? AND label = 'Save the Uterus Club 🏷️' LIMIT 1"
  ).bind(user.id).first();
  if (stucLabel) return { tier: 'member', user };

  // Active Wix subscriber
  try {
    const wixSub = await env.DB.prepare(
      "SELECT 1 FROM wix_subscription WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND status = 'active' LIMIT 1"
    ).bind(user.id, user.email).first();
    if (wixSub) return { tier: 'member', user };
  } catch {
    // soft-fail: treat as authenticated, not member
  }

  // Stripe membership check is intentionally skipped for the page render
  // (would add 100-500ms per pageview). The CTA falls through to "authenticated"
  // and the "Join Call" path is gated client-side via /api/community/status when
  // the user clicks. Members not in user_label/wix_subscription will still get
  // the Meet link after that gate; non-members see "Upgrade to STUC".
  return { tier: 'authenticated', user };
}

function ctaForVisitor(tier, event) {
  const eventLink = event.event_link || '';
  const startMs = Date.parse(event.event_date);
  const isPast = Number.isFinite(startMs) && startMs < Date.now() - 60 * 60 * 1000;

  if (isPast) {
    if (tier === 'staff' || tier === 'member') {
      return {
        primaryHref: SITE_ORIGIN + '/community/events',
        primaryLabel: 'See member archive',
        secondaryHref: null,
        secondaryLabel: null,
        note: 'This event has ended. Members can find the recording in the community archive.',
      };
    }
    return {
      primaryHref: SITE_ORIGIN + '/save-the-uterus-club',
      primaryLabel: 'Join Save the Uterus Club to Watch',
      secondaryHref: SITE_ORIGIN + '/community/events',
      secondaryLabel: 'See all events',
      note: 'This event has ended. Save the Uterus Club members get the recording, transcript, and Gemini notes.',
    };
  }

  if (tier === 'staff' || tier === 'member') {
    return {
      primaryHref: eventLink || (SITE_ORIGIN + '/community/events'),
      primaryLabel: 'Join Call',
      primaryAttrs: 'target="_blank" rel="noopener noreferrer"',
      secondaryHref: SITE_ORIGIN + '/community/events',
      secondaryLabel: 'See all events',
      note: null,
    };
  }

  if (tier === 'authenticated') {
    return {
      primaryHref: SITE_ORIGIN + '/save-the-uterus-club',
      primaryLabel: 'Join Save the Uterus Club to Watch',
      secondaryHref: SITE_ORIGIN + '/community/events',
      secondaryLabel: 'See all events',
      note: 'Save the Uterus Club members attend live and get the recording, transcript, and Gemini notes afterward.',
    };
  }

  // anonymous
  return {
    primaryHref: SITE_ORIGIN + '/save-the-uterus-club',
    primaryLabel: 'Join Save the Uterus Club to Watch',
    secondaryHref: SITE_ORIGIN + '/login?redirect=' + encodeURIComponent('/events/' + (event.slug || '')),
    secondaryLabel: 'Already a member? Sign in',
    note: 'Save the Uterus Club members attend the live call and get the recording, transcript, and Gemini notes afterward. New members get instant access.',
  };
}

function formatDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  });
}

function renderHtml({ event, summary, speaker, visitor, cta, canonical, memberSummary }) {
  const title = event.title || summary.title || 'Save the Uterus Club Event';
  // summary.description is already scrubbed of Meet URL / dial / PIN.
  const description = (summary.description || `Live members-only call from Save the Uterus Club.`).slice(0, 300);
  const fullTitle = `${title} | Save the Uterus Club`;
  const ogImage = abs(event.og_image_url || summary.firstImage) || (SITE_ORIGIN + '/og/save-the-uterus-club.png?v=8');
  const startMs = Date.parse(event.event_date);
  const endMs = Number.isFinite(startMs) ? startMs + 60 * 60 * 1000 : null;
  const startISO = Number.isFinite(startMs) ? new Date(startMs).toISOString() : event.event_date;
  const endISO = endMs ? new Date(endMs).toISOString() : null;

  // CRITICAL: Never expose the Meet link in JSON-LD. location.url points at the
  // public landing page itself; the Meet link is gated behind STUC membership.
  const eventJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: title,
    description,
    startDate: startISO,
    endDate: endISO,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: {
      '@type': 'VirtualLocation',
      url: canonical,
    },
    image: ogImage,
    organizer: {
      '@type': 'Organization',
      name: 'Save the Uterus Club',
      url: SITE_ORIGIN + '/save-the-uterus-club',
    },
    offers: {
      '@type': 'Offer',
      url: SITE_ORIGIN + '/save-the-uterus-club',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/LimitedAvailability',
      validFrom: new Date().toISOString(),
    },
  };
  if (speaker) {
    eventJsonLd.performer = { '@type': 'Person', name: speaker };
  }

  // Member visitors see the full content (Meet link, dial, PIN). Everyone else
  // gets the scrubbed version. Chunks preserve the \n\n paragraph structure.
  const isMember = visitor && (visitor.tier === 'staff' || visitor.tier === 'member');
  const renderChunks = (isMember && memberSummary ? memberSummary : summary).chunks || [];
  // Chunk 0 is the title (rendered in <h1>), so skip it for the body.
  const bodyChunks = renderChunks.slice(1);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">

<meta property="og:title" content="${escapeHtml(fullTitle)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:site_name" content="RRM Academy">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta property="og:image:alt" content="${escapeHtml(title)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(fullTitle)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:site" content="@rrmacademy">

<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://rsms.me">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&display=swap">

<script type="application/ld+json">${JSON.stringify(eventJsonLd)}</script>

<style>
  :root {
    --color-bg: #fafaf6;
    --color-surface: #ffffff;
    --color-ink: #1d1d1b;
    --color-muted: #62625e;
    --color-accent: #6a3a4a;
    --color-accent-fg: #ffffff;
    --color-line: #e8e5dc;
    --font-display: 'Cormorant Garamond', Georgia, serif;
    --font-body: 'Inter', -apple-system, system-ui, sans-serif;
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-lg: 20px;
    --shadow-sm: 0 1px 2px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.04);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--font-body);
    background: var(--color-bg);
    color: var(--color-ink);
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  a { color: inherit; }
  .header {
    border-bottom: 1px solid var(--color-line);
    background: var(--color-surface);
    padding: 16px 24px;
  }
  .header__inner {
    max-width: 960px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px;
  }
  .header__brand {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 20px;
    text-decoration: none;
    color: var(--color-ink);
  }
  .header__nav { font-size: 14px; }
  .header__nav a { color: var(--color-muted); text-decoration: none; margin-left: 16px; }
  .header__nav a:hover { color: var(--color-ink); }

  .container {
    max-width: 720px;
    margin: 0 auto;
    padding: 32px 24px 64px;
  }
  .eyebrow {
    display: inline-block;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-accent);
    margin-bottom: 12px;
  }
  h1 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: clamp(28px, 4.5vw, 44px);
    line-height: 1.15;
    margin: 0 0 16px;
  }
  .meta {
    color: var(--color-muted);
    font-size: 16px;
    margin-bottom: 24px;
  }
  .meta__row { display: block; margin-bottom: 4px; }
  .flyer {
    width: 100%;
    height: auto;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    margin: 24px 0 32px;
    background: var(--color-line);
  }
  .body { margin: 0 0 8px; }
  .body p { margin: 0 0 18px; font-size: 17px; line-height: 1.65; }
  .body p:last-child { margin-bottom: 0; }
  .link, .body a {
    color: var(--color-accent);
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
    transition: color .12s ease;
    overflow-wrap: anywhere;
  }
  .link:hover, .body a:hover { color: #532e3b; text-decoration-thickness: 2px; }

  .cta {
    margin: 40px 0 0;
    padding: 24px;
    background: var(--color-surface);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
  }
  .cta__note { color: var(--color-muted); font-size: 15px; margin: 0 0 16px; }
  .cta__buttons { display: flex; flex-wrap: wrap; gap: 12px; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    padding: 12px 22px;
    border-radius: var(--radius-md);
    font-weight: 600;
    font-size: 15px;
    text-decoration: none;
    transition: transform .12s ease, background .12s ease;
    border: 1px solid transparent;
  }
  .btn--primary { background: var(--color-accent); color: var(--color-accent-fg); }
  .btn--primary:hover { background: #532e3b; }
  .btn--secondary { background: transparent; color: var(--color-ink); border-color: var(--color-line); }
  .btn--secondary:hover { background: var(--color-bg); }
  .btn:active { transform: translateY(1px); }

  .footer {
    margin-top: 64px;
    padding: 32px 24px;
    border-top: 1px solid var(--color-line);
    text-align: center;
    color: var(--color-muted);
    font-size: 13px;
  }
  .footer a { color: var(--color-muted); text-decoration: underline; }

  @media (max-width: 540px) {
    .container { padding: 24px 18px 48px; }
    .cta__buttons { flex-direction: column; }
    .btn { width: 100%; }
  }
</style>
</head>
<body>
<header class="header">
  <div class="header__inner">
    <a class="header__brand" href="${SITE_ORIGIN}/">RRM Academy</a>
    <nav class="header__nav">
      <a href="${SITE_ORIGIN}/save-the-uterus-club">Save the Uterus Club</a>
      <a href="${SITE_ORIGIN}/community/events">All events</a>
    </nav>
  </div>
</header>

<main class="container">
  <span class="eyebrow">Save the Uterus Club · Live event</span>
  <h1>${escapeHtml(title)}</h1>

  <div class="meta">
    <span class="meta__row"><strong>${escapeHtml(formatDate(event.event_date))}</strong></span>
    ${speaker ? `<span class="meta__row">Speaker: ${escapeHtml(speaker)}</span>` : ''}
  </div>

  ${event.og_image_url || summary.firstImage ? `<img class="flyer" src="${escapeHtml(abs(event.og_image_url || summary.firstImage))}" alt="${escapeHtml(title)}" loading="eager" fetchpriority="high">` : ''}

  ${bodyChunks.length ? `<div class="body">${bodyChunks.map(c => `<p>${renderBodyChunk(c)}</p>`).join('\n')}</div>` : ''}

  <section class="cta" aria-label="Attend this event">
    ${cta.note ? `<p class="cta__note">${escapeHtml(cta.note)}</p>` : ''}
    <div class="cta__buttons">
      <a class="btn btn--primary" href="${escapeHtml(cta.primaryHref)}" ${cta.primaryAttrs || ''}>${escapeHtml(cta.primaryLabel)}</a>
      ${cta.secondaryHref ? `<a class="btn btn--secondary" href="${escapeHtml(cta.secondaryHref)}">${escapeHtml(cta.secondaryLabel)}</a>` : ''}
    </div>
  </section>
</main>

<footer class="footer">
  <p>RRM Academy · <a href="${SITE_ORIGIN}/save-the-uterus-club">Save the Uterus Club</a> · <a href="${SITE_ORIGIN}/privacy-policy">Privacy</a> · <a href="${SITE_ORIGIN}/terms-of-use">Terms</a></p>
</footer>
</body>
</html>`;
}

export async function onRequestGet({ request, params, env }) {
  const slug = params.slug;
  if (!slug || typeof slug !== 'string' || slug.length > 200) {
    return new Response('Not Found', { status: 404 });
  }

  if (!env.DB) {
    return new Response('Service Unavailable', { status: 503 });
  }

  // Look up by slug first; fall back to id (UUID) for backward compatibility.
  let event;
  try {
    event = await env.DB.prepare(
      `SELECT id, slug, title, content, event_date, event_link, og_image_url, channel, type
       FROM community_post
       WHERE channel = 'stuc' AND type = 'event' AND (slug = ? COLLATE NOCASE OR id = ?)
       LIMIT 1`
    ).bind(slug, slug).first();
  } catch (err) {
    console.error('events page: D1 lookup failed:', err.message);
    return new Response('Service Unavailable', { status: 503 });
  }

  if (!event) {
    return new Response('Not Found', { status: 404 });
  }

  // Redirect /events/<uuid> -> /events/<slug> when the row has a real slug.
  if (event.slug && event.slug.toLowerCase() !== slug.toLowerCase()) {
    return Response.redirect(`${SITE_ORIGIN}/events/${event.slug}`, 301);
  }

  const summary = summarize(event.content, { scrub: true });        // public/meta
  const memberSummary = summarize(event.content, { scrub: false }); // member body
  const speaker = extractSpeaker(event.content);
  const visitor = await classifyVisitor(request, env);
  const cta = ctaForVisitor(visitor.tier, event);
  const canonical = `${SITE_ORIGIN}/events/${event.slug || event.id}`;

  const html = renderHtml({ event, summary, memberSummary, speaker, visitor, cta, canonical });

  // Cache must vary on cookie because content + CTA differ for members vs anonymous.
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'Vary': 'Cookie',
      'X-Robots-Tag': 'index, follow',
    },
  });
}
