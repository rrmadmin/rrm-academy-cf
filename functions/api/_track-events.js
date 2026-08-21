// functions/api/_track-events.js
// Single source of truth for the client analytics event allowlist, required params,
// and PII/reserved param guards. Imported by track.js and validated by AG gates.

// Server-only conversion events that fire from CF Workers middleware / auth / billing.
// Clients MUST NOT send these -- they would double-count conversions in GA4.
const SERVER_ONLY_EVENTS = new Set([
  'sign_up',
  'signup_from_ask',
  'generate_lead',
  'begin_checkout',
  'purchase',
  'survey_complete',
]);

// Client-facing behavior events that the /api/track endpoint accepts.
export const ALLOWED_CLIENT_EVENTS = new Set([
  // client-fired by the first-party page_view beacon (ga-session.ts)
  'page_view',
  'cta_click',
  'outbound_click',
  'scroll_depth',
  'search_submit',
  'search_result_click',
  'faq_expand',
  'glossary_lookup',
  'video_play',
  'video_complete',
  'share_click',
  'theme_toggle',
  'pdf_download',
  'copy_citation',
  // client foreground-engagement flush (track.ts startEngagementTracking)
  'user_engagement',
  // endo-survey GA4 funnel (index.astro gate + take.astro survey flow)
  'survey_gate_engage',
  'survey_link_valid',
  'survey_start',
]);

// Full allowlist: server-side conversions + client behavior events.
// Used by proof gate AG3 to verify the two sets are disjoint.
export const ALLOWED_EVENTS = new Set([
  ...SERVER_ONLY_EVENTS,
  ...ALLOWED_CLIENT_EVENTS,
]);

// Per-param string length limits for params GA4 Measurement Protocol itself
// allows to run long. Values are truncated to these limits (never rejected)
// before the generic 100-char param validation runs. Limits mirror GA4 MP's
// own documented caps: page_location 1000 chars, page_referrer 420 chars,
// page_title 300 chars. Any param not listed here keeps the 100-char reject.
export const LONG_PARAM_LIMITS = new Map([
  ['page_location', 1000],
  ['page_referrer', 420],
  ['page_title', 300],
]);

// Required params per event. Client must supply ALL listed keys.
// Optional params are not listed here -- they pass through after sanitization.
export const REQUIRED_PARAMS = new Map([
  ['page_view',          ['page_location']],
  ['cta_click',          ['id', 'page']],
  ['outbound_click',     ['href', 'host']],
  ['scroll_depth',       ['depth', 'page']],
  ['search_submit',      ['query_length', 'surface']],
  ['search_result_click',['surface', 'result_type', 'rank']],
  ['faq_expand',         ['slug']],
  ['glossary_lookup',    ['term']],
  ['video_play',         ['course', 'step']],
  ['video_complete',     ['course', 'step']],
  ['share_click',        ['surface', 'network']],
  ['theme_toggle',       ['to']],
  ['pdf_download',       ['slug', 'source']],
  ['copy_citation',      ['surface', 'format']],
  ['user_engagement',    ['engagement_time_msec']],
  ['survey_gate_engage', ['page']],
  ['survey_link_valid',  ['page']],
  ['survey_start',       ['page']],
]);

// Regex for PII param key detection. Keys matching this pattern are stripped
// before forwarding to GA4 or Analytics Engine. Never reject -- just silently drop.
// AG5 proof gate verifies all terms below remain present in this regex source.
export const PII_REGEX = /email|user|name|password|token|cookie|address|phone|ssn/i;

// Regex for PII value detection. String values matching this pattern are stripped
// before forwarding. Covers: email addresses, SSNs, US phone numbers, card numbers.
export const PII_VALUE_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{3}-\d{2}-\d{4}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b|\b(?:\d[ -]?){13,19}\b/;

// Params in LONG_PARAM_LIMITS that carry a client-generated URL rather than
// free text. Used to scope the digit-run-only PII screen exemption below to
// params where a bare 13-19 digit run is far more likely to be an epoch-ms
// cache-buster or numeric id than an unformatted card/account number.
export const URL_SHAPED_LONG_PARAMS = new Set(['page_location', 'page_referrer']);

const PII_VALUE_REGEX_NO_DIGITRUN = /[\w.+-]+@[\w-]+\.[\w.-]+|\b\d{3}-\d{2}-\d{4}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/;

// True when a value matches PII_VALUE_REGEX only via the bare long-digit-run
// alternative (no email/SSN/formatted-phone shape present).
export function isDigitRunOnlyMatch(value) {
  return PII_VALUE_REGEX.test(value) && !PII_VALUE_REGEX_NO_DIGITRUN.test(value);
}

// Param names the server adds automatically. Client-supplied values for these keys
// are dropped silently (not rejected) to prevent accidental override.
// Note: page_location, page_referrer, engagement_time_msec are NOT reserved -- the
// client beacon (ga-session.ts) is the authoritative source for those on page_view.
// session_id, client_id, and session_number travel via top-level overrides
// (cid/sid/sn), not params -- a params.session_number would otherwise spread
// last in _ga4.js and clobber the validated sn override.
export const RESERVED_PARAMS = new Set([
  'session_id',
  'session_number',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'entry_category',
  'entry_platform',
  'email_type',
  'list_source',
  'client_id',
  'device_type',
]);
