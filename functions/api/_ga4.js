/**
 * GA4 Measurement Protocol helper for server-side conversion tracking.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 *
 * Usage: fire-and-forget after successful actions:
 *   sendGA4Event(env, request, 'purchase', { value: 10.00, currency: 'USD' }).catch(() => {});
 *
 * Every event relayed here is sent to GA4. The first-party conversion ledger
 * below is narrower on purpose: it records only the five funnel events in
 * LEDGER_EVENTS, and every other event returns from the ledger write untouched.
 */

import { buildSourceParams, getClientId, parseCookie } from './_ga4-source.js';
import { PII_VALUE_REGEX } from './_track-events.js';
import { getSessionIdFromCookie, validateSession } from './auth/_shared.js';

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

// Event names for which the MP payload gets a coarse user_properties.user_role
// stamp. Enum only, no identifiers -- lets GA4 segment registered vs anonymous
// traffic without carrying PII through Measurement Protocol.
// 'purchase' is deliberately excluded: anonymous no-login checkout is a
// first-class flow (create-checkout.js supports it explicitly), so stamping
// user_role='registered' on every purchase would mislabel anonymous donors
// as registered and invert the segmentation.
const REGISTERED_USER_EVENTS = new Set(['sign_up', 'signup_from_ask']);

// --- First-party conversion ledger (migrations/036-conversion-ledger.sql) ---
// Additive mirror of the same events GA4 receives, written behind the
// CONVERSION_LEDGER flag. Whenever a GA4 send happens it is dispatched before
// any of this runs, and is never blocked, reordered or altered by it. The
// converse does NOT hold: the ledger is our own record, so it still writes when
// GA4_MEASUREMENT_ID/GA4_API_SECRET are absent and no send happens at all --
// a credential lapse is precisely when an independent record earns its keep.
//
// SCOPE. The ledger answers funnel questions, so it records exactly the five
// events below and nothing else. sendGA4Event is the relay for every server-side
// event on the site, engagement signals included (scroll_depth, user_engagement,
// cta_click), and those were landing rows that no funnel question asks about
// while inflating a table meant to stay conversion-shaped. GA4 still receives
// every one of them; only the ledger write is narrowed.
const LEDGER_EVENTS = Object.freeze(new Set([
  'page_view',
  'sign_up',
  'generate_lead',
  'begin_checkout',
  'purchase',
]));

// TEXT caps applied on the way into the row, AFTER ledgerSafeText's PII screen.
// These are a defensive width bound, not a sanitizer; the screen is.
const LEDGER_SHORT_CAP = 64;
const LEDGER_LONG_CAP = 128;

// Events allowed to carry a user_id. page_view is excluded on volume: it is the
// highest-frequency event on the site and a per-person page-by-page trail is
// well past what the funnel questions need.
const LEDGER_USER_EVENTS = new Set(['sign_up', 'generate_lead', 'begin_checkout', 'purchase']);

// Both item matchers are case-insensitive: the item_name is composed by the
// checkout call sites, and a tier written 'Stuc Member' must derive the same
// type as 'STUC Member' rather than falling through to 'other'. Tier
// extraction lowercases anyway.
const STUC_ITEM_RE = /^STUC (.+)$/i;
const COURSE_ITEM_RE = /^Course: /i;

// sign_up `method` values that pass through to `type` verbatim. Every call site
// that fires sign_up must appear here or its registrations all collapse into
// 'other': 'email' (auth/signup.js), 'google' (auth/google-callback.js),
// 'checkout' (billing/_webhook-checkout.js).
const SIGN_UP_METHODS = new Set(['email', 'google', 'checkout']);

/**
 * Deterministic `type` column derivation, per the contract written into
 * migrations/036-conversion-ledger.sql. Every branch falls back to 'other'
 * rather than null so a conversion row is never untyped; page_view and any
 * unlisted event are typed null by design.
 *
 * The two free-text inputs (items[0].item_name and lead_source) are screened
 * against PII_VALUE_REGEX here rather than at the call site, because a value
 * the caller supplied in `params` never passed the sourceParams screen in
 * sendGA4Event. A match derives 'other' -- the row stays typed and the value
 * never lands.
 *
 * Exported for the type-derivation table test.
 */
export function deriveLedgerType(eventName, params = {}) {
  if (eventName === 'purchase' || eventName === 'begin_checkout') {
    const itemName = params.items?.[0]?.item_name;
    if (typeof itemName !== 'string' || PII_VALUE_REGEX.test(itemName)) return 'other';
    if (itemName === 'Donation') return 'donation';
    if (COURSE_ITEM_RE.test(itemName)) return 'course';
    const stuc = STUC_ITEM_RE.exec(itemName);
    if (stuc) return `stuc_${stuc[1].toLowerCase().replace(/\s+/g, '_')}`;
    return 'other';
  }
  if (eventName === 'generate_lead') {
    const source = params.lead_source;
    if (typeof source !== 'string' || !source || PII_VALUE_REGEX.test(source)) return 'other';
    return safeSlice(source, LEDGER_SHORT_CAP);
  }
  if (eventName === 'sign_up') {
    // 'checkout' is the Stripe-webhook auto-created account
    // (billing/_webhook-checkout.js), kept distinct from the two organic
    // methods so a purchase-created registration never reads as a person who
    // chose to sign up. Anything unlisted still derives 'other'.
    return SIGN_UP_METHODS.has(params.method) ? params.method : 'other';
  }
  return null;
}

/**
 * Cap a string without splitting a UTF-16 surrogate pair, the way
 * functions/api/track.js caps its param values. A naive slice landing between
 * the two halves of an astral character writes a lone surrogate into the row.
 */
function safeSlice(str, limit) {
  if (str.length <= limit) return str;
  let end = limit;
  const code = str.charCodeAt(end - 1);
  if (code >= 0xD800 && code <= 0xDBFF) end -= 1;
  return str.slice(0, end);
}

function ledgerText(value, max) {
  if (typeof value !== 'string') return null;
  return safeSlice(value, max) || null;
}

/**
 * ledgerText plus the PII value screen, for the free-text columns.
 *
 * sendGA4Event screens sourceParams only, and it must keep doing exactly that:
 * the GA4 payload is a pinned contract and /api/track owns the pre-screen on
 * the client side. But the ledger reads `params ?? sourceParams`, the same
 * precedence the payload spreads with, so a caller-supplied entry_platform /
 * entry_category / utm_campaign / item_name reaches the row having passed no
 * screen at all. This is that screen, applied at the ledger boundary only.
 *
 * The screen runs BEFORE the width cap: a cap could otherwise slice an email
 * shape in half and let the fragment through.
 *
 * Deliberately NOT used for session_id, client_id, user_id or dedup_key. Those
 * are opaque identifiers, and PII_VALUE_REGEX's bare digit-run alternative
 * would false-positive on a numeric GA4 session id.
 */
function ledgerSafeText(value, max) {
  if (typeof value !== 'string') return null;
  if (PII_VALUE_REGEX.test(value)) return null;
  return safeSlice(value, max) || null;
}

/**
 * The ledger's `value_cents`, which is an INTEGER column.
 *
 * GA4's Measurement Protocol accepts a numeric STRING for `value` and the
 * webhook call sites are not the only writers, so '50.00' has to land as 5000
 * rather than as null. Only a number or a non-blank string is converted --
 * null, undefined, '' and true all mean "this event carries no money" and must
 * not become a confident 0.
 */
function ledgerValueCents(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const cents = Number(value);
  return Number.isFinite(cents) ? Math.round(cents * 100) : null;
}

/**
 * Resolves the rrm-auth user id for a conversion event.
 *
 * A CALLER-SUPPLIED id WINS OVER THE COOKIE, because the cookie is not always
 * the buyer's. A Stripe webhook replay is the case that forced this: the
 * request is Stripe's, carries no session cookie of ours, and would otherwise
 * key a registered buyer's purchase to 'c'+client_id while every earlier row of
 * theirs keys to 'u'+user_id -- two persons in the funnel where there is one.
 * The override is validated as a string and capped like every other TEXT column
 * here; anything else is ignored rather than trusted.
 *
 * Returns null for every non-conversion event (so page_view never carries a
 * user id, and never even attempts the session lookup), for a request with no
 * session cookie, and for any lookup that fails -- the ledger row is written
 * either way.
 */
async function resolveLedgerUserId(env, request, eventName, overrides) {
  if (!LEDGER_USER_EVENTS.has(eventName)) return null;
  const supplied = ledgerText(overrides?.user_id, LEDGER_LONG_CAP);
  if (supplied) return supplied;
  const sessionId = getSessionIdFromCookie(request);
  if (!sessionId) return null;
  try {
    const session = await validateSession(env.DB, sessionId);
    return session?.userId ?? null;
  } catch {
    return null;
  }
}

async function writeConversionLedger(env, request, eventName, params, sourceParams, clientId, overrides) {
  const userId = await resolveLedgerUserId(env, request, eventName, overrides);
  // THE SAME PRECEDENCE THE GA4 PAYLOAD HAS. The payload spreads
  // `...sourceParams, ...params`, so a caller-supplied attribution value wins
  // there; reading only sourceParams here would drop the ga_* metadata the
  // billing webhooks replay (or overwrite it with the relay request's own
  // '(direct)' classification) and the ledger would disagree with GA4 about
  // where the same purchase came from.
  const pick = (key) => params[key] ?? sourceParams[key];
  const sessionId = String(pick('session_id') ?? '') || null;
  // INSERT OR IGNORE against the UNIQUE index on dedup_key. A caller with a
  // natural event identity supplies overrides.event_id (the billing webhooks
  // bind the Stripe event id); everything else binds null, and SQLite's UNIQUE
  // permits unlimited nulls, so the unkeyed callers are unaffected. This closes
  // the one window stripe-webhook.js's webhook_event dedup cannot: a handler
  // that wrote a ledger row and then returned 500, which Stripe redelivers.
  //
  // QUALIFIED BY EVENT NAME, and it has to be. One Stripe
  // checkout.session.completed now relays TWO ledger-writing events -- the
  // sign_up for an account that checkout just created and the purchase for what
  // was bought -- and both carry the same event.id. On the bare key the second
  // INSERT collides with the first and INSERT OR IGNORE drops it silently, so
  // the ledger would record whichever of the two ran first and nothing else.
  // Qualifying keeps redelivery idempotent per event while letting distinct
  // events off one Stripe delivery coexist. The event_id is validated and
  // capped first, then the composed key is capped again, so the column bound
  // is still at most LEDGER_LONG_CAP.
  const eventId = ledgerText(overrides?.event_id, LEDGER_LONG_CAP);
  const dedupKey = eventId ? safeSlice(`${eventName}:${eventId}`, LEDGER_LONG_CAP) : null;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO conversion_event
      (event, type, value_cents, client_id, session_id, user_id, entry_source, entry_category, utm_campaign, item, dedup_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    eventName,
    ledgerText(deriveLedgerType(eventName, params), LEDGER_SHORT_CAP),
    ledgerValueCents(params.value),
    ledgerText(clientId, LEDGER_LONG_CAP),
    ledgerText(sessionId, LEDGER_LONG_CAP),
    userId,
    // buildSourceParams emits no `entry_source` key of its own: the classified
    // origin lands in entry_platform (ai/organic/social platform, or the bare
    // referring hostname), with utm_source as the fallback for the cases where
    // entry_platform is absent or was dropped by a PII screen. Each candidate
    // is screened separately so a PII-shaped entry_platform falls through to
    // utm_source rather than nulling the column outright.
    ledgerSafeText(pick('entry_platform'), LEDGER_SHORT_CAP)
      ?? ledgerSafeText(pick('utm_source'), LEDGER_SHORT_CAP),
    ledgerSafeText(pick('entry_category'), LEDGER_SHORT_CAP),
    ledgerSafeText(pick('utm_campaign'), LEDGER_SHORT_CAP),
    ledgerSafeText(params.items?.[0]?.item_name, LEDGER_LONG_CAP),
    dedupKey,
  ).run();
}

let warnedMissing = false;
let warnedLedgerFlag = false;

/**
 * @param {object} overrides - Optional. { client_id, session_id } to use instead of
 *   deriving from request headers. Used by stripe-webhook to replay the real user identity.
 *   `user_id` is the same replay for the first-party ledger's person key: it never
 *   reaches the GA4 payload, only conversion_event.user_id, and only on the events
 *   LEDGER_USER_EVENTS allows. `event_id` is ledger-only too: it becomes
 *   conversion_event.dedup_key as '<eventName>:<event_id>'. One caller may pass
 *   the SAME event_id to several events off one upstream delivery (a Stripe
 *   checkout relays both sign_up and purchase), so the key is qualified by event
 *   name; it is an idempotency key per event, not per delivery.
 */
export async function sendGA4Event(env, request, eventName, params = {}, overrides = {}) {
  // Only '1' enables the ledger, and only '0'/absent are the other legitimate
  // states. Anything else is a deployment typo that reads as "on" to a human
  // and lands as "off" here, so it gets named once per isolate. The value
  // itself is never logged -- a misconfigured var can hold anything.
  if (env.CONVERSION_LEDGER !== undefined && env.CONVERSION_LEDGER !== '1' && env.CONVERSION_LEDGER !== '0') {
    if (!warnedLedgerFlag) {
      console.warn('GA4 ledger: CONVERSION_LEDGER is set to an unrecognized value; only "1" enables the ledger');
      warnedLedgerFlag = true;
    }
  }

  // Missing credentials disable the GA4 SEND, not the first-party ledger. The
  // ledger exists to be our own record of these conversions, so a credential
  // lapse -- exactly when GA4 is losing data -- is the moment it has to keep
  // writing. Everything the row needs (clientId, sourceParams) is derived from
  // the request, not from the credentials.
  const hasCredentials = !!(env.GA4_MEASUREMENT_ID && env.GA4_API_SECRET);
  if (!hasCredentials && !warnedMissing) {
    console.warn('GA4: missing', !env.GA4_MEASUREMENT_ID ? 'GA4_MEASUREMENT_ID' : 'GA4_API_SECRET');
    warnedMissing = true;
  }

  try {
    const clientId = overrides.client_id || await getClientId(request);
    // When both client_id and session_id are overridden (client beacon or webhook replay),
    // skip buildSourceParams -- the request arrives via the first-party /api/track relay,
    // so its URL is /api/track and its Referer is a same-origin self-referral to the page
    // the user is on, which classifySource files as direct. Neither one is the entry URL,
    // so page_location (with utm_*) and page_referrer come from the event params the
    // client sends directly, and the entry_ref/entry_url cookies are preferred over both
    // in the fallback below. Those cookies ARE the user's, because the beacon is
    // same-origin. session_number is included when provided.
    let sourceParams;
    if (overrides.client_id != null && overrides.session_id != null) {
      sourceParams = { session_id: overrides.session_id };
      if (overrides.session_number != null) sourceParams.session_number = overrides.session_number;
      // Entry-source attribution is normally skipped on this branch (see
      // comment above) because the relay request's own URL and self-referral
      // Referer are not the entry URL. But when the caller's own params are
      // missing entry_category/entry_platform, fall back to the entry_ref and
      // entry_url cookies (same signal buildSourceParams already reads) rather
      // than shipping the event with no attribution at all. The whole
      // attribution set travels, not just entry_category/entry_platform:
      // entry_*, utm_*, email_type, list_source.
      if (params.entry_category == null || params.entry_platform == null) {
        const cookies = request.headers.get('Cookie') || '';
        if (parseCookie(cookies, 'entry_ref') || parseCookie(cookies, 'entry_url')) {
          const derived = await buildSourceParams(request, clientId);
          // Forward everything buildSourceParams knows about the visit except
          // its server-derived session_id: the client's session_id (overrides)
          // is the real one and must win. Caller params still spread last in
          // the payload, so a caller-supplied value is never clobbered here.
          const { session_id: _serverSessionId, ...attribution } = derived;
          Object.assign(sourceParams, attribution);
        }
      }
    } else {
      sourceParams = await buildSourceParams(request, clientId);
    }
    // Server-derived attribution is parsed from the entry_url cookie, which is
    // authored by whoever built the inbound link (a newsletter that stamps the
    // subscriber's email into utm_term, for instance). Apply the same value
    // screen /api/track applies to client params so PII never reaches GA4 from
    // either branch. The utm_* values were already screened raw in extractUtm
    // before clamping, so this pass covers the rest of the set (list_source and
    // the referrer-derived values). Pure digit runs of 10 or 13-19 characters
    // are dropped (phone/card shapes); {creative} ad ids are 11-12 digits and pass.
    for (const [key, value] of Object.entries(sourceParams)) {
      if (typeof value === 'string' && PII_VALUE_REGEX.test(value)) delete sourceParams[key];
    }

    // First-party ledger. Reads only values already built above, and every
    // failure mode is contained here. Defined once and invoked from both exits
    // so the two paths cannot drift apart.
    const writeLedger = async () => {
      if (env.CONVERSION_LEDGER !== '1' || !env.DB) return;
      // Scope gate, ahead of the user-id resolution and the INSERT: an event
      // outside LEDGER_EVENTS costs the ledger nothing, not even a session
      // lookup.
      if (!LEDGER_EVENTS.has(eventName)) return;
      try {
        await writeConversionLedger(env, request, eventName, params, sourceParams, clientId, overrides);
      } catch (err) {
        // Name only. Row values and sourceParams carry per-person attribution
        // and must never reach a log line.
        console.warn('GA4 ledger write failed', eventName, err?.name || 'Error');
      }
    };

    // No credentials: write the ledger row and stop. Nothing was dispatched, so
    // there is no ga4Send to await and no ga4Error to rethrow.
    if (!hasCredentials) {
      await writeLedger();
      return;
    }

    const defaultPageLocation = (() => { try { const u = new URL(request.headers.get('referer') || request.url); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.toString(); } catch { return ''; } })();
    const payload = {
      client_id: clientId,
      events: [{
        name: eventName,
        params: {
          page_location: defaultPageLocation,
          engagement_time_msec: 1,
          ...sourceParams,
          ...params,
        },
      }],
    };
    // Caller-supplied page_location (via params) spreads last above and could
    // otherwise bypass this file's own query-string-stripping default -- strip
    // the query string and hash from whichever page_location won, regardless
    // of source, so no query string ever egresses to google-analytics.com.
    // Also clear userinfo (username/password) -- URL.search/hash clearing alone
    // leaves any embedded https://user:pass@host userinfo intact in toString().
    {
      const finalParams = payload.events[0].params;
      const callerSuppliedPageLocation = params.page_location != null;
      try {
        const u = new URL(finalParams.page_location);
        u.username = '';
        u.password = '';
        u.search = '';
        u.hash = '';
        finalParams.page_location = u.toString();
      } catch {
        if (callerSuppliedPageLocation) {
          delete finalParams.page_location;
        } else {
          finalParams.page_location = defaultPageLocation;
        }
      }
    }
    if (REGISTERED_USER_EVENTS.has(eventName)) {
      payload.user_properties = { user_role: { value: 'registered' } };
    }

    // Dispatched FIRST, with its rejection captured immediately so the ledger
    // write below can never sit in front of an unhandled rejection window. The
    // captured error is rethrown at the original await point, so a GA4 network
    // failure still reaches this function's outer catch exactly as before.
    let ga4Error = null;
    const ga4Send = fetch(
      `${GA4_ENDPOINT}?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      }
    ).catch((err) => { ga4Error = err; return null; });

    // First-party ledger. Strictly downstream of the send.
    await writeLedger();

    const resp = await ga4Send;
    if (ga4Error) throw ga4Error;
    if (!resp.ok) {
      try {
        env.EVENTS?.writeDataPoint({
          blobs: ['rrm-academy', 'ga4', 'ga4_mp_error', 'error', String(resp.status)],
          doubles: [0, 1, resp.status],
          indexes: ['ga4_mp_error'],
        });
      } catch {
        // best-effort: AE write must not escalate analytics-error logging into a user-visible failure
      }
    }
  } catch {
    // Silent -- never let analytics failures affect the user
  }
}
