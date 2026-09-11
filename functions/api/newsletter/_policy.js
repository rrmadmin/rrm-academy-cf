/**
 * THE BULK RAIL'S WARM-UP POLICY, AS PURE FUNCTIONS.
 *
 * This module imports nothing, touches no binding, and never reads a clock:
 * every function that needs the time is handed `nowIso`. That is not
 * fastidiousness, it is what lets the ramp table, the UTC day boundary and the
 * breaker thresholds be asserted exactly, at the boundary values, without
 * freezing a global that the rest of the suite shares.
 *
 * WHY THERE IS A POLICY AT ALL. The 2026-09-06 to 09-08 drip sent about 2,880
 * messages over three UTC days from the apex Workspace identity and put a 0.55%
 * user-reported spam day on rrmacademy.org, above Google's 0.3% line, flipping
 * the domain's Compliance status to "Needs work" -- a verdict every send as
 * rrmacademy.org shares, transactional mail included. Nothing in the send path
 * could have stopped it, because there was nothing to stop it with. These are
 * the stops.
 *
 * THE CAP IS A CEILING, NEVER A TARGET. A run that would exceed the day's
 * remaining allowance is truncated to it and the remainder waits for tomorrow,
 * engaged recipients first. Nothing here ever rounds up, borrows from tomorrow,
 * or treats a spent day as an error.
 *
 * Spec: docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 5.1.
 */

/** The one domain this policy governs. Not the apex, deliberately (section 4). */
export const BULK_DOMAIN = 'rrmacademy.com';

/**
 * Days since the domain's first send -> that day's ceiling. `throughDay` is
 * INCLUSIVE, and day 1 is the calendar day of the first send itself.
 */
export const RAMP_TABLE = [
  { throughDay: 2, cap: 200 },
  { throughDay: 5, cap: 500 },
  { throughDay: 12, cap: 1000 },
  { throughDay: Infinity, cap: 1500 },
];

/** Google's published line is 0.3%; the breaker trips first, on purpose. */
export const COMPLAINT_RATE_LIMIT = 0.002;
export const BOUNCE_RATE_LIMIT = 0.02;

/**
 * The breaker refuses to judge a ratio on fewer than this many sends in the
 * trailing 24 hours. This is deliberate fail-open on a tiny sample, not a gap:
 * one complaint out of three is 33% and means nothing, and a breaker that
 * paused on it would make the first hour of every warm-up day unusable. The
 * daily Postmaster reading (section 7, the bulk-mail-health daemon) is the
 * backstop for exactly those first hours.
 */
export const BREAKER_MIN_SAMPLE = 50;

/** send_paused.reason values. The observatory daemon greps for these strings. */
export const PAUSE_COMPLAINT_RATE = 'complaint-rate';
export const PAUSE_BOUNCE_RATE = 'bounce-rate';
export const PAUSE_LOG_WRITE_FAILED = 'log-write-failed';

/**
 * The cohort ORDER BY, as the exact text send.js splices into its query.
 *
 * It lives here, next to compareCohort(), so the SQL and the comparator cannot
 * drift: a test asserts both name the same five keys in the same order. The
 * alias `s` is newsletter_subscriber in send.js's bulk query.
 *
 * NULLs sort LAST on every engagement key because SQLite treats NULL as the
 * smallest value and these are all DESC. That is the behaviour wanted: a
 * subscriber we have never sent to is not "most engaged".
 *
 * last_clicked_at and last_opened_at are never written under this build --
 * _template.js removed the open pixel and the click wrapping to keep newsletter
 * mail out of Gmail's Promotions tab, so open.js and click.js have no live
 * caller. They stay in the ORDER BY for when tracking returns; until then the
 * effective order is source, then last_sent_at, then subscribed_at.
 */
export const COHORT_ORDER_SQL = [
  "CASE WHEN s.source = 'website' THEN 0 ELSE 1 END ASC",
  's.last_clicked_at DESC',
  's.last_opened_at DESC',
  's.last_sent_at DESC',
  's.subscribed_at DESC',
  's.id ASC',
].join(', ');

/** The UTC calendar date of an ISO timestamp, 'YYYY-MM-DD'. */
export function utcDay(nowIso) {
  return new Date(nowIso).toISOString().slice(0, 10);
}

/**
 * Days since the first send, 1-based, counted in UTC CALENDAR DAYS rather than
 * elapsed hours. A first send at 23:00 and a run at 01:00 the next morning is
 * day 2, two hours later, because the cap is a per-calendar-day budget and the
 * counter it is compared against resets on the same boundary. Counting elapsed
 * hours would let a late-evening start spend day 1's cap twice.
 */
export function domainAgeDays(firstSendAt, nowIso) {
  const first = Date.parse(`${utcDay(firstSendAt)}T00:00:00.000Z`);
  const today = Date.parse(`${utcDay(nowIso)}T00:00:00.000Z`);
  return Math.floor((today - first) / 86400000) + 1;
}

/** The ceiling for a domain of this age. */
export function dailyCap(ageDays) {
  for (const band of RAMP_TABLE) {
    if (ageDays <= band.throughDay) return band.cap;
  }
  return RAMP_TABLE[RAMP_TABLE.length - 1].cap;
}

/**
 * What this run may send, from the mail_domain_state row and the clock.
 *
 * `state` is the row, or null when there is none. A null row -- or a row whose
 * first_send_at is NULL -- BLOCKS: the domain has never sent, and nothing
 * should compute a "days since first send" against a fact that does not exist.
 * The CLI's --first-send flag is the only thing that creates it, in its own D1
 * write before any recipient is touched.
 *
 * A stored `day` that is not today means the counter belongs to a finished day,
 * so today's spend is 0. A spent day is `ok: true` with `remaining: 0`: it is a
 * real answer the caller reports, not an error it retries.
 */
export function remainingAllowance(state, nowIso) {
  const blocked = {
    ok: false, reason: 'first-send-not-recorded', ageDays: null, cap: 0, sentToday: 0, remaining: 0,
  };
  if (!state || !state.first_send_at) return blocked;
  const ageDays = domainAgeDays(state.first_send_at, nowIso);
  const cap = dailyCap(ageDays);
  const sentToday = state.day === utcDay(nowIso) ? Number(state.sent_today) || 0 : 0;
  return {
    ok: true,
    reason: null,
    ageDays,
    cap,
    sentToday,
    remaining: Math.max(0, cap - sentToday),
  };
}

/**
 * Cut an ordered cohort down to the day's allowance. The caller has already
 * ordered it, so the head is the engaged head and the tail is what waits.
 */
export function truncateToAllowance(recipients, remaining) {
  const room = Math.max(0, Number(remaining) || 0);
  const send = recipients.slice(0, room);
  return { send, deferred: recipients.length - send.length };
}

/** DESC with NULLs last, which is what SQLite does for `<col> DESC`. */
function descNullsLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a > b) return -1;
  if (a < b) return 1;
  return 0;
}

/**
 * The JS mirror of COHORT_ORDER_SQL. Used by tests, and by any caller that has
 * to order a cohort it did not get from SQL.
 */
export function compareCohort(a, b) {
  const web = (r) => (r.source === 'website' ? 0 : 1);
  const bySource = web(a) - web(b);
  if (bySource !== 0) return bySource;
  for (const key of ['last_clicked_at', 'last_opened_at', 'last_sent_at', 'subscribed_at']) {
    const c = descNullsLast(a[key], b[key]);
    if (c !== 0) return c;
  }
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * The trailing-24h verdict. Complaints are checked before bounces because a
 * complaint is the harm Postmaster reports and the one that costs the domain
 * its standing; a bounce is list hygiene. Both are reported in `detail` either
 * way, so send_paused records why, not merely that.
 */
export function breakerVerdict({ sent, complained, bounced }) {
  const s = Number(sent) || 0;
  const c = Number(complained) || 0;
  const b = Number(bounced) || 0;
  const pct = (n) => (s === 0 ? '0.000' : ((n / s) * 100).toFixed(3));
  const detail = `${s} sent, ${c} complaints (${pct(c)}%), ${b} hard bounces (${pct(b)}%) in the trailing 24h`;
  if (s < BREAKER_MIN_SAMPLE) {
    return { tripped: false, reason: null, detail: `${detail}; below the ${BREAKER_MIN_SAMPLE}-send minimum sample` };
  }
  if (c / s >= COMPLAINT_RATE_LIMIT) return { tripped: true, reason: PAUSE_COMPLAINT_RATE, detail };
  if (b / s >= BOUNCE_RATE_LIMIT) return { tripped: true, reason: PAUSE_BOUNCE_RATE, detail };
  return { tripped: false, reason: null, detail };
}

/** One header-safe token: lowercase, [a-z0-9-] only, collapsed, clamped. */
function headerToken(value, fallback) {
  const t = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return t || fallback;
}

/**
 * `Feedback-ID: <campaign>:<segment>:rrma:rrmacademy.com`, which is what makes
 * Postmaster's Feedback Loop dashboard report a complaint rate PER CAMPAIGN
 * instead of one undifferentiated domain number.
 *
 * Both caller-supplied parts are reduced to [a-z0-9-], so the value can carry
 * neither a colon (which would invent a fifth field) nor a CR or LF (which
 * would split the header). The sanitising is here rather than at the call site
 * because this function is the only place the header's shape is known.
 */
export function feedbackId(campaign, segment) {
  return `${headerToken(campaign, 'campaign')}:${headerToken(segment, 'all')}:rrma:${BULK_DOMAIN}`;
}

/**
 * A campaign key is a lowercase slug of 2 to 64 characters. It is used as a
 * LIKE prefix against email_log.source and as a Feedback-ID part, so it is
 * validated at the boundary rather than sanitised silently: a caller that
 * mistypes a campaign must be told, not quietly given a different cohort's
 * already-sent set.
 */
export function isCampaignKey(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/.test(value);
}
