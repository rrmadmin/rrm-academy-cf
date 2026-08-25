/**
 * The joining-link email for a FREE Save the Uterus Club event.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * /events/<slug> renders the SCRUBBED body to every non-member, free event or
 * not. functions/events/[slug].js explains at length why the joining credential
 * must never reach the page, og:description, the JSON-LD or the .ics. Free-event
 * mode does not weaken any of that: it opens exactly ONE new channel for the
 * credential, a message addressed to a mailbox that just asked for it, and this
 * module is that channel. Both senders (POST /api/events/register and
 * GET /api/events/remind) build the message here so the registration mail and the
 * day-of reminder can never drift into saying two different things.
 *
 * WHAT MAY CARRY THE CREDENTIAL, AND WHAT MAY NOT
 * -----------------------------------------------
 * `buildLinkEmail` returns { subject, html, text } and nothing else. Callers put
 * that straight into sendTransactionalEmail. No caller may put the returned html,
 * the text, or `event.event_link` into a response body, a log line or an
 * analytics blob -- the log record for these sends carries source, subject and
 * the SES message id only, exactly like every other transactional send.
 *
 * Prefixed with _ so CF Pages does not treat it as a route handler.
 */
import { STUC_BROADCAST_SENDER } from '../community/_email.js';
import { greetingLine } from '../_greeting.js';

export const REGISTER_FROM = STUC_BROADCAST_SENDER;
export const REGISTER_REPLY_TO = 'administrator@rrmacademy.org';

const SITE_ORIGIN = 'https://rrmacademy.org';

export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeSubject(s) {
  return String(s == null ? '' : s).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/** "Tuesday, September 2 at 7:00 PM Eastern", or null when the date is unusable. */
export function formatEventDate(isoUtc) {
  if (!isoUtc) return null;
  const d = new Date(isoUtc);
  if (isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(d) + ' Eastern';
  } catch {
    return null;
  }
}

/**
 * The dial-in / PIN lines an author typed into the event body, if any.
 *
 * These are the SAME line shapes functions/events/[slug].js strips from the
 * public page, read here rather than re-derived: a person who dials in instead
 * of clicking needs them, and the registration email is the one surface allowed
 * to carry them. Deliberately narrow -- three line-anchored labels, no free-text
 * guessing -- because a false positive here does not leak anything, it merely
 * pastes an unrelated line into an email, and a false negative merely omits a
 * phone number the recipient can still get by clicking the link.
 */
const DIAL_LINE_PATTERNS = [
  /^\s*phone\s*:.*$/i,
  /^\s*pin\s*:.*$/i,
  /^\s*dial(?:-?in)?\s*:.*$/i,
];

export function dialLines(content) {
  if (!content) return [];
  return String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && DIAL_LINE_PATTERNS.some((re) => re.test(line)));
}

/**
 * Builds the joining-link email.
 *
 * @param {object} event    community_post row: slug, title, content, event_date,
 *                          event_link, speaker.
 * @param {object} [opts]
 * @param {'register'|'reminder'} [opts.kind] - picks the subject and the opener.
 *                          Everything below the opener is identical by design.
 * @param {string|null} [opts.firstName] - greeting personalization when known.
 */
export function buildLinkEmail(event, { kind = 'register', firstName = null } = {}) {
  const title = (event.title && String(event.title).trim()) || 'Save the Uterus Club live call';
  const slug = event.slug || event.id;
  const eventUrl = `${SITE_ORIGIN}/events/${slug}/`;
  const joinUrl = event.event_link || eventUrl;
  const when = formatEventDate(event.event_date);
  const speaker = event.speaker && typeof event.speaker === 'string' ? event.speaker.trim() : null;
  const dials = dialLines(event.content);

  const subject = sanitizeSubject(
    kind === 'reminder' ? `Today: ${title}` : `Your link for ${title}`
  );

  const greeting = greetingLine(firstName);

  const opener = kind === 'reminder'
    ? `Today is the day. You are registered for this free Save the Uterus Club call, and here is your link again.`
    : `You are registered for this free Save the Uterus Club call. Here is your link.`;

  const htmlParts = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(opener)}</p>`,
    `<p><strong>${escapeHtml(title)}</strong></p>`,
  ];
  const textParts = [greeting, '', opener, '', title];

  if (when) {
    htmlParts.push(`<p>When: ${escapeHtml(when)}</p>`);
    textParts.push(`When: ${when}`);
  }
  if (speaker) {
    htmlParts.push(`<p>With ${escapeHtml(speaker)}</p>`);
    textParts.push(`With ${speaker}`);
  }

  htmlParts.push(`<p><a href="${escapeHtml(joinUrl)}">${escapeHtml(joinUrl)}</a></p>`);
  textParts.push('', joinUrl);

  for (const line of dials) {
    htmlParts.push(`<p>${escapeHtml(line)}</p>`);
    textParts.push(line);
  }

  htmlParts.push(`<p><a href="${escapeHtml(eventUrl)}">Add it to your calendar</a></p>`);
  textParts.push('', `Add it to your calendar: ${eventUrl}`);

  const ps = 'Save the Uterus Club members get the recording, transcript and notes from every call.';
  htmlParts.push(
    `<p>P.S. ${escapeHtml(ps)} <a href="${SITE_ORIGIN}/save-the-uterus-club">Join Save the Uterus Club</a>.</p>`
  );
  textParts.push('', `P.S. ${ps} ${SITE_ORIGIN}/save-the-uterus-club`);

  return {
    subject,
    html: htmlParts.join('\n'),
    text: textParts.join('\n'),
  };
}
