// functions/api/_ga4-source.js
// Server-side traffic source classification for GA4 Measurement Protocol.
// Prefixed with _ so CF Pages doesn't treat it as a route handler.

// AI agent referrer patterns. Tested BEFORE SEARCH_ENGINES so that bing.com/chat
// routes to 'copilot' (ai category) rather than 'bing' (organic).
const AI_AGENTS = [
  { pattern: /chatgpt\.com|chat\.openai\.com/i,         platform: 'chatgpt' },
  { pattern: /perplexity\.ai/i,                          platform: 'perplexity' },
  { pattern: /claude\.ai/i,                              platform: 'claude' },
  { pattern: /gemini\.google\.com|bard\.google\.com/i,   platform: 'gemini' },
  { pattern: /copilot\.microsoft\.com|bing\.com\/chat/i, platform: 'copilot' },
  { pattern: /you\.com/i,                                platform: 'you' },
  { pattern: /grokipedia\.com|x\.ai/i,                   platform: 'grok' },
];

const SEARCH_ENGINES = [
  { pattern: /^(www\.)?google\./i, source: 'google' },
  { pattern: /bing\.com/i, source: 'bing' },
  { pattern: /yahoo\./i, source: 'yahoo' },
  { pattern: /duckduckgo\.com/i, source: 'duckduckgo' },
  { pattern: /baidu\.com/i, source: 'baidu' },
  { pattern: /yandex\./i, source: 'yandex' },
  { pattern: /ecosia\.org/i, source: 'ecosia' },
];

const SOCIAL_NETWORKS = [
  { pattern: /instagram\.com|l\.instagram\.com/i, source: 'instagram' },
  { pattern: /facebook\.com|l\.facebook\.com|fb\.com/i, source: 'facebook' },
  { pattern: /linkedin\.com|lnkd\.in/i, source: 'linkedin' },
  { pattern: /t\.co|twitter\.com|x\.com/i, source: 'twitter' },
  { pattern: /youtube\.com|youtu\.be/i, source: 'youtube' },
  { pattern: /pinterest\.com/i, source: 'pinterest' },
  { pattern: /reddit\.com/i, source: 'reddit' },
  { pattern: /tiktok\.com/i, source: 'tiktok' },
];

const SELF_DOMAINS = ['rrmacademy.org', 'www.rrmacademy.org', 'library.rrmacademy.org'];

export function classifySource(referrer) {
  if (!referrer) return { source: '(direct)', medium: '(none)', entry_category: 'direct', entry_platform: 'direct' };

  let hostname;
  try {
    hostname = new URL(referrer).hostname;
  } catch {
    return { source: '(direct)', medium: '(none)', entry_category: 'direct', entry_platform: 'direct' };
  }

  if (SELF_DOMAINS.some(d => hostname === d)) {
    return { source: '(direct)', medium: '(none)', entry_category: 'direct', entry_platform: 'direct' };
  }

  // AI agents tested first so bing.com/chat -> copilot, not bing (organic).
  // Match against the full referrer URL (not hostname-only) because the bing.com/chat
  // pattern needs the path component to distinguish it from regular bing.com search.
  for (const { pattern, platform } of AI_AGENTS) {
    if (pattern.test(referrer)) {
      return { source: platform, medium: 'ai', entry_category: 'ai', entry_platform: platform };
    }
  }

  for (const { pattern, source } of SEARCH_ENGINES) {
    if (pattern.test(hostname)) {
      return { source, medium: 'organic', entry_category: 'organic', entry_platform: source };
    }
  }

  for (const { pattern, source } of SOCIAL_NETWORKS) {
    if (pattern.test(hostname)) {
      return { source, medium: 'social', entry_category: 'social', entry_platform: source };
    }
  }

  return { source: hostname, medium: 'referral', entry_category: 'referral', entry_platform: hostname };
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

export function extractUtm(urlString) {
  let params;
  try {
    params = new URL(urlString).searchParams;
  } catch {
    return {};
  }

  const result = {};
  for (const key of UTM_KEYS) {
    const val = params.get(key);
    if (val) result[key] = val;
  }
  return result;
}

export async function deriveSessionId(clientId, dateStr) {
  const raw = new TextEncoder().encode(`${clientId}:${dateStr}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', raw);
  const view = new DataView(hashBuffer);
  return view.getUint32(0) || 1;
}

/**
 * Derives a stable, anonymous client_id from IP + User-Agent.
 * No cookie, no PII stored -- just a deterministic identifier per device.
 * Returns a 16-char hex string.
 */
export async function getClientId(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const ua = request.headers.get('User-Agent') || 'unknown';
  const raw = new TextEncoder().encode(`${ip}:${ua}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', raw);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return '';
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

export async function buildSourceParams(request, clientId) {
  // Prefer entry source cookies (set on first page load in BaseLayout).
  // These carry the original external referrer across internal navigations,
  // so API calls (signup, newsletter, etc.) get correct attribution instead
  // of always showing (direct) from the self-referral Referer header.
  const cookies = request.headers.get('Cookie') || '';
  const entryRef = parseCookie(cookies, 'entry_ref');
  const entryUrl = parseCookie(cookies, 'entry_url');

  const referrer = entryRef || request.headers.get('Referer') || '';
  const url = entryUrl || request.url;
  const utmParams = extractUtm(url);
  const classified = classifySource(referrer);

  // Email UTM override: when utm_source=email, the referrer is typically Gmail/Outlook
  // which would wrongly classify as 'referral'. Override with email category and
  // derive email_type from utm_medium so funnels can segment by broadcast/automation.
  if (utmParams.utm_source === 'email') {
    classified.entry_category = 'email';
    classified.entry_platform = 'email';
    if (utmParams.utm_medium === 'newsletter') classified.email_type = 'broadcast';
    else if (utmParams.utm_medium === 'email_automation') classified.email_type = 'automation';
    else if (utmParams.utm_medium === 'email_transactional') classified.email_type = 'transactional';
    else classified.email_type = 'other';
  }

  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sessionId = await deriveSessionId(clientId, dateStr);

  // list_source cookie: set by BaseLayout when ?list_source= param is present on first load.
  // Survives internal navigations so API calls inherit the original list source.
  const listSource = parseCookie(cookies, 'list_source');

  return {
    session_id: sessionId,
    utm_source: utmParams.utm_source || classified.source,
    utm_medium: utmParams.utm_medium || classified.medium,
    entry_category: classified.entry_category,
    entry_platform: classified.entry_platform,
    ...(classified.email_type && { email_type: classified.email_type }),
    ...(utmParams.utm_campaign && { utm_campaign: utmParams.utm_campaign }),
    ...(utmParams.utm_content && { utm_content: utmParams.utm_content }),
    ...(utmParams.utm_term && { utm_term: utmParams.utm_term }),
    ...(listSource && { list_source: listSource }),
  };
}
