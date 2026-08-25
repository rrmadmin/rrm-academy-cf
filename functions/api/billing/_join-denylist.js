/**
 * STUC membership join denylist -- these emails may donate one-time but may
 * never hold a STUC membership NOR make a STUC-context donation; non-STUC
 * donations are allowed. Blocks are silent/generic by design.
 * Prefixed with _ so CF Pages doesn't treat it as a route.
 */
const DENIED_EMAILS = new Set([
  'drduane@factsaboutfertility.org',
  'margueritekenny@yahoo.com',
  'duanem@duq.edu',
  'mduanemd@icloud.com',
  'mduanemd@gmail.com',
  'mduanemd@yahoo.com',
  'drduane@mdforlife.org',
  'info@factsaboutfertility.org',
]);

export function isJoinDenied(email) {
  if (!email || typeof email !== 'string') return false;
  return DENIED_EMAILS.has(email.toLowerCase().trim());
}

/**
 * Detects whether a checkout was initiated in STUC context, using the same
 * page_location signal create-checkout.js already sends to GA4
 * (entry_url || Referer header) plus the session-scoped entry_referrer and
 * an optional campaign tag.
 */
export function isStucContextRequest(request, entryUrl, entryReferrer, campaign) {
  if (campaign === 'stuc') return true;
  const pageLocation = entryUrl || request.headers.get('Referer') || '';
  if (pageLocation.includes('/save-the-uterus-club')) return true;
  if ((entryReferrer || '').includes('/save-the-uterus-club')) return true;
  return false;
}

/**
 * First 3 chars + domain, for logging without leaking the full address.
 * The redaction in _log.js already scrubs full emails from Analytics Engine,
 * but log messages meant for direct human review (masked, not raw) still
 * follow this convention at every call site.
 */
export function maskEmailForLog(email) {
  const trimmed = (email || '').toString().trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) return '(no-email)';
  return `${trimmed.slice(0, 3)}***${trimmed.slice(at)}`;
}
