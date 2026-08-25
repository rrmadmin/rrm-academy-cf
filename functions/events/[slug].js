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

/**
 * Cloudflare Turnstile SITE key (public by definition -- it ships in the widget
 * markup on every page that renders a challenge).
 *
 * Inlined rather than imported because this is a Pages Function and cannot pull
 * from src/. The single source of truth is src/lib/turnstile.ts; when the widget
 * is rotated in the Cloudflare dashboard, BOTH must change. The SECRET half stays
 * a CF Pages secret (CF_TURNSTILE_SECRET) and never appears here.
 */
const TURNSTILE_SITE_KEY = '0x4AAAAAACgpzkB4TaFA-Jrx';

/**
 * OG image cache-busting version, appended as `?v=` to the card URL.
 *
 * Inlined for the same reason as TURNSTILE_SITE_KEY above: this is a Pages
 * Function and cannot import from src/. The single source of truth is
 * src/lib/og-config.ts (OG_VERSION); when that is bumped, BOTH must change.
 */
const OG_VERSION = 'v8';

/**
 * D1 hands an INTEGER column back as a number, but this row also travels through
 * the test harness and, historically, through hand-written fixtures. Read the
 * flag through one predicate so "free" means the same thing at every call site,
 * and so anything that is not affirmatively 1/true is members-only -- the safe
 * default, since this flag is what opens the email channel.
 */
function isFreeEvent(event) {
  const value = event?.is_free;
  return value === 1 || value === true || value === '1';
}

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

  // FREE EVENT, still upcoming, visitor is not a member.
  //
  // The page body is UNCHANGED by this branch: a non-member still gets the
  // scrubbed chunks, so the joining credential is no more present in the HTML,
  // og:description, the JSON-LD or the .ics than it was before. All that changes
  // is the CTA, which becomes an email capture. The credential travels in the
  // message POST /api/events/register sends, and nowhere else.
  //
  // Members and staff never reach here -- they are served the inline Join Call
  // button above, free or not -- and a PAST free event falls through the isPast
  // arm at the top, so the recording stays members-only exactly as before.
  if (isFreeEvent(event)) {
    return {
      kind: 'register',
      note: 'This live call is free and open to everyone. Enter your email and we will send you the link.',
      secondaryHref: SITE_ORIGIN + '/community/events',
      secondaryLabel: 'See all events',
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

/**
 * The free-event email capture, rendered IN PLACE OF the two-button CTA block.
 *
 * The form posts to /api/events/register, which is the only code path allowed to
 * put the joining credential in front of a non-member, and it does so by email.
 * Nothing here knows the credential: the slug is the entire payload the page
 * contributes, and the endpoint resolves the room itself.
 *
 * Progressive-enhancement note: this is a JS-driven submit (Turnstile is
 * invisible and must be executed before the POST), so the form carries no
 * `action`. With JS off there is no silent wrong-target submit -- the button
 * simply does nothing, and the "See all events" link below it still works.
 */
function renderRegisterForm(slug, cta) {
  const safeSlug = escapeHtml(slug);
  return `<form class="reg" data-reg-form data-reg-slug="${safeSlug}" novalidate>
      <label class="reg__label" for="reg-email">Email address</label>
      <div class="reg__row">
        <input class="reg__input" id="reg-email" type="email" name="email" placeholder="you@example.com" required autocomplete="email">
        <button class="btn btn--primary reg__btn" type="submit" data-reg-btn>Send me the link</button>
      </div>
      <input class="reg__hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
      <div class="reg__turnstile" data-reg-turnstile></div>
      <p class="reg__feedback" data-reg-feedback role="status" aria-live="polite"></p>
    </form>
    ${cta.secondaryHref ? `<p class="reg__alt"><a class="link" href="${escapeHtml(cta.secondaryHref)}">${escapeHtml(cta.secondaryLabel)}</a></p>` : ''}
    <script>${REGISTER_SCRIPT}</script>`;
}

/**
 * Written as a plain string, not a template literal, so nothing inside it can be
 * read as an interpolation by the template literals that embed it. ES5 shapes
 * throughout, matching the waitlist form in src/pages/courses/[slug].astro,
 * whose invisible-Turnstile execute-then-POST sequence this copies.
 */
const REGISTER_SCRIPT = [
  '(function () {',
  '  var form = document.querySelector("[data-reg-form]");',
  '  if (!form) return;',
  '  var SITE_KEY = ' + JSON.stringify(TURNSTILE_SITE_KEY) + ';',
  '  var slug = form.getAttribute("data-reg-slug") || "";',
  '  var btn = form.querySelector("[data-reg-btn]");',
  '  var feedback = form.querySelector("[data-reg-feedback]");',
  '  var emailInput = form.querySelector("input[name=email]");',
  '  var websiteInput = form.querySelector("input[name=website]");',
  '  var widgetId = null;',
  '  var widgetToken = "";',
  '  var turnstileReady = false;',
  '  var turnstileLoading = false;',
  '  function renderWidget() {',
  '    if (!turnstileReady || !window.turnstile || widgetId !== null) return;',
  '    var container = form.querySelector("[data-reg-turnstile]");',
  '    if (!container) return;',
  '    widgetId = window.turnstile.render(container, {',
  '      sitekey: SITE_KEY,',
  '      size: "invisible",',
  '      callback: function (token) { widgetToken = token; }',
  '    });',
  '  }',
  '  function loadTurnstile() {',
  '    if (turnstileLoading) return;',
  '    turnstileLoading = true;',
  '    var script = document.createElement("script");',
  '    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";',
  '    script.async = true;',
  '    script.onload = function () { turnstileReady = true; renderWidget(); };',
  '    document.head.appendChild(script);',
  '  }',
  '  if (emailInput) emailInput.addEventListener("focus", loadTurnstile, { once: true });',
  '  function fail(message) {',
  '    feedback.textContent = message;',
  '    feedback.className = "reg__feedback reg__feedback--error";',
  '    btn.disabled = false;',
  '    btn.textContent = "Send me the link";',
  '  }',
  '  form.addEventListener("submit", function (e) {',
  '    e.preventDefault();',
  '    var email = emailInput ? emailInput.value.trim() : "";',
  '    if (!email) return;',
  '    loadTurnstile();',
  '    btn.disabled = true;',
  '    btn.textContent = "Sending...";',
  '    feedback.textContent = "";',
  '    feedback.className = "reg__feedback";',
  '    var executePromise;',
  '    if (!widgetToken && window.turnstile && widgetId !== null) {',
  '      executePromise = new Promise(function (resolve) {',
  '        var timeout = setTimeout(resolve, 5000);',
  '        try {',
  '          window.turnstile.execute(widgetId, {',
  '            callback: function (token) { clearTimeout(timeout); widgetToken = token; resolve(); },',
  '            "error-callback": function () { clearTimeout(timeout); resolve(); }',
  '          });',
  '        } catch (ex) { clearTimeout(timeout); resolve(); }',
  '      });',
  '    } else {',
  '      executePromise = Promise.resolve();',
  '    }',
  '    executePromise.then(function () {',
  '      return fetch("/api/events/register", {',
  '        method: "POST",',
  '        credentials: "same-origin",',
  '        headers: { "Content-Type": "application/json" },',
  '        body: JSON.stringify({',
  '          slug: slug,',
  '          email: email,',
  '          turnstileToken: widgetToken,',
  '          website: websiteInput ? websiteInput.value : ""',
  '        })',
  '      });',
  '    }).then(function (r) { return r.json(); }).then(function (data) {',
  '      if (data && data.ok) {',
  '        feedback.textContent = "Check your inbox for the link.";',
  '        feedback.className = "reg__feedback reg__feedback--ok";',
  '        btn.textContent = "Sent";',
  '        if (emailInput) emailInput.disabled = true;',
  '      } else {',
  '        var code = data && data.error;',
  '        fail(code === "spam_check_failed" ? "Spam check failed. Please try again."',
  '          : code === "email_rejected" ? "That email address could not be verified. Please try another one."',
  '          : code === "rate_limited" ? "Too many requests. Please try again in a few minutes."',
  '          : code === "event_ended" ? "This call has already taken place."',
  '          : code === "not_found" ? "Registration is not open for this call."',
  '          : "Something went wrong. Please try again.");',
  '      }',
  '      if (window.turnstile && widgetId !== null) {',
  '        window.turnstile.reset(widgetId);',
  '        widgetToken = "";',
  '      }',
  '    }).catch(function () {',
  '      fail("Network error. Please try again.");',
  '    });',
  '  });',
  '})();',
].join('\n');

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

  /**
   * THE SOCIAL CARD IS NOT THE FLYER.
   *
   * The flyer is a 1080x1080 WEBP in R2. Facebook and WhatsApp reject webp
   * outright (the share renders with no image at all), and X's
   * summary_large_image crops a square to 1.91:1 from the centre, which takes
   * the headline off the top. So og:image and twitter:image now point at the
   * site's own on-demand renderer -- functions/og/[[path]].js, which serves a
   * branded 1200x630 PNG for the runtime slug `events-<slug>` -- and an unknown
   * slug there still returns a branded card with a 200, never a 404.
   *
   * The flyer keeps every OTHER job it had: it is still the page hero, and it is
   * still the JSON-LD `image`, where a square is correct and the format
   * restrictions above do not apply.
   */
  const cardImage = `${SITE_ORIGIN}/og/events-${event.slug || event.id}.png?v=${OG_VERSION}`;

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
  // A free event is genuinely open to everyone, so say so in the offer. This is
  // metadata about ACCESS, not about the joining credential -- location.url
  // still points at this public page and never at the room.
  if (isFreeEvent(event)) {
    eventJsonLd.offers.isAccessibleForFree = true;
  }
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

  // Either the two-button block or, on a free upcoming event for a non-member,
  // the inline email capture. Built here so the markup below has one shape.
  const ctaBlock = cta.kind === 'register'
    ? renderRegisterForm(event.slug || event.id, cta)
    : `<div class="cta__buttons">
      <a class="btn btn--primary" href="${escapeHtml(cta.primaryHref)}" ${cta.primaryAttrs || ''}>${escapeHtml(cta.primaryLabel)}</a>
      ${cta.secondaryHref ? `<a class="btn btn--secondary" href="${escapeHtml(cta.secondaryHref)}">${escapeHtml(cta.secondaryLabel)}</a>` : ''}
    </div>`;

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
<meta property="og:image" content="${escapeHtml(cardImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="${escapeHtml(title)}">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(fullTitle)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(cardImage)}">
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
    --color-danger: #a3302f;
    /* Local scale for the free-event registration block. Prefixed --reg- so it
       cannot shadow a global token name, and declared rather than inlined so the
       block has one place to change. This file is a Pages Function: it cannot
       import src/styles/global.css, which is why it carries its own tokens at
       all. */
    --reg-gap-sm: 6px;
    --reg-gap: 10px;
    --reg-gap-lg: 14px;
    --reg-pad-y: 12px;
    --reg-fs-label: 14px;
    --reg-fs-field: 16px;
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
  /* Free-event email capture. Mobile first: the field and the button stack by
     default and only sit side by side once there is room. */
  .reg { margin: 0; }
  .reg__label {
    display: block;
    font-size: var(--reg-fs-label);
    font-weight: 600;
    color: var(--color-muted);
    margin-bottom: var(--reg-gap-sm);
  }
  .reg__row { display: flex; flex-direction: column; gap: var(--reg-gap); }
  /* Offscreen honeypot. A class, not an inline style: the same trick inline is
     what src/pages/courses/[slug].astro does, and it is a standing css-audit
     finding there. */
  .reg__hp { position: absolute; left: -9999px; }
  .reg__input {
    flex: 1 1 auto;
    min-width: 0;
    font-family: inherit;
    /* 16px, never smaller: iOS Safari zooms the viewport on focus below it. */
    font-size: var(--reg-fs-field);
    padding: var(--reg-pad-y) var(--reg-gap-lg);
    color: var(--color-ink);
    background: var(--color-bg);
    border: 1px solid var(--color-line);
    border-radius: var(--radius-md);
  }
  .reg__input:focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 1px;
  }
  .reg__input:disabled { opacity: .6; }
  .reg__btn { border: 0; cursor: pointer; font-family: inherit; width: 100%; }
  .reg__btn[disabled] { opacity: .7; cursor: default; }
  .reg__turnstile:empty { display: none; }
  .reg__feedback { margin: var(--reg-gap) 0 0; font-size: var(--reg-fs-label); color: var(--color-muted); }
  .reg__feedback:empty { display: none; }
  .reg__feedback--ok { color: var(--color-accent); font-weight: 600; }
  .reg__feedback--error { color: var(--color-danger); }
  .reg__alt { margin: var(--reg-gap-lg) 0 0; font-size: var(--reg-fs-label); }
  /* 640px is one of the documented breakpoints, and it sits clear of the
     max-width:540px block below -- that block sets .btn { width: 100% }, which
     at an overlapping breakpoint would apply to .reg__btn at equal specificity
     and squash the input flat. Below 640 the field and the button stack, which
     is the mobile-first default above. */
  @media (min-width: 640px) {
    .reg__row { flex-direction: row; align-items: center; }
    .reg__btn { width: auto; flex: 0 0 auto; }
  }

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
    ${ctaBlock}
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
      `SELECT id, slug, title, content, event_date, event_link, og_image_url, channel, type, speaker, is_free
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

/**
 * HEAD must answer the same status as GET.
 *
 * Link-preview crawlers, X's among them, commonly probe a URL with HEAD before
 * fetching it. This route exported only onRequestGet, so CF Pages had no
 * handler for HEAD and answered 404 while GET returned a clean 200 with a full
 * set of og: and twitter: tags. The card never rendered, and nothing on the
 * page or in the image was wrong, which is why it read as an OG problem.
 *
 * Every static Astro page already answers HEAD (CF Pages serves assets for
 * both verbs) and the OG image route uses a catch-all onRequest, so this file
 * was the only shareable surface on the site with the gap. Six other functions
 * in this repo already export onRequestHead; this is sibling divergence.
 *
 * Delegating is safe here specifically because onRequestGet is read-only: one
 * D1 SELECT and a render, no writes, no waitUntil, no mail. Event view
 * tracking is client-side (functions/events/_tracking.js ships markup, not a
 * server write), so a HEAD cannot inflate a counter. The runtime drops the
 * body for HEAD. Pattern matches functions/api/fund-supporters.js.
 */
export async function onRequestHead(context) {
  return onRequestGet(context);
}
