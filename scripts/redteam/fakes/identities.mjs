/**
 * TURNING AN IDENTITY KEY INTO HEADERS.
 *
 * Hermetically every identity is real: the session cookies name rows this
 * harness seeded, and the forged one names a row it deliberately did not.
 * Nothing here signs anything the site would not have signed itself, which
 * is the point -- a "forged session" that the code could never have issued
 * proves nothing, and a valid one that the harness minted by hand would be
 * testing the harness.
 *
 * LIVE MODE CANNOT MINT A SESSION. Only the deployed site can write a
 * `session` row, so a live case that needs one reports SKIP with that reason
 * rather than passing on a 401 that proves only that the door is shut. The
 * identities live mode CAN supply are the ones an attacker can supply:
 * nothing, a forged cookie, a stale cookie, a wrong Bearer token.
 */

import { IDENTITIES } from '../targets.mjs';
import { SESSION_COOKIES, FORGED_COOKIE, EXPIRED_COOKIE, MEMBER_STORED_SESSION_ID, ADMIN_SECRET } from './env.mjs';

/** Identity kinds a live run can genuinely produce. */
const LIVE_CAPABLE = new Set(['none', 'forged', 'hint-only', 'bearer']);

export function identityHeaders(key, { mode }) {
  const identity = IDENTITIES[key];
  if (!identity) throw new Error(`redteam: no identity named ${key}`);

  if (mode === 'live' && !LIVE_CAPABLE.has(identity.kind)) {
    return { headers: null, skipReason: 'only the deployed site can mint a session row; live mode cannot supply this identity' };
  }

  switch (identity.kind) {
    case 'none':
      return { headers: {}, skipReason: null };
    case 'session':
      return { headers: { Cookie: `session=${SESSION_COOKIES[identity.user]}; rrm_auth=1` }, skipReason: null };
    case 'expired':
      return { headers: { Cookie: `session=${EXPIRED_COOKIE}; rrm_auth=1` }, skipReason: null };
    case 'forged':
      return { headers: { Cookie: `session=${FORGED_COOKIE}; rrm_auth=1` }, skipReason: null };
    case 'raw-hash':
      return { headers: { Cookie: `session=${MEMBER_STORED_SESSION_ID}; rrm_auth=1` }, skipReason: null };
    case 'hint-only':
      return { headers: { Cookie: 'rrm_auth=1' }, skipReason: null };
    case 'bearer':
      return { headers: { Authorization: `Bearer ${identity.token}` }, skipReason: null };
    default:
      throw new Error(`redteam: no header rule for identity kind ${identity.kind}`);
  }
}

/** The real admin Bearer header, for the ONE case that proves the door opens. */
export function adminBearer() {
  return { Authorization: `Bearer ${ADMIN_SECRET}` };
}

/**
 * A Stripe webhook signature over `payload`, computed the way Stripe
 * computes it, so a "valid signature" case is validated by
 * `constructEventAsync` rather than waved through.
 */
export async function stripeSignature(payload, secret, { timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
  return `t=${timestamp},v1=${hex}`;
}
