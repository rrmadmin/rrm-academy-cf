import { json, optionsResponse, checkRateLimit } from './auth/_shared.js';
import { getStripeClient } from './billing/_shared.js';
import { countCampaignGifts } from './billing/_campaign-count.js';

const CAMPAIGN = 'provider-directory';
const FOUNDING_CAP = 100;
const KV_KEY = `fund-supporters:${CAMPAIGN}`;
const KV_TTL = 60;
const EMPTY = {
  ok: true, total_gifts: 0, consented_count: 0, recent: [], founding: [],
  founding_cap: FOUNDING_CAP, founding_left: FOUNDING_CAP, founding_closed: false, anonymous_founders: 0,
};

export async function onRequestOptions() { return optionsResponse(); }
export async function onRequestHead(ctx) { return onRequestGet(ctx); }

export async function onRequestGet({ request, env, waitUntil }) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!await checkRateLimit(env, `fund-supporters:${ip}`, 30, 60)) {
    return json({ error: 'rate_limited' }, 429);
  }
  if (env.COMMUNITY_KV) {
    try { const c = await env.COMMUNITY_KV.get(KV_KEY); if (c) return json(JSON.parse(c)); } catch {}
  }
  try {
    // total_gifts: prefer the fund-progress KV (written by /api/fund-progress every 60s).
    // When the KV is cold or expired, recompute from Stripe so founding_left is never
    // falsely pinned at FOUNDING_CAP. stripeRecomputed tracks whether Stripe was used
    // so we do NOT cache a cold-recomputed result when Stripe is unavailable (total=0).
    let total = 0;
    let kvHit = false;
    let stripeRecomputed = false;
    if (env.COMMUNITY_KV) {
      try {
        const fp = await env.COMMUNITY_KV.get(`fund-progress:${CAMPAIGN}`);
        if (fp) {
          const p = JSON.parse(fp);
          if (typeof p.count === 'number') { total = Math.max(0, p.count); kvHit = true; }
        }
      } catch {}
    }
    if (!kvHit && env.STRIPE_SECRET_KEY) {
      try {
        const stripe = getStripeClient(env);
        total = await countCampaignGifts(stripe, CAMPAIGN);
        stripeRecomputed = true;
      } catch {}
    }
    let recent = [], founding = [], consented = 0;
    if (env.DB) {
      const url = new URL(request.url);
      const limit = Math.min(12, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12));
      const r = await env.DB.prepare(
        'SELECT display_name, gift_seq FROM supporter_recognition WHERE campaign = ? ORDER BY occurred_at DESC LIMIT ?'
      ).bind(CAMPAIGN, limit).all();
      recent = (r.results || []).map((x) => ({ displayName: x.display_name, seq: x.gift_seq }));
      const f = await env.DB.prepare(
        'SELECT display_name, gift_seq FROM supporter_recognition WHERE campaign = ? AND gift_seq <= ? ORDER BY gift_seq ASC'
      ).bind(CAMPAIGN, FOUNDING_CAP).all();
      founding = (f.results || []).map((x) => ({ displayName: x.display_name, seq: x.gift_seq }));
      const c = await env.DB.prepare(
        'SELECT COUNT(*) AS n FROM supporter_recognition WHERE campaign = ?'
      ).bind(CAMPAIGN).first();
      consented = c?.n || 0;
    }
    const founding_left = Math.max(0, FOUNDING_CAP - total);
    const result = {
      ok: true, total_gifts: total, consented_count: consented, recent, founding,
      founding_cap: FOUNDING_CAP, founding_left, founding_closed: founding_left === 0,
      anonymous_founders: Math.max(0, Math.min(total, FOUNDING_CAP) - founding.length),
    };
    // Only cache when total came from a reliable source (KV hit OR successful Stripe recompute).
    // A cold read with STRIPE_SECRET_KEY absent yields total=0 -- do not pin that for 60s.
    if (env.COMMUNITY_KV && (kvHit || stripeRecomputed)) {
      waitUntil(env.COMMUNITY_KV.put(KV_KEY, JSON.stringify(result), { expirationTtl: KV_TTL }).catch(() => {}));
    }
    return json(result);
  } catch {
    return json(EMPTY);  // always-200, page always renders
  }
}
