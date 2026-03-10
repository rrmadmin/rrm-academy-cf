// functions/api/_ga4-source.js
// Server-side traffic source classification for GA4 Measurement Protocol.
// Prefixed with _ so CF Pages doesn't treat it as a route handler.

const SEARCH_ENGINES = [
  { pattern: /google\./i, source: 'google' },
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
  if (!referrer) return { source: '(direct)', medium: '(none)' };

  let hostname;
  try {
    hostname = new URL(referrer).hostname;
  } catch {
    return { source: '(direct)', medium: '(none)' };
  }

  if (SELF_DOMAINS.some(d => hostname === d)) {
    return { source: '(direct)', medium: '(none)' };
  }

  for (const { pattern, source } of SEARCH_ENGINES) {
    if (pattern.test(hostname)) return { source, medium: 'organic' };
  }

  for (const { pattern, source } of SOCIAL_NETWORKS) {
    if (pattern.test(hostname)) return { source, medium: 'social' };
  }

  return { source: hostname, medium: 'referral' };
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

export async function buildSourceParams(request, clientId) {
  const referrer = request.headers.get('Referer') || '';
  const url = request.url;
  const utmParams = extractUtm(url);
  const { source, medium } = classifySource(referrer);

  const dateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const sessionId = await deriveSessionId(clientId, dateStr);

  return {
    session_id: sessionId,
    utm_source: utmParams.utm_source || source,
    utm_medium: utmParams.utm_medium || medium,
    ...(utmParams.utm_campaign && { utm_campaign: utmParams.utm_campaign }),
    ...(utmParams.utm_content && { utm_content: utmParams.utm_content }),
    ...(utmParams.utm_term && { utm_term: utmParams.utm_term }),
  };
}
