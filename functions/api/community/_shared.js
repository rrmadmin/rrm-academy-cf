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
  if (!user.email_verified) {
    return json({ ok: false, error: 'Please verify your email before posting. Check your inbox for the verification link.' }, 403);
  }

  // Staff bypass subscription check — they always have access
  if (roleAtLeast(user.role, 'mod')) {
    return { user, tier: 'staff', session };
  }

  // Grandfathered Wix STUC members — label bypass, but only if no cancelled-subscription
  // override. A user whose wix_subscription.status='inactive' for ALL their rows has
  // cancelled and loses grandfather access; they must re-subscribe.
  const stucLabel = await db.prepare(
    "SELECT 1 FROM user_label WHERE user_id = ? AND label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}' LIMIT 1"
  ).bind(user.id).first();
  if (stucLabel) {
    const cancelledOverride = await db.prepare(
      `SELECT 1
         FROM wix_subscription ws
         WHERE (ws.user_id = ? OR ws.email = ? COLLATE NOCASE)
         AND NOT EXISTS (
           SELECT 1 FROM wix_subscription ws2
           WHERE (ws2.user_id = ? OR ws2.email = ? COLLATE NOCASE)
           AND ws2.status = 'active'
         )
         LIMIT 1`
    ).bind(user.id, user.email, user.id, user.email).first();
    if (!cancelledOverride) {
      return { user, tier: 'member', session };
    }
    // Falls through to subscription checks below (which will 403 unless they have a Stripe sub).
  }

  // Active Wix subscribers (new grandfather path, covers donors missing the legacy label)
  let wixLookupFailed = false;
  try {
    const wixSub = await db.prepare(
      "SELECT tier FROM wix_subscription WHERE (user_id = ? OR email = ? COLLATE NOCASE) AND status = 'active' LIMIT 1"
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
      'SELECT id FROM wix_subscription WHERE email = ? COLLATE NOCASE LIMIT 1'
    ).bind(user.email).first();
    if (anyWixForEmail) {
      return json({ ok: false, error: "We can't find an active membership tied to " + user.email + ". If you donated with a different email, contact administrator@rrmacademy.org and we'll link the accounts." }, 403);
    }
    return json({ ok: false, error: 'Membership required' }, 403);
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
// eligible for roster display and auto-email. Includes staff bypass, label-based
// grandfather, and filters out users whose Wix subscriptions have ALL been cancelled.
// Users with NO wix_subscription row stay included (covers Ginny, Amanda, and any
// off-D1 paid subscriptions like the legacy Wix Pricing Plan).
//
// Requires table alias `u` for the `user` table. Bind params: none.
export const STUC_MEMBER_WHERE = `
  u.blocked = 0 AND (
    u.role IN ('mod', 'admin', 'superadmin')
    OR (
      (
        u.id IN (SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}')
        OR u.id IN (SELECT user_id FROM user_label WHERE label IN ('Uterus Member \u{1F43B}', 'Uterus Hero \u{1F496}', 'Uterus Super Hero \u{1F9B8}\u{200D}\u{2640}\u{FE0F}'))
      )
      AND (
        NOT EXISTS (SELECT 1 FROM wix_subscription ws WHERE (ws.user_id = u.id OR ws.email = u.email COLLATE NOCASE))
        OR EXISTS (SELECT 1 FROM wix_subscription ws WHERE (ws.user_id = u.id OR ws.email = u.email COLLATE NOCASE) AND ws.status = 'active')
      )
    )
  )
`.trim();
