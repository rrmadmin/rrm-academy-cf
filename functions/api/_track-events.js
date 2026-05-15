// functions/api/_track-events.js
// Single source of truth for the client analytics event allowlist, required params,
// and PII/reserved param guards. Imported by track.js and validated by AG gates.

// Server-only conversion events that fire from CF Workers middleware / auth / billing.
// Clients MUST NOT send these -- they would double-count conversions in GA4.
const SERVER_ONLY_EVENTS = new Set([
  'page_view',
  'sign_up',
  'signup_from_ask',
  'generate_lead',
  'begin_checkout',
  'purchase',
]);

// Client-facing behavior events that the /api/track endpoint accepts.
export const ALLOWED_CLIENT_EVENTS = new Set([
  'cta_click',
  'outbound_click',
  'internal_click',
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
]);

// Full allowlist: server-side conversions + client behavior events.
// Used by proof gate AG3 to verify the two sets are disjoint.
export const ALLOWED_EVENTS = new Set([
  ...SERVER_ONLY_EVENTS,
  ...ALLOWED_CLIENT_EVENTS,
]);

// Required params per event. Client must supply ALL listed keys.
// Optional params are not listed here -- they pass through after sanitization.
export const REQUIRED_PARAMS = new Map([
  ['cta_click',          ['id', 'page']],
  ['outbound_click',     ['href', 'host']],
  ['internal_click',     ['href', 'page']],
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
]);

// Regex for PII param key detection. Keys matching this pattern are stripped
// before forwarding to GA4 or Analytics Engine. Never reject -- just silently drop.
// AG5 proof gate verifies all terms below remain present in this regex source.
export const PII_REGEX = /email|user|name|password|token|cookie|address|phone|ssn/i;

// Param names the server adds automatically. Client-supplied values for these keys
// are dropped silently (not rejected) to prevent accidental override.
export const RESERVED_PARAMS = new Set([
  'page_location',
  'page_referrer',
  'engagement_time_msec',
]);
