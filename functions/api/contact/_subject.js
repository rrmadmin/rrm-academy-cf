/**
 * Builds the SES email subject for /api/contact/submit.
 *
 * Format: [Contact][<UPPER_CATEGORY>] <sanitized first 80 chars[…]>
 *
 * Sanitization (mandatory before slicing):
 *   - strip control chars (\x00-\x1f, \x7f) — covers CR/LF
 *   - strip Unicode bidirectional controls (LRE/RLE/PDF/LRO/RLO/LRI/RLI/FSI/PDI:
 *     U+202A–U+202E + U+2066–U+2069)
 *   - collapse runs of whitespace to single space
 *   - trim
 *
 * The [Contact] outer prefix is preserved so existing Gmail filters
 * keying on subject:[Contact] continue to match.
 */

// eslint-disable-next-line no-control-regex -- intentional: strip control chars and bidi controls
const CONTROL_OR_BIDI_RE = /[\x00-\x1f\x7f‪-‮⁦-⁩]/g;

export function buildContactSubject(category, message) {
  const upper = String(category || 'other').toUpperCase();
  const sanitized = String(message || '')
    .replace(CONTROL_OR_BIDI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!sanitized) {
    return `[Contact][${upper}] (no preview)`;
  }
  const body = sanitized.length > 80 ? sanitized.slice(0, 80) + '…' : sanitized;
  return `[Contact][${upper}] ${body}`;
}
