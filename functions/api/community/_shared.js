/**
 * Shared community helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import Stripe from 'stripe';
import {
  json, getSessionIdFromCookie, validateSession,
  STRIPE_API_VERSION,
} from '../auth/_shared.js';

// --- Role hierarchy ---

const ROLES = ['member', 'mod', 'admin', 'superadmin'];

export function roleAtLeast(userRole, minRole) {
  return ROLES.indexOf(userRole) >= ROLES.indexOf(minRole);
}

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
    'SELECT id, email, name, first_name, last_name, role, stripe_customer_id, avatar_url FROM user WHERE id = ?'
  ).bind(session.userId).first();
  if (!user) return json({ ok: false, error: 'User not found' }, 401);

  // Staff bypass subscription check — they always have access
  if (roleAtLeast(user.role, 'mod')) {
    return { user, tier: 'staff', session };
  }

  // Grandfathered Wix STUC members — label-based bypass
  const stucLabel = await db.prepare(
    "SELECT 1 FROM user_label WHERE user_id = ? AND label = 'Save the Uterus Club 🏷️' LIMIT 1"
  ).bind(user.id).first();
  if (stucLabel) {
    return { user, tier: 'member', session };
  }

  // Members need an active subscription
  if (!env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY not configured');
    return json({ ok: false, error: 'Server configuration error' }, 500);
  }
  if (!user.stripe_customer_id) {
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
      status: 'active',
      limit: 1,
    });
  } catch (err) {
    console.error('Stripe API error in requireMember:', err.message);
    return json({ ok: false, error: 'Unable to verify membership. Please try again.' }, 503);
  }

  if (!subs.data.length) {
    return json({ ok: false, error: 'Membership required' }, 403);
  }

  const priceToTier = {};
  if (env.STRIPE_PRICE_MEMBER) priceToTier[env.STRIPE_PRICE_MEMBER] = 'member';
  if (env.STRIPE_PRICE_HERO) priceToTier[env.STRIPE_PRICE_HERO] = 'hero';
  if (env.STRIPE_PRICE_SUPERHERO) priceToTier[env.STRIPE_PRICE_SUPERHERO] = 'superhero';

  const price = subs.data[0].items.data[0]?.price;
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
