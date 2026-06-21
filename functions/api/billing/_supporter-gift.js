/**
 * Supporter recognition helpers (provider-directory social proof, Phase 1).
 * Spec: docs/superpowers/specs/2026-06-19-provider-directory-social-proof-recognition-design.md
 * Privacy: produces ONLY a server-derived "First L." public string; never stores full name/amount.
 */

const IMPERSONATION = /\b(rrm|academy|official|foundation|whittaker|naomi|boyle|hilgers|admin|staff|moderator)\b/i;
const STRIP_RE = /[\u202A-\u202E\u2066-\u2069\u200B-\u200D\uFEFF<>&"'/]/g; // bidi, zero-width, html-significant

/** Pure. Returns the public "First L." form or null (caller writes no row). */
export function deriveDisplayName(rawName) {
  if (typeof rawName !== 'string') return null;
  let n = rawName.normalize('NFKC').replace(STRIP_RE, '').replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (IMPERSONATION.test(n)) return null;
  const tokens = n.split(' ').filter(Boolean);
  let out = tokens.length >= 2 ? `${tokens[0]} ${tokens[tokens.length - 1][0]}.` : tokens[0];
  const chars = [...out];
  if (chars.length > 40) out = chars.slice(0, 40).join('');
  return out || null;
}

/** Reads the show_supporter dropdown by KEY (never by array index). */
export function readSupporterConsent(session) {
  const fields = (session && Array.isArray(session.custom_fields)) ? session.custom_fields : [];
  const f = fields.find((c) => c && c.key === 'show_supporter');
  return f?.dropdown?.value === 'yes';
}

/** Idempotent insert. Explicit columns. id is generated here (never NULL). */
export async function recordSupporterGift(db, gift) {
  const displayName = gift && typeof gift.displayName === 'string' ? gift.displayName : '';
  if (!displayName) return { recorded: false };
  if (!gift.sourceId || typeof gift.giftSeq !== 'number' || gift.giftSeq < 1) return { recorded: false };
  const id = 'sr_' + crypto.randomUUID();
  await db.prepare(
    `INSERT INTO supporter_recognition
       (id, campaign, display_name, gift_seq, email, source, source_id, occurred_at)
     VALUES (?, ?, ?, ?, ?, 'stripe', ?, ?)
     ON CONFLICT(source, source_id) DO NOTHING`
  ).bind(
    id,
    gift.campaign || 'provider-directory',
    displayName,
    gift.giftSeq,
    (gift.email || '').toLowerCase().trim() || null,
    String(gift.sourceId),
    gift.occurredAt,
  ).run();
  return { recorded: true };
}

/** Refund / removal tombstone. */
export async function removeSupporterGift(db, { source, sourceId }) {
  if (!sourceId) return;
  await db.prepare(
    'DELETE FROM supporter_recognition WHERE source = ? AND source_id = ?'
  ).bind(source || 'stripe', String(sourceId)).run();
}
