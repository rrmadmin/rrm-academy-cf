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
import { getSessionIdFromCookie, validateSession } from '../api/auth/_shared.js';
import { requireMember } from '../api/community/_shared.js';
import { TRACKING_HEAD, TRACKING_BODY } from './_tracking.js';

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

/* ===========================================================================
 * JOINING-CREDENTIAL REDACTION -- SCOPE, AND THE RESIDUAL IT LEAVES OPEN
 * ===========================================================================
 *
 * WHAT IS DEFENDED
 * ----------------
 * A STUC event is typed by hand into an admin form. Whatever an author puts in
 * `title`, `content` or `speaker` is published on /events/<slug>, which is
 * anonymous-reachable, crawled and link-previewed. The one thing that must not
 * be published is the joining credential for the members-only call. Members get
 * the room from the "Join Call" button, sourced from the `event_link` column,
 * which never passes through the scrubber.
 *
 * WHAT THIS PASS CHANGED, AND WHAT IT DELIBERATELY DID NOT
 * -------------------------------------------------------
 * Three earlier attempts widened JOIN_INFO_PATTERNS -- more label words, digit
 * runs behind a label, bare meeting-room codes -- and all three were rejected in
 * review for the SAME reason: they destroyed legitimate content. The verified
 * casualties are on record, and each one is now a regression fixture in
 * test/events-page-over-redaction.test.js that must survive:
 *
 *   "Teams-Based Care in RRM"              scrubbed to the empty string
 *   "Video Call 2026"                      scrubbed to the empty string
 *   "Video call 2026-07-31 18:00 Eastern"  scrubbed to ":00 Eastern"
 *   "Room 1201-1204 fellowship intensive"  scrubbed to "fellowship intensive"
 *   "follicle-stimulating hormone"         deleted behind a conferencing label
 *   "two-week-old"                         deleted behind a conferencing label
 *   "endo-call-2026.jpg"                   a legitimate flyer, dropped
 *
 * A denylist over free prose, applied to fields that must never be destroyed, is
 * the wrong instrument, and three rounds of evidence say so. The label
 * vocabulary was therefore NOT widened. JOIN_INFO_PATTERNS below is byte-for-
 * byte what has been in production, and every rule added by this pass matches a
 * HOST or a URL, never English:
 *
 *   1. the IMAGE channel, judged on the parsed HOSTNAME alone;
 *   2. one canonical host form, so a trailing root dot cannot defeat a compare;
 *   3. the TITLE and SPEAKER channels, routed through the SAME unmodified
 *      patterns that already run on the body.
 *
 * A hostname is not English, so (1) and (2) have no over-redaction failure mode
 * by construction. (3) adds no new matcher at all; it only puts two previously
 * unscrubbed fields on the path of matchers that have been in production for
 * their whole life and have never been accused of eating prose.
 *
 * THE ONE COST (3) DOES CARRY, NAMED RATHER THAN HIDDEN
 * ----------------------------------------------------
 * A title or a speaker that INNOCENTLY matches one of the existing patterns is
 * now replaced instead of published: "Why we left meet.google.com" and
 * "Phone: a history of telemedicine" both fall through to the first content
 * chunk. That is the same treatment the body has always given the same strings,
 * it is bounded by a vocabulary of nine line-anchored patterns rather than by
 * free-text guessing, and the fallback is a real second source rather than a
 * blank. It is pinned as an accepted cost in
 * test/events-page-over-redaction.test.js so it is a decision on the record and
 * not a surprise. If a real event ever needs one of those titles, the fix is to
 * put the title in the column and the host in prose, not to widen anything.
 *
 * THE RESIDUAL, STATED PLAINLY
 * ----------------------------
 * Because the label vocabulary was not widened, A CREDENTIAL WRITTEN BEHIND AN
 * UNRECOGNISED LABEL IN PROSE IS STILL PUBLISHED TO NON-MEMBERS. "Passcode:
 * 987654", "Meeting ID: 987 6543 210", "Conference line: +1 555-020-1111" and a
 * bare "PIN: 445566" sitting mid-sentence rather than at the start of a line all
 * reach the rendered body, og:description, twitter:description, the meta
 * description and the JSON-LD. Nothing throws and nothing logs when that
 * happens. These are enumerated as executable evidence -- EV-L*, EV-A*, EV-N*,
 * EV-H*, EV-W1 in test/events-page-redaction.test.js and EV-X* in
 * test/events-page-adversarial.test.js -- so closing one turns a test red rather
 * than passing unnoticed.
 *
 * THE MITIGATION IS OPERATIONAL, NOT A REGEX
 * ------------------------------------------
 * Joining information belongs in the structured `event_link` column, which is
 * already correctly gated by membership and never rendered to a non-member. It
 * does not belong typed into the description, the title or the speaker field.
 * That is the durable fix: stop free text from carrying credentials at all. The
 * scrubber is the mitigation until then, and it is best-effort by construction.
 * The next attempt to widen it over prose should read the casualty list above
 * first.
 */

// Strip any line that exposes joining credentials (Meet URL, dial-in, PIN).
// Members get the Meet link via the "Join Call" button (sourced from event_link);
// joining info MUST NOT appear in body, og:description, or JSON-LD.
// UNCHANGED by the host/image pass -- see the scope note above.
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

/** Hosts that serve a meeting room. Matched on hostname, exact or subdomain. */
const CONFERENCING_HOSTS = [
  'meet.google.com', 'tel.meet', 'zoom.us', 'teams.microsoft.com',
  'teams.live.com', 'webex.com', 'meet.jit.si', 'whereby.com', 'chime.aws',
];

/**
 * ONE canonical form for a hostname, computed BEFORE any host rule compares
 * anything, so every present and future host rule inherits it instead of each
 * comparison having to remember.
 *
 * A fully-qualified domain name may carry a trailing root dot:
 * "meet.google.com." and "meet.google.com" address the same host, resolve the
 * same way, and a browser joins the room through either. The dot survives
 * URL.hostname, so it matched neither `host === known` nor
 * `host.endsWith('.' + known)` -- one typed character published the room. Same
 * defect class, and same fix, as the library worker's SSRF gate.
 *
 * Exactly ONE dot is stripped. Two or more leave an empty DNS label, which is
 * not a resolvable name and therefore not a working credential; collapsing them
 * would be inventing a host the author did not write.
 */
function normalizeHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

function isConferencingHost(hostname, pathname) {
  const host = normalizeHost(hostname);
  // g.co is Google's GENERAL shortener, so the whole host cannot be condemned;
  // only its /meet space is a room. The path is consulted here to match LESS,
  // never more -- it is the one narrowing exception to "the host decides".
  if ((host === 'g.co' || host === 'www.g.co') && /^\/meet(?:\/|$)/i.test(pathname || '')) return true;
  return CONFERENCING_HOSTS.some((known) => host === known || host.endsWith('.' + known));
}

/**
 * An <img> src is a credential only when its HOST serves meeting rooms.
 *
 * THE PATH AND THE FILENAME ARE NEVER CONSULTED. A filename is not prose:
 * "endo-call-2026.jpg" contains the word "call" and is a legitimate flyer, and
 * dropping it was one of the casualties that got the previous attempt rejected.
 * A src that resolves to meet.google.com is the room itself. Relative srcs
 * resolve against SITE_ORIGIN, so "/images/meet-the-team-2026.png" is judged on
 * rrmacademy.org and survives.
 *
 * A src that does not parse is NOT a credential. Failing closed here would mean
 * dropping an author's image on the strength of a typo, and an unparseable URL
 * is not a room anyone can join -- no resolver answers it and no browser follows
 * it. It is rendered escaped like any other src, and the fallback chain in
 * renderHtml() still guarantees og:image is non-empty.
 */
function isCredentialImageUrl(src) {
  if (!src) return false;
  try {
    const parsed = new URL(String(src).trim(), SITE_ORIGIN);
    return isConferencingHost(parsed.hostname, parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * The first candidate that is present and is not merely whitespace, trimmed.
 *
 * This is the single mechanism behind "no required field may be emptied by
 * scrubbing", so the guard is one function with one behaviour rather than three
 * `||` chains that each have to remember that `'   '` is truthy. Returns '' only
 * when every candidate is blank, and every call site ends its list with a
 * non-empty constant.
 */
function firstNonEmpty(...candidates) {
  for (const candidate of candidates) {
    const value = candidate == null ? '' : String(candidate).trim();
    if (value) return value;
  }
  return '';
}

/** The last resorts. Each is the terminal element of a fallback chain below. */
const FALLBACK_DESCRIPTION = 'Live members-only call from Save the Uterus Club.';
const FALLBACK_OG_IMAGE = SITE_ORIGIN + '/og/save-the-uterus-club.png?v=8';

/**
 * The title is REQUIRED: it is the <h1>, the <title>, og:title, og:image:alt,
 * the JSON-LD name, the .ics SUMMARY and the Google Calendar text= parameter.
 * Scrubbing it can empty it, so it falls back to the scrubbed first content
 * chunk and then to a constant.
 *
 * The last resort is a constant and NOT the unscrubbed column. That is
 * deliberate: there is no input on which scrubbing empties this field for an
 * innocent reason, because reaching blank requires the whole title to have
 * matched a credential rule -- so "fall back to what was there before" would
 * fall back onto the credential just removed.
 *
 * `fallback` is supplied by the caller rather than baked in because the page and
 * the .ics differ in one letter of casing, and both are pinned by tests.
 */
function safeTitle(rawTitle, summaryTitle, fallback) {
  return firstNonEmpty(scrubJoinInfo(rawTitle), summaryTitle, fallback);
}

/**
 * The speaker reaches the meta row, the JSON-LD performer, the Google Calendar
 * details and the .ics DESCRIPTION -- all shared, cacheable, tier-agnostic
 * surfaces. Both arms of `event.speaker || extractSpeaker(content)` go through
 * the SAME unmodified patterns the body already runs. Not a required field: an
 * omitted row is correct where an empty one is not, hence null rather than ''.
 */
function scrubSpeaker(value) {
  if (!value) return null;
  return scrubJoinInfo(value).trim() || null;
}

// Strip markdown image embeds, scrub join info, return chunked safe content.
function summarize(content, { scrub = true } = {}) {
  if (!content) return { title: '', description: '', firstImage: null, chunks: [] };
  let firstImage = null;
  const noImages = String(content).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, _alt, src) => {
    // firstImage becomes og:image, twitter:image, the JSON-LD image and the
    // rendered flyer, and it is captured HERE, before scrubJoinInfo ever runs.
    // The markdown LINK form of the same URL is already fully redacted, so a
    // markdown IMAGE whose src is the room was one "!" away from safe.
    if (!firstImage && !(scrub && isCredentialImageUrl(src))) firstImage = src;
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

// Member determination delegates to requireMember (api/community/_shared.js) so the
// event page can never drift from the canonical gate. requireMember handles staff,
// the grandfather allowlist, active+recent Wix subs, and the authoritative live-Stripe
// check (KV-cached 300s). Non-members fall back to authenticated/anonymous for CTA copy.
async function classifyVisitor(request, env) {
  const auth = await requireMember(request, env);
  if (!(auth instanceof Response)) {
    return { tier: auth.tier === 'staff' ? 'staff' : 'member', user: auth.user };
  }
  // Not a member — distinguish authenticated (logged-in non-member) from anonymous,
  // so the CTA shows "Upgrade to STUC" vs "Join STUC", without exposing the Meet link.
  const sessionId = getSessionIdFromCookie(request);
  const session = sessionId ? await validateSession(env.DB, sessionId) : null;
  if (!session) return { tier: 'anonymous', user: null };
  const user = await env.DB.prepare(
    'SELECT id, email, role, blocked FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user || user.blocked) return { tier: 'anonymous', user: null };
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
      note: 'This event has ended. Save the Uterus Club is creating a different kind of healthcare model — members get the full recording, transcript, and Gemini notes from every call.',
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
      note: 'Members attend the live call and get the recording, transcript, and Gemini notes afterward.',
    };
  }

  // anonymous
  return {
    primaryHref: SITE_ORIGIN + '/save-the-uterus-club',
    primaryLabel: 'Join Save the Uterus Club to Watch',
    secondaryHref: SITE_ORIGIN + '/login?redirect=' + encodeURIComponent('/events/' + (event.slug || '')),
    secondaryLabel: 'Already a member? Sign in',
    note: 'Save the Uterus Club is creating a different kind of healthcare model — one where the uterus isn\'t blamed for every problem and women get real answers. Members attend the live call and get the recording, transcript, and Gemini notes.',
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
  }) + ' Eastern';
}

// --- Add-to-calendar helpers ---
// Mirrors the community events-tab Google-template pattern (src/pages/community/events.astro)
// and adds an iCalendar (.ics) for Apple/Outlook. Calendar entries are tier-agnostic and
// deliberately DO NOT embed the Meet link -- they point at the public events page, where
// members get the gated Join button. Keeps the "Meet link never leaves the gate" rule.
function toICalUTC(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
function buildGoogleCalUrl({ title, startMs, endMs, details, location }) {
  const params = 'action=TEMPLATE' +
    '&text=' + encodeURIComponent(title || 'Save the Uterus Club event') +
    '&dates=' + toICalUTC(startMs) + '/' + toICalUTC(endMs) +
    '&details=' + encodeURIComponent(details || '') +
    '&location=' + encodeURIComponent(location || '');
  return 'https://calendar.google.com/calendar/render?' + params;
}
function icsEscape(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function buildICS({ uid, title, startMs, endMs, description, location, url }) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RRM Academy//Save the Uterus Club//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsEscape(uid)}`,
    `DTSTAMP:${toICalUTC(Date.now())}`,
    `DTSTART:${toICalUTC(startMs)}`,
    `DTEND:${toICalUTC(endMs)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(location)}`,
    `URL:${icsEscape(url)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';
}

function renderHtml({ event, summary, speaker, visitor, cta, canonical, memberSummary }) {
  const title = safeTitle(event.title, summary.title, 'Save the Uterus Club Event');
  // summary.description is already scrubbed of Meet URL / dial / PIN. A
  // description that scrubs away entirely takes the generic line rather than
  // publishing an empty meta description and og:description.
  const description = firstNonEmpty(summary.description, FALLBACK_DESCRIPTION).slice(0, 300);
  const fullTitle = `${title} | Save the Uterus Club`;
  // og_image_url is judged on its HOST, not its filename. A src that is blank or
  // whitespace is ABSENT, not a relative URL to "   ".
  const columnImage = firstNonEmpty(event.og_image_url);
  const flyerSrc = firstNonEmpty(
    isCredentialImageUrl(columnImage) ? '' : columnImage,
    summary.firstImage
  ) || null;
  const ogImage = abs(flyerSrc) || FALLBACK_OG_IMAGE;
  const startMs = Date.parse(event.event_date);
  const endMs = Number.isFinite(startMs) ? startMs + 60 * 60 * 1000 : null;
  const startISO = Number.isFinite(startMs) ? new Date(startMs).toISOString() : event.event_date;
  const endISO = endMs ? new Date(endMs).toISOString() : null;

  // Add-to-calendar links (tier-agnostic; entry points at the public events page, not the Meet link).
  const eventsUrl = `${SITE_ORIGIN}/events/${event.slug || event.id}/`;
  const calDescription = `Save the Uterus Club live call${speaker ? ` with ${speaker}` : ''}. Join live inside Save the Uterus Club: ${eventsUrl}`;
  const gcalUrl = Number.isFinite(startMs) ? buildGoogleCalUrl({ title, startMs, endMs, details: calDescription, location: eventsUrl }) : null;
  const icsHref = `/events/${event.slug || event.id}/?add=ics`;

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

  // Members + staff see the full content (Meet URL, dial, PIN rendered as
  // styled clickable links). Non-members and anonymous get the scrubbed
  // version. og:description / twitter / JSON-LD always use the scrubbed
  // summary regardless of visitor.
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
<meta name="twitter:site" content="@rrm_academy">

<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://rsms.me">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600&display=swap">
${TRACKING_HEAD}

<script type="application/ld+json">${JSON.stringify(eventJsonLd).replace(/</g, '\\u003c')}</script>

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
  .cta__cal { margin: 16px 0 0; display: flex; align-items: center; flex-wrap: wrap; gap: 8px 14px; font-size: 14px; }
  .cta__cal-label { color: var(--color-muted); font-weight: 600; }
  .cta__cal-link { color: var(--color-accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
  .cta__cal-link:hover { color: #532e3b; text-decoration-thickness: 2px; }

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

  ${flyerSrc ? `<img class="flyer" src="${escapeHtml(abs(flyerSrc))}" alt="${escapeHtml(title)}" loading="eager" fetchpriority="high">` : ''}

  ${bodyChunks.length ? `<div class="body">${bodyChunks.map(c => `<p>${renderBodyChunk(c)}</p>`).join('\n')}</div>` : ''}

  <section class="cta" aria-label="Attend this event">
    ${cta.note ? `<p class="cta__note">${escapeHtml(cta.note)}</p>` : ''}
    <div class="cta__buttons">
      <a class="btn btn--primary" href="${escapeHtml(cta.primaryHref)}" ${cta.primaryAttrs || ''}>${escapeHtml(cta.primaryLabel)}</a>
      ${cta.secondaryHref ? `<a class="btn btn--secondary" href="${escapeHtml(cta.secondaryHref)}">${escapeHtml(cta.secondaryLabel)}</a>` : ''}
    </div>
    ${gcalUrl ? `<div class="cta__cal">
      <span class="cta__cal-label">Add to calendar</span>
      <a class="cta__cal-link" href="${escapeHtml(gcalUrl)}" target="_blank" rel="noopener noreferrer">Google</a>
      <a class="cta__cal-link" href="${escapeHtml(icsHref)}">Apple / Outlook</a>
    </div>` : ''}
  </section>
</main>

<footer class="footer">
  <p>RRM Academy · <a href="${SITE_ORIGIN}/save-the-uterus-club">Save the Uterus Club</a> · <a href="${SITE_ORIGIN}/privacy-policy">Privacy</a> · <a href="${SITE_ORIGIN}/terms-of-use">Terms</a></p>
</footer>
${TRACKING_BODY}
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
      `SELECT id, slug, title, content, event_date, event_link, og_image_url, channel, type, speaker
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

  // summary: scrubbed (used for og/twitter/JSON-LD AND non-member body).
  // memberSummary: full content (used only for member/staff body rendering).
  const summary = summarize(event.content, { scrub: true });
  const memberSummary = summarize(event.content, { scrub: false });
  // BOTH arms are scrubbed. extractSpeaker used to read RAW content, and the
  // other arm was the raw `speaker` column, so a Meet URL typed beside a speaker
  // name reached the meta row, JSON-LD performer.name, the gcal details and the
  // .ics -- none of which the body scrubbing ever touched.
  const speaker = scrubSpeaker(event.speaker) || scrubSpeaker(extractSpeaker(scrubJoinInfo(event.content)));

  // Calendar download: /events/<slug>/?add=ics -> .ics (tier-agnostic; no Meet link).
  // Lightweight path -- skips visitor classification (no Stripe/KV) entirely.
  if (new URL(request.url).searchParams.get('add') === 'ics') {
    const sMs = Date.parse(event.event_date);
    if (!Number.isFinite(sMs)) return new Response('Not Found', { status: 404 });
    const eMs = sMs + 60 * 60 * 1000;
    const evUrl = `${SITE_ORIGIN}/events/${event.slug || event.id}/`;
    const desc = `Save the Uterus Club live call${speaker ? ` with ${speaker}` : ''}. Join live inside Save the Uterus Club: ${evUrl}`;
    const ics = buildICS({
      uid: `stuc-${event.slug || event.id}@rrmacademy.org`,
      // Same fallback chain as the <h1>: a title that scrubs to nothing needs
      // the same non-empty second source in both places, or the page says one
      // thing and the calendar entry another.
      title: safeTitle(event.title, summary.title, 'Save the Uterus Club event'),
      startMs: sMs, endMs: eMs, description: desc, location: evUrl, url: evUrl,
    });
    const fname = (event.slug || 'event').replace(/[^a-z0-9-]/gi, '') || 'event';
    return new Response(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fname}.ics"`,
        'Cache-Control': 'public, max-age=3600',
        'X-Robots-Tag': 'noindex',
      },
    });
  }

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
