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
 * JOINING-CREDENTIAL REDACTION
 * ===========================================================================
 *
 * WHAT THIS DEFENDS AGAINST
 * -------------------------
 * A STUC event is authored by hand in an admin form. Anything an author types
 * into `title`, `content` or `speaker` is published on /events/<slug>, which is
 * anonymous-reachable, crawled and link-previewed. The one thing that must not
 * be published is the joining credential for the members-only call: the Meet /
 * Zoom / Teams room URL, the dial-in number, the PIN or passcode. Members get
 * the room a different way -- the "Join Call" button, sourced from the
 * `event_link` column, which never passes through here.
 *
 * WHAT THIS CANNOT DEFEND AGAINST, STATED PLAINLY
 * -----------------------------------------------
 * This is a DENYLIST over free text, and a denylist over free text is
 * best-effort by construction. It matches a fixed vocabulary of labels and a
 * fixed set of conferencing hosts. An author who invents a phrasing outside
 * that vocabulary, spells a credential out in words ("the pin is nine nine
 * eight..."), splits it across a blank line, or hosts the call somewhere not in
 * CONFERENCING_HOSTS, will publish it. Nothing throws and nothing logs when
 * that happens. The structural fix is to stop free text from carrying
 * credentials at all -- the `event_link` column already models the room
 * properly -- and this function is the mitigation until then, not a guarantee.
 * Known residual gaps are enumerated in test/events-page-redaction.test.js.
 *
 * THE RULE, AND WHY IT IS THE RULE
 * --------------------------------
 * A LABEL ALONE IS NOT A CREDENTIAL. Nothing is removed for containing the word
 * "room", "call", "zoom", "teams", "dial" or "phone". Those words are ordinary
 * in reproductive-medicine copy -- "room temperature storage", "Teams-Based
 * Care in RRM", "Zoom fatigue in telehealth", "we will call you". A label is
 * removed only when it is FOLLOWED BY A CREDENTIAL-SHAPED VALUE: a URL, a tel:
 * URI, or a run of at least six digits that is not a date. Requiring the value
 * is what separates a credential from prose, and it is also what keeps every
 * matcher below anchored and linear. test/events-page-over-redaction.test.js
 * pins that half of the contract and must stay green.
 *
 * IMAGE URLS ARE JUDGED ON THE HOST, NEVER THE PATH
 * -------------------------------------------------
 * A filename is not prose. "endo-call-2026.jpg" contains the word "call" and is
 * a legitimate flyer. An <img> whose src resolves to meet.google.com is the
 * room itself. Only the parsed hostname decides.
 *
 * COST
 * ----
 * Every pass is a single global regex over the input with no nested quantifier
 * and no overlapping alternation, so the work is linear in input length. That
 * matters more here than in most places: this page is unauthenticated and
 * crawled, so a super-linear matcher is a denial-of-service primitive that any
 * visitor can aim at it.
 */

/** Marks a span the scrubber removed, so line cleanup stays scoped to it. */
const REDACTED_MARK = '\u0000';

/**
 * Zero-width and BOM characters, removed before matching. A credential pasted
 * out of a rich-text editor can carry one INSIDE a hostname
 * ("meet.goo<ZWSP>gle.com"), which defeats any literal host match. They are
 * invisible, so dropping them changes nothing a reader sees.
 */
const ZERO_WIDTH_RE = /[\u00AD\u200B-\u200F\u2060\uFEFF]/g;

/** Hosts that serve a meeting room. Matched on hostname, exact or subdomain. */
const CONFERENCING_HOSTS = [
  'meet.google.com', 'tel.meet', 'zoom.us', 'teams.microsoft.com',
  'teams.live.com', 'webex.com', 'meet.jit.si', 'whereby.com', 'chime.aws',
];

function isConferencingHost(hostname, pathname) {
  const host = String(hostname || '').toLowerCase();
  // g.co is Google's generic shortener; only its /meet space is a Meet room.
  if ((host === 'g.co' || host === 'www.g.co') && /^\/meet(?:\/|$)/i.test(pathname || '')) return true;
  return CONFERENCING_HOSTS.some((known) => host === known || host.endsWith('.' + known));
}

/**
 * The label vocabulary, in two tiers, because the tiers earn different trust.
 *
 * STRONG labels are compound or technical: "Meeting ID", "Passcode", "Dial-in".
 * They essentially never precede a number in clinical prose, so a short digit
 * run behind one is still a credential -- a five-digit PIN is a real PIN.
 *
 * WEAK labels are ordinary English words that happen to also name a product or
 * a channel: "room", "call", "zoom", "teams", "phone", "meet". They appear
 * constantly in reproductive-medicine copy, so a digit run behind one must be
 * long enough to be a phone number or a PIN before anything is removed. This is
 * the distinction whose absence made the previous attempt delete a clinician
 * talk titled "Teams-Based Care in RRM".
 *
 * Longest form first inside each tier, and STRONG before WEAK overall, so
 * "dial-in" is not consumed by "dial" nor "phone number" by "phone".
 */
const STRONG_JOIN_LABELS = [
  'google\\s+meet\\s+link', 'google\\s+meet',
  'meeting\\s+link', 'meeting\\s+url', 'meeting\\s+id', 'meeting\\s+number',
  'meet\\s+link', 'meet\\s+url',
  'video\\s+call', 'video\\s+link',
  'join\\s+here', 'join\\s+link', 'join\\s+url', 'join\\s+the\\s+call', 'join\\s+call',
  'conference\\s+line', 'conference\\s+bridge', 'conference\\s+id',
  'access\\s+code', 'passcode', 'pass\\s+code', 'pin\\s+code',
  'phone\\s+number',
  'dial-in', 'dial\\s+in', 'dialin',
  'call-in', 'call\\s+in', 'callin',
  // "PIN" is strong despite being a common verb: the verb never takes a number
  // ("pin the reading list"), and a five-digit PIN is still a PIN.
  'pin',
];
const WEAK_JOIN_LABELS = [
  'telephone', 'webex', 'zoom', 'teams', 'room', 'phone', 'call', 'meet', 'dial', 'tel',
];
const JOIN_LABELS = [...STRONG_JOIN_LABELS, ...WEAK_JOIN_LABELS];
const IS_STRONG_LABEL_RE = new RegExp(`^(?:${STRONG_JOIN_LABELS.join('|')})$`, 'i');

/** Everything up to whitespace or a closing delimiter. One character class. */
const URL_TAIL = '[^\\s<>"\'\\)\\]]';
const URL_VALUE = `(?:https?:\\/\\/|www\\.)${URL_TAIL}+`;
const TEL_VALUE = 'tel:\\+?\\d[\\d \\t().-]*';
/** Phone/PIN shaped. Deliberately excludes line breaks; validated in the replacer. */
const NUM_VALUE = '\\+?\\d[\\d \\t().-]*\\d';

/**
 * Label-to-value separator: punctuation and horizontal whitespace, optionally
 * crossing exactly ONE line break so the form where an author puts the label on
 * one line and the credential on the next is caught. Two flat character classes
 * either side of a mandatory break -- one backtracking chain each, no nesting.
 */
const SEP = '[ \\t:\uFF1A=>|#*_~\\-\u2013\u2014]*(?:\\r?\\n[ \\t>*_\\-]*)?';

/**
 * A URL broken across a soft line wrap, in the middle of the meeting CODE. Only
 * consumed when the token above ended mid-token (on a hyphen or a slash) AND
 * the next line starts with a hyphenated code fragment, so an ordinary
 * following sentence is never eaten.
 */
const CODE_WRAP = '(?<=[-\\/])\\r?\\n[a-z0-9]+-[a-z0-9-]*[a-z0-9]';
const WRAP_TAIL = `(?:${CODE_WRAP})?`;

/**
 * The same wrap, broken in the middle of the HOST ("https://meet.<newline>
 * google.com/abc"). Safe to be greedier here than in the label rule: this tail
 * is only used by URL_TOKEN_RE, whose replacer re-parses the joined token and
 * puts it back untouched when the resulting host is not a conferencing host.
 */
const HOST_WRAP = `(?<=\\.)\\r?\\n[a-z0-9-]+\\.[a-z]{2,}(?:\\/${URL_TAIL}*)?`;
const URL_WRAP_TAIL = `(?:${CODE_WRAP}|${HOST_WRAP})?`;

/**
 * A label immediately followed by something credential-shaped. Group 1 is the
 * BASE label, so an optional qualifier ("Dial-in NUMBER", "PIN CODE") widens
 * what matches without changing how much the label is trusted.
 */
const LABEL_QUALIFIER = '(?:\\s+(?:number|code|id|link|url|details|info))?';
const LABELLED_CREDENTIAL_RE = new RegExp(
  `\\b(${JOIN_LABELS.join('|')})${LABEL_QUALIFIER}\\b${SEP}`
  + `(?:${URL_VALUE}${WRAP_TAIL}|${TEL_VALUE}|${NUM_VALUE})`,
  'gi'
);
/** Any URL token. The replacer keeps it unless its HOST serves meeting rooms. */
const URL_TOKEN_RE = new RegExp(`${URL_VALUE}${URL_WRAP_TAIL}`, 'gi');
/** A scheme-less conferencing host WITH a path, i.e. carrying a room code. */
const BARE_HOST_RE = new RegExp(
  `(?:meet\\.google\\.com|tel\\.meet|g\\.co\\/meet|zoom\\.us|teams\\.microsoft\\.com`
  + `|teams\\.live\\.com|webex\\.com|meet\\.jit\\.si|whereby\\.com|chime\\.aws)`
  + `\\/${URL_TAIL}+${WRAP_TAIL}`,
  'gi'
);

/**
 * Digit floors. Below the floor a run is a dose ("200 mg"), a cycle day, a room
 * number or a year, not a credential.
 */
const MIN_DIGITS_STRONG_LABEL = 4;
const MIN_DIGITS_WEAK_LABEL = 6;
const DATE_SHAPED_RE = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-.]\d{1,2}[-.]\d{4}/;

/**
 * Blanks a matched span, preserving the line breaks INSIDE it so surrounding
 * markdown keeps its shape, and marking each line it touched.
 */
function blankSpan(match) {
  return match.replace(/[^\n]+/g, REDACTED_MARK);
}

function redactLabelledCredential(match, label) {
  // A label plus a URL or a tel: URI is a credential, full stop.
  if (/https?:\/\/|www\.|tel:/i.test(match)) return blankSpan(match);
  // A label plus digits is one only if the digits could be a PIN or a phone
  // number, and only if they are not simply a date sitting behind the label.
  const digits = (match.match(/\d/g) || []).length;
  const floor = IS_STRONG_LABEL_RE.test(label) ? MIN_DIGITS_STRONG_LABEL : MIN_DIGITS_WEAK_LABEL;
  if (digits < floor) return match;
  if (digits <= 8 && DATE_SHAPED_RE.test(match)) return match;
  return blankSpan(match);
}

function redactConferencingUrl(match) {
  let parsed;
  try {
    parsed = new URL(/^www\./i.test(match) ? 'https://' + match : match);
  } catch {
    return match;
  }
  return isConferencingHost(parsed.hostname, parsed.pathname) ? blankSpan(match) : match;
}

/**
 * A line the scrubber touched whose remainder is nothing but markdown
 * decoration ("- ", "**", "> ", "1. ") is blanked, because the decoration was
 * only ever holding the credential. Lines the scrubber did NOT touch are
 * returned byte-for-byte: there is no document-wide whitespace tidy here, so
 * nested list indentation and indented code blocks survive intact.
 */
const DECORATION_ONLY_RE = /^[\s*_>#+\-\u2013\u2014=|.:;,()[\]\d]*$/;

function tidyRedactedLines(text) {
  if (!text.includes(REDACTED_MARK)) return text;
  return text.split('\n').map((line) => {
    if (!line.includes(REDACTED_MARK)) return line;
    const rest = line.split(REDACTED_MARK).join('');
    return DECORATION_ONLY_RE.test(rest) ? '' : rest;
  }).join('\n');
}

export function scrubJoinInfo(text) {
  if (!text) return text;
  let out = String(text).replace(ZERO_WIDTH_RE, '');
  out = out.replace(LABELLED_CREDENTIAL_RE, redactLabelledCredential);
  out = out.replace(URL_TOKEN_RE, redactConferencingUrl);
  out = out.replace(BARE_HOST_RE, blankSpan);
  out = tidyRedactedLines(out);
  // Collapse blank lines created by removals.
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

/** An <img> src is a credential only when its HOST serves meeting rooms. */
function isCredentialImageUrl(src) {
  if (!src) return false;
  try {
    const parsed = new URL(String(src).trim(), SITE_ORIGIN);
    return isConferencingHost(parsed.hostname, parsed.pathname);
  } catch {
    return false;
  }
}

// Strip markdown image embeds, scrub join info, return chunked safe content.
function summarize(content, { scrub = true } = {}) {
  if (!content) return { title: '', description: '', firstImage: null, chunks: [] };
  let firstImage = null;
  const noImages = String(content).replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, _alt, src) => {
    // firstImage becomes og:image, twitter:image, the JSON-LD image and the
    // rendered flyer, and it is captured HERE, before scrubJoinInfo ever runs.
    // A markdown image whose src is the Meet room would otherwise publish the
    // joining URL to all four.
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

/**
 * The speaker reaches the meta row, the JSON-LD performer and the .ics
 * DESCRIPTION -- all shared, cacheable surfaces -- for every tier. Both arms of
 * `event.speaker || extractSpeaker(content)` go through here.
 */
function scrubSpeaker(value) {
  if (!value) return null;
  const cleaned = scrubJoinInfo(value)
    // A speaker is one short line, so it is worth tidying the punctuation the
    // removal left behind: "Dr Ada (PIN 660011)" should read "Dr Ada", not
    // "Dr Ada ()". Scoped to this field; body prose is never reflowed.
    .replace(/[([{]\s*[)\]}]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[\s,;:.\-\u2013\u2014]+$/, '')
    .trim();
  return cleaned || null;
}

/**
 * The title is a REQUIRED field: it is the <h1>, the <title>, og:title,
 * og:image:alt, the JSON-LD name, the .ics SUMMARY and the Google Calendar
 * text= parameter. Scrubbing can empty it, so it falls back to the scrubbed
 * first content chunk and then to a constant. It never returns blank, and it
 * never falls back to the unscrubbed column it just cleaned.
 */
function safeTitle(rawTitle, summaryTitle, fallback) {
  const scrubbed = (scrubJoinInfo(rawTitle) || '').trim();
  if (scrubbed) return scrubbed;
  const fromContent = (summaryTitle || '').trim();
  if (fromContent) return fromContent;
  return fallback;
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
  // summary.description is already scrubbed of Meet URL / dial / PIN.
  const description = (summary.description || `Live members-only call from Save the Uterus Club.`).slice(0, 300);
  const fullTitle = `${title} | Save the Uterus Club`;
  // og_image_url is judged on its HOST, not its filename: a flyer called
  // "endo-call-2026.jpg" is a flyer; a src on meet.google.com is the room.
  const flyerSrc = (isCredentialImageUrl(event.og_image_url) ? null : event.og_image_url) || summary.firstImage;
  const ogImage = abs(flyerSrc) || (SITE_ORIGIN + '/og/save-the-uterus-club.png?v=8');
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
  // other arm was the raw `speaker` column, so a credential typed after a
  // speaker name reached the meta row, JSON-LD performer.name and the .ics.
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
