/**
 * Cloudflare Turnstile site key.
 *
 * Hardcoded because this is public (appears in client HTML) and the auth system
 * breaks silently if a build-time env var is missing. The secret key is still
 * stored as a CF Pages secret (CF_TURNSTILE_SECRET) and never leaves the server.
 *
 * If the widget is rotated in the CF dashboard, update this value and redeploy.
 */
export const TURNSTILE_SITE_KEY = '0x4AAAAAACgpzkB4TaFA-Jrx';
