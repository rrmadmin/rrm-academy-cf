/**
 * GET /api/community/unfurl?url=<encoded>
 * Fetches and parses Open Graph metadata for a given URL.
 * Returns { ok: true, preview: { url, title, description, image, siteName, domain } | null }
 */
import { json, optionsResponse, checkRateLimit } from '../auth/_shared.js';
import { log } from '../_log.js';
import { requireMember } from './_shared.js';

const BODY_CAP = 512 * 1024; // 512 KB

export async function onRequestOptions() {
  return optionsResponse();
}

// --- SSRF safety predicate ---

function isUnfurlableUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  // Scheme must be http or https
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  // Reject userinfo (credentials before @)
  if (parsed.username || parsed.password) return false;

  const host = parsed.hostname;

  // Reject IPv4 dotted-quad
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;

  // Reject IPv6 (contains colon or is bracketed)
  if (host.includes(':') || host.startsWith('[')) return false;

  // Reject localhost and internal suffixes
  const lower = host.toLowerCase();
  if (lower === 'localhost') return false;
  if (lower.endsWith('.local') || lower.endsWith('.internal') || lower.endsWith('.localhost')) return false;

  // Reject explicit non-default ports
  const port = parsed.port;
  if (port !== '' && port !== '80' && port !== '443') return false;

  // Hostname must contain a dot (rejects bare single-label hosts)
  if (!host.includes('.')) return false;

  return true;
}

// --- DNS rebinding guard ---

function isPrivateIp(addr) {
  // Normalize IPv6-mapped IPv4 (::ffff:a.b.c.d)
  const v4mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  const ipv4 = v4mapped ? v4mapped[1] : addr;

  // IPv4 private/reserved ranges
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ipv4)) {
    const parts = ipv4.split('.').map(Number);
    const [a, b] = parts;
    if (a === 0) return true;                                            // 0.0.0.0/8
    if (a === 10) return true;                                           // 10.0.0.0/8
    if (a === 127) return true;                                          // 127.0.0.0/8 (loopback)
    if (a === 169 && b === 254) return true;                             // 169.254.0.0/16 (link-local / metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;                   // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                             // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;                  // 100.64.0.0/10 (CGNAT)
    return false;
  }

  // IPv6 private/reserved ranges
  const low = addr.toLowerCase();
  if (low === '::1') return true;                                        // loopback
  if (low.startsWith('fc') || low.startsWith('fd')) return true;        // fc00::/7 (ULA)
  if (low.startsWith('fe80')) return true;                              // fe80::/10 (link-local)
  if (low.startsWith('::ffff:')) return true;                           // ::ffff:0:0/96 (v4-mapped; catch-all)
  return false;
}

async function resolveAndCheck(host) {
  // Returns true if the hostname resolves safely (no private addresses).
  // Returns false on any private hit OR on resolution failure (fail closed).
  for (const type of ['A', 'AAAA']) {
    let data;
    try {
      const resp = await fetch(
        `https://1.1.1.1/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        {
          headers: { accept: 'application/dns-json' },
          signal: AbortSignal.timeout(3000),
        }
      );
      if (!resp.ok) return false;
      data = await resp.json();
    } catch {
      return false; // resolution failure → fail closed
    }
    if (!data || data.Status !== 0) {
      // NXDOMAIN or SERVFAIL for this record type — acceptable for AAAA on IPv4-only hosts
      if (type === 'AAAA') continue;
      return false; // no A record → fail closed
    }
    const answers = Array.isArray(data.Answer) ? data.Answer : [];
    for (const answer of answers) {
      // answer.type 1=A, 28=AAAA; skip CNAME (type 5) records
      if (answer.type !== 1 && answer.type !== 28) continue;
      if (isPrivateIp(answer.data)) return false;
    }
  }
  return true;
}

// --- SHA-256 hex helper ---

async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

// --- Body reader with cap ---

async function readBodyCapped(response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total >= BODY_CAP) {
        reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    // stream error — return what we have
  }
  // Merge chunks
  const merged = new Uint8Array(total > BODY_CAP ? BODY_CAP : total);
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.min(chunk.length, BODY_CAP - offset));
    merged.set(slice, offset);
    offset += slice.length;
    if (offset >= BODY_CAP) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

// --- HTMLRewriter parse ---

async function parseHtml(htmlText, finalUrl) {
  const meta = {};
  let titleText = '';

  const rewriter = new HTMLRewriter()
    .on('meta', {
      element(el) {
        const property = el.getAttribute('property') || '';
        const name = el.getAttribute('name') || '';
        const content = el.getAttribute('content') || '';
        const key = property || name;
        if (!key || !content) return;
        meta[key] = content;
      },
    })
    .on('title', {
      text(chunk) {
        titleText += chunk.text;
      },
    });

  const transformed = rewriter.transform(new Response(htmlText, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  await transformed.arrayBuffer();

  // Resolve field precedence
  const rawTitle = meta['og:title'] || meta['twitter:title'] || titleText.trim() || null;
  const rawDescription = meta['og:description'] || meta['twitter:description'] || meta['description'] || null;
  const rawImage = meta['og:image'] || meta['twitter:image'] || null;
  const rawSiteName = meta['og:site_name'] || null;

  const title = rawTitle ? rawTitle.trim().slice(0, 300) : null;
  const description = rawDescription ? rawDescription.trim().slice(0, 500) : null;

  // Resolve image: resolve relative against finalUrl, drop if not https:
  let image = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, finalUrl).toString();
      const resolvedParsed = new URL(resolved);
      if (resolvedParsed.protocol === 'https:') {
        image = resolved;
      }
    } catch {
      // invalid image URL — drop it
    }
  }

  const finalHostname = new URL(finalUrl).hostname;
  const siteName = rawSiteName || finalHostname;
  const domain = finalHostname.replace(/^www\./, '');

  return { title, description, image, siteName, domain };
}

// --- Main GET handler ---

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    const allowed = await checkRateLimit(env, `unfurl:${user.id}`, 60, 3600);
    if (!allowed) return json({ ok: false, error: 'rate_limited' }, 429);

    const url = new URL(request.url);
    const raw = url.searchParams.get('url') || '';

    // Length check before parse attempt
    if (!raw || raw.length > 2048) {
      return json({ ok: false, error: 'invalid_url' }, 400);
    }

    // Validate + SSRF-guard; parse-failure → 400, no cache
    try {
      new URL(raw);
    } catch {
      return json({ ok: false, error: 'invalid_url' }, 400);
    }

    const passesPolicy = isUnfurlableUrl(raw);

    // Compute KV key for ALL validated (but possibly policy-failing) URLs
    const cacheKey = 'unfurl:v1:' + (await sha256hex(raw));

    // For policy failures: negative-cache and 400
    if (!passesPolicy) {
      if (env.COMMUNITY_KV) {
        env.COMMUNITY_KV.put(cacheKey, JSON.stringify({ preview: null }), { expirationTtl: 21600 }).catch(() => {});
      }
      return json({ ok: false, error: 'invalid_url' }, 400);
    }

    // KV read (non-fatal on error)
    if (env.COMMUNITY_KV) {
      try {
        const cached = await env.COMMUNITY_KV.get(cacheKey, 'json');
        if (cached !== null) {
          return json({ ok: true, preview: cached.preview });
        }
      } catch {
        // KV read failure is non-fatal — fall through to live fetch
      }
    }

    // Live fetch with redirect loop (max 3 hops)
    const MAX_HOPS = 3;
    let currentUrl = raw;
    let finalResponse = null;
    let finalUrl = raw;

    try {
      for (let hop = 0; hop <= MAX_HOPS; hop++) {
        if (hop === MAX_HOPS) {
          // Exceeded hops — null preview
          finalResponse = null;
          break;
        }

        // DNS rebinding guard: resolve the hostname before each fetch hop
        const hopHost = new URL(currentUrl).hostname;
        const dnsOk = await resolveAndCheck(hopHost);
        if (!dnsOk) {
          finalResponse = null;
          break;
        }

        const resp = await fetch(currentUrl, {
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
          headers: {
            'Accept': 'text/html,application/xhtml+xml',
            'User-Agent': 'RRMAcademyBot/1.0 (+https://rrmacademy.org)',
          },
        });

        const status = resp.status;
        if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
          const location = resp.headers.get('Location');
          if (!location) {
            finalResponse = null;
            break;
          }
          const resolved = new URL(location, currentUrl).toString();
          if (!isUnfurlableUrl(resolved)) {
            finalResponse = null;
            break;
          }
          currentUrl = resolved;
          continue;
        }

        // Non-redirect — treat as final
        finalUrl = currentUrl;
        finalResponse = resp;
        break;
      }
    } catch {
      // Timeout or network error
      finalResponse = null;
    }

    // Evaluate final response
    let preview = null;

    if (finalResponse !== null) {
      if (finalResponse.ok) {
        const ct = finalResponse.headers.get('Content-Type') || '';
        if (ct.startsWith('text/html')) {
          const text = await readBodyCapped(finalResponse);
          if (text !== null) {
            const fields = await parseHtml(text, finalUrl);
            // Only return a preview if at least title or image is present
            if (fields.title !== null || fields.image !== null) {
              preview = {
                url: raw,
                title: fields.title,
                description: fields.description,
                image: fields.image,
                siteName: fields.siteName,
                domain: fields.domain,
              };
            }
          }
        }
      }
    }

    // Cache and respond
    const ttl = preview !== null ? 604800 : 21600;
    if (env.COMMUNITY_KV) {
      env.COMMUNITY_KV.put(cacheKey, JSON.stringify({ preview }), { expirationTtl: ttl }).catch(() => {});
    }

    return json({ ok: true, preview });
  } catch (err) {
    log(env, waitUntil, 'community', 'unfurl_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
