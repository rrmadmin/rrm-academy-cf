/**
 * Shared community helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import Stripe from 'stripe';
import {
  json, getSessionIdFromCookie, validateSession,
  STRIPE_API_VERSION, roleAtLeast,
} from '../auth/_shared.js';

export { roleAtLeast };

// --- Tier badge labels (from user_label table, Wix-imported) ---

export const TIER_LABEL_MAP = {
  'Uterus Member 🐻': 'member',
  'Uterus Hero 💖': 'hero',
  'Uterus Super Hero 🦸‍♀️': 'superhero',
};

export const TIER_LABELS = Object.keys(TIER_LABEL_MAP);

export function tierFromLabel(label) {
  return label ? (TIER_LABEL_MAP[label] || null) : null;
}

export const TIER_DISPLAY = {
  member: '🐻 Member',
  hero: '💖 Hero',
  superhero: '🦸‍♀️ Superhero',
};

// Inverted map: tier name -> canonical label string used in user_label table.
export const LABEL_FOR_TIER = Object.fromEntries(
  Object.entries(TIER_LABEL_MAP).map(([label, tier]) => [tier, label])
);

/**
 * Derive a STUC tier ('member' | 'hero' | 'superhero') from a Stripe subscription object.
 *
 * Resolution order:
 *   1. subscription.metadata.tier (set by create-checkout subscription_data.metadata)
 *   2. price ID match against STRIPE_PRICE_* env vars
 *   3. unit_amount fallback for tier_custom price_data subscriptions:
 *      >= 9900 cents -> superhero, >= 1900 -> hero, else -> member
 *
 * Always returns a string ('member' | 'hero' | 'superhero'), never null.
 * Defaults to 'member' when no signal is available.
 *
 * @param {object} sub - Stripe subscription object
 * @param {object} env - CF Pages env (STRIPE_PRICE_MEMBER, STRIPE_PRICE_HERO, STRIPE_PRICE_SUPERHERO)
 * @returns {'member'|'hero'|'superhero'}
 */
export function tierFromPriceOrAmount(sub, env) {
  const VALID_TIERS = new Set(['member', 'hero', 'superhero']);

  const metaTier = sub.metadata?.tier;
  if (metaTier && VALID_TIERS.has(metaTier)) return metaTier;

  const priceToTier = {};
  if (env.STRIPE_PRICE_MEMBER) priceToTier[env.STRIPE_PRICE_MEMBER] = 'member';
  if (env.STRIPE_PRICE_HERO) priceToTier[env.STRIPE_PRICE_HERO] = 'hero';
  if (env.STRIPE_PRICE_SUPERHERO) priceToTier[env.STRIPE_PRICE_SUPERHERO] = 'superhero';

  const price = sub.items?.data?.[0]?.price;
  if (price?.id && priceToTier[price.id]) return priceToTier[price.id];

  const unitAmount = price?.unit_amount ?? 0;
  if (unitAmount >= 9900) return 'superhero';
  if (unitAmount >= 1900) return 'hero';
  return 'member';
}

// --- Post type permissions ---

const STAFF_ONLY_TYPES = ['announcement', 'event', 'resource'];

export function canCreateType(role, type) {
  if (STAFF_ONLY_TYPES.includes(type)) return roleAtLeast(role, 'admin');
  return true; // anyone can create 'discussion'
}

export function canEditPost(role, userId, post) {
  if (roleAtLeast(role, 'admin')) return true;
  return userId === post.author_id;
}

export function canDeletePost(role, userId, post) {
  if (roleAtLeast(role, 'admin')) return true;
  return userId === post.author_id;
}

export function canPin(role) {
  return roleAtLeast(role, 'mod');
}

export function canDeleteComment(role, userId, comment) {
  if (roleAtLeast(role, 'mod')) return true;
  return userId === comment.author_id;
}

export function canResolveFlag(role) {
  return roleAtLeast(role, 'admin');
}

export function canManageRoles(role) {
  return roleAtLeast(role, 'admin');
}

export function canSetRole(assignerRole, targetRole) {
  if (targetRole === 'superadmin') return assignerRole === 'superadmin';
  return roleAtLeast(assignerRole, 'admin');
}

// --- Membership gate ---

/**
 * Validates session + active STUC subscription.
 * Returns { user, tier, session } or a Response (401/403/500).
 */
export async function requireMember(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  const user = await db.prepare(
    'SELECT id, email, name, first_name, last_name, role, stripe_customer_id, avatar_url, blocked, email_verified FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return json({ ok: false, error: 'User not found' }, 401);
  if (user.blocked) return json({ ok: false, error: 'Account suspended' }, 403);

  // Staff bypass subscription check — they always have access (exempt from email_verified gate too)
  if (roleAtLeast(user.role, 'mod')) {
    return { user, tier: 'staff', session };
  }

  if (!user.email_verified) {
    return json({ ok: false, error: 'Please verify your email before posting. Check your inbox for the verification link.' }, 403);
  }

  // Explicit legacy grandfather allowlist — off-D1 Wix Pricing Plan payers with no
  // wix_subscription row and no Stripe customer. Deliberately maintained label
  // ('STUC Legacy Grandfather'), NOT payment-synced. Membership policy decision.
  const grandfather = await db.prepare(
    "SELECT 1 FROM user_label WHERE user_id = ? AND label = 'STUC Legacy Grandfather' LIMIT 1"
  ).bind(user.id).first();
  if (grandfather) {
    return { user, tier: 'member', session };
  }

  // Active + recent Wix subscriber. Require payment recency so a stale 'active' row
  // (a lapsed sub frozen because it fell out of the Wix feed) does NOT grant access.
  // Recency mirrors the rrm-wix-sync worker's deriveStatus grace (MONTH ~35d).
  let wixLookupFailed = false;
  try {
    const wixSub = await db.prepare(
      `SELECT tier FROM wix_subscription
         WHERE (user_id = ? OR email = ? COLLATE NOCASE)
           AND status = 'active'
           AND COALESCE(next_expected_at, datetime(last_order_at, '+31 days')) >= datetime('now', '-7 days')
         ORDER BY last_order_at DESC LIMIT 1`
    ).bind(user.id, user.email).first();
    if (wixSub) {
      return { user, tier: wixSub.tier || 'member', session };
    }
  } catch (err) {
    console.error('requireMember wix lookup failed:', err.message);
    wixLookupFailed = true;
  }

  // Members need an active subscription
  if (!env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY not configured');
    return json({ ok: false, error: 'Server configuration error' }, 500);
  }
  if (wixLookupFailed && !user.stripe_customer_id) {
    return json({ ok: false, error: 'Membership check temporarily unavailable. Please retry.' }, 503);
  }
  if (!user.stripe_customer_id) {
    const anyWixForEmail = await db.prepare(
      'SELECT 1 FROM wix_subscription WHERE email = ? COLLATE NOCASE LIMIT 1'
    ).bind(user.email).first();
    if (anyWixForEmail) {
      return json({ ok: false, error: "We can't find an active membership tied to " + user.email + ". If you donated with a different email, contact administrator@rrmacademy.org and we'll link the accounts." }, 403);
    }
    return json({ ok: false, error: 'Membership required' }, 403);
  }

  // KV cache: avoid hitting Stripe on every community request (300s TTL)
  const cacheKey = `member_sub:${user.id}`;
  if (env.COMMUNITY_KV) {
    try {
      const cached = await env.COMMUNITY_KV.get(cacheKey, 'json');
      if (cached) {
        return { user, tier: cached.tier, session };
      }
    } catch {
      // KV read failure is non-fatal — fall through to Stripe
    }
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: STRIPE_API_VERSION,
  });

  let subs;
  try {
    subs = await stripe.subscriptions.list({
      customer: user.stripe_customer_id,
      limit: 10,
    });
  } catch (err) {
    console.error('Stripe API error in requireMember:', err.message);
    return json({ ok: false, error: 'Unable to verify membership. Please try again.' }, 503);
  }

  const validSub = subs.data.find(s => ['active', 'trialing', 'past_due'].includes(s.status));
  if (!validSub) {
    return json({ ok: false, error: 'Membership required' }, 403);
  }

  const priceToTier = {};
  if (env.STRIPE_PRICE_MEMBER) priceToTier[env.STRIPE_PRICE_MEMBER] = 'member';
  if (env.STRIPE_PRICE_HERO) priceToTier[env.STRIPE_PRICE_HERO] = 'hero';
  if (env.STRIPE_PRICE_SUPERHERO) priceToTier[env.STRIPE_PRICE_SUPERHERO] = 'superhero';

  const price = validSub.items.data[0]?.price;
  const tier = priceToTier[price?.id] || 'member';

  if (env.COMMUNITY_KV) {
    env.COMMUNITY_KV.put(cacheKey, JSON.stringify({ tier }), { expirationTtl: 300 }).catch(() => {});
  }

  return { user, tier, session };
}

// --- Display name helper ---

export function displayName(user) {
  if (user.name) return user.name;
  if (user.first_name && user.last_name) return `${user.first_name} ${user.last_name.charAt(0)}.`;
  if (user.first_name) return user.first_name;
  return 'Member';
}

// --- Shared STUC member predicate ---
//
// Used by /api/community/members (roster) and notifyNewPost() to identify members
// eligible for roster display and auto-email. Includes staff bypass, explicit
// legacy grandfather allowlist, genuinely active+recent Wix subscribers, and
// active Stripe subscribers (identified by stripe_customer_id + STUC label).
// Stale 'active' Wix rows (frozen when a lapsed sub fell out of the Wix feed) are
// excluded via the COALESCE recency guard.
//
// Requires table alias `u` for the `user` table. Bind params: none.
export const STUC_MEMBER_WHERE = `
  u.blocked = 0 AND (
    u.role IN ('mod', 'admin', 'superadmin')
    OR u.id IN (SELECT user_id FROM user_label WHERE label = 'STUC Legacy Grandfather')
    OR EXISTS (
      SELECT 1 FROM wix_subscription ws
      WHERE (ws.user_id = u.id OR ws.email = u.email COLLATE NOCASE)
        AND ws.status = 'active'
        AND COALESCE(ws.next_expected_at, datetime(ws.last_order_at, '+31 days')) >= datetime('now', '-7 days')
    )
    OR (
      u.stripe_customer_id IS NOT NULL
      AND u.id IN (SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}')
    )
  )
`.trim();
