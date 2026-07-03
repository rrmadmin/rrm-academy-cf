// Server-side bot/datacenter-crawl exclusion for analytics collection endpoints.
//
// Ported from rrm-fingerprint-worker (src/lib/bot.js + src/lib/asn.js), which
// carries the canonical, actively-maintained copy and its own 2026-07-03
// provenance notes (Singapore datacenter crawl w/ spoofed Chrome UAs, sourced
// from fp_visitor sampling). Keep these two copies in sync when either the
// UA regex or the DATACENTER_ASNS set changes.
//
// Deliberate divergence from the fingerprint worker's isBotUserAgent: that
// copy treats a missing/empty UA as a bot (fail CLOSED) because it also
// gates cookie-minting/DB-write side effects where an empty UA is itself
// suspicious. This copy fails OPEN on missing/malformed UA -- real
// datacenter crawls send full spoofed browser UAs and are still caught by
// the ASN check below, so a missing UA here just means "can't classify by
// UA", not "assume bot".
//
// Two independent signals, either trips it: UA string (spoofable) and
// request.cf.asn (datacenter/cloud-provider ASN -- catches browser-UA crawls
// hosted on cloud IP ranges that UA filtering alone misses).
//
// Fails open: a missing/malformed UA or ASN never blocks a request we can't
// classify -- only a confident match short-circuits.

const BOT_RE = /bot|crawl|spider|slurp|googlebot|bingbot|bingpreview|baiduspider|sogou|yandex|duckduckbot|googleother|google-notebooklm|gptbot|oai-searchbot|chatgpt-user|claudebot|claude-web|anthropic|perplexitybot|applebot|facebookexternalhit|headlesschrome|phantomjs|python-requests|python-urllib|scrapy|curl\/|wget\/|ahrefsbot|semrushbot|mj12bot|dotbot|bytespider|amazonbot|dataforseo|querit|sebot|archive\.org_bot|ia_archiver/i;

export const DATACENTER_ASNS = new Set([
  16509,  // Amazon AWS
  14618,  // Amazon AWS
  396982, // Google Cloud Platform (15169 intentionally excluded -- also serves Google's consumer ISP ranges)
  8075,   // Microsoft Azure
  45102,  // Alibaba (US) Cloud
  37963,  // Alibaba Cloud (HK)
  45090,  // Tencent Cloud (Shenzhen)
  132203, // Tencent Cloud (Beijing)
  14061,  // DigitalOcean
  16276,  // OVH
  24940,  // Hetzner Online
  63949,  // Linode (Akamai Connected Cloud)
  31898,  // Oracle Cloud (OCI)
  136907, // Huawei Cloud (Huawei International)
]);

// Null/empty/non-string UA fails open (not a bot) -- real datacenter crawls send
// full spoofed browser UAs anyway and are still caught by the ASN check below.
// Only a UA that actually matches the bot regex classifies as a bot.
function isBotUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return false;
  return BOT_RE.test(ua);
}

// Null/undefined/non-numeric asn -> false (fail open: never block a request
// we can't classify).
function isDatacenterAsn(asn) {
  if (asn === null || asn === undefined) return false;
  const n = typeof asn === 'string' ? Number(asn) : asn;
  if (!Number.isFinite(n)) return false;
  return DATACENTER_ASNS.has(n);
}

// Combines both signals against a Request object.
export function isBotRequest(request) {
  const userAgent = request.headers.get('User-Agent');
  return isBotUserAgent(userAgent) || isDatacenterAsn(request.cf?.asn);
}
