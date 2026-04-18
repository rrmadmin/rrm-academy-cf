/**
 * POST /api/partners/apply
 * Public, Turnstile-gated endpoint for Educational Partner applications.
 * Creates a pending record in the D1 `partners` table.
 */
import { json, optionsResponse, verifyTurnstile } from '../auth/_shared.js';
import { log } from '../_log.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AFFIRMATION_KEYS = ['find_the_cause', 'treat_the_disease', 'restore_function', 'rrm_scope'];

function generatePartnerId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'rec';
  for (let i = 0; i < 14; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  if (!env.DB) {
    return json({ error: 'service_unavailable' }, 503);
  }

  if (!env.CF_TURNSTILE_SECRET) {
    return json({ error: 'service_unavailable' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_input' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'invalid_input' }, 400);
  }

  const {
    name,
    site_url,
    country,
    city,
    provider_name,
    provider_credential,
    blurb,
    contact_email,
    affirmations,
    turnstile_token,
  } = body;

  // Validate required string fields
  if (typeof name !== 'string' || name.trim().length === 0) {
    return json({ error: 'name_required' }, 400);
  }
  if (name.length > 120) {
    return json({ error: 'name_too_long' }, 400);
  }

  if (typeof site_url !== 'string' || site_url.trim().length === 0) {
    return json({ error: 'site_url_required' }, 400);
  }
  if (site_url.length > 300) {
    return json({ error: 'site_url_too_long' }, 400);
  }
  if (!site_url.trim().startsWith('https://')) {
    return json({ error: 'site_url_must_be_https' }, 400);
  }

  if (typeof country !== 'string' || country.trim().length === 0) {
    return json({ error: 'country_required' }, 400);
  }
  if (country.length > 80) {
    return json({ error: 'country_too_long' }, 400);
  }

  if (city !== undefined && city !== null && city !== '') {
    if (typeof city !== 'string') {
      return json({ error: 'invalid_input' }, 400);
    }
    if (city.length > 80) {
      return json({ error: 'city_too_long' }, 400);
    }
  }

  if (typeof provider_name !== 'string' || provider_name.trim().length === 0) {
    return json({ error: 'provider_name_required' }, 400);
  }
  if (provider_name.length > 120) {
    return json({ error: 'provider_name_too_long' }, 400);
  }

  if (typeof provider_credential !== 'string' || provider_credential.trim().length === 0) {
    return json({ error: 'provider_credential_required' }, 400);
  }
  if (provider_credential.length > 80) {
    return json({ error: 'provider_credential_too_long' }, 400);
  }

  if (blurb !== undefined && blurb !== null && blurb !== '') {
    if (typeof blurb !== 'string') {
      return json({ error: 'invalid_input' }, 400);
    }
    if (blurb.length > 500) {
      return json({ error: 'blurb_too_long' }, 400);
    }
  }

  if (typeof contact_email !== 'string' || contact_email.trim().length === 0) {
    return json({ error: 'contact_email_required' }, 400);
  }
  if (contact_email.length > 200) {
    return json({ error: 'contact_email_too_long' }, 400);
  }
  if (!EMAIL_RE.test(contact_email.trim())) {
    return json({ error: 'contact_email_invalid' }, 400);
  }

  // Validate affirmations: must be object with all four keys, each strictly true
  if (typeof affirmations !== 'object' || affirmations === null || Array.isArray(affirmations)) {
    return json({ error: 'affirmations_required' }, 400);
  }
  for (const key of AFFIRMATION_KEYS) {
    if (affirmations[key] !== true) {
      return json({ error: 'affirmations_required' }, 400);
    }
  }

  // Verify Turnstile token
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  let turnstileOk;
  try {
    turnstileOk = await verifyTurnstile(env.CF_TURNSTILE_SECRET, turnstile_token, ip, env);
  } catch (err) {
    log(env, waitUntil, 'partners', 'turnstile_error', 'error', err.message, 0, 500);
    return json({ error: 'service_error' }, 500);
  }
  if (!turnstileOk) {
    return json({ error: 'invalid_turnstile' }, 400);
  }

  // Sanitize fields
  const trimmedName = name.trim();
  const trimmedSiteUrl = site_url.trim();
  const trimmedCountry = country.trim();
  const trimmedCity = (city && typeof city === 'string') ? city.trim() || null : null;
  const trimmedProviderName = provider_name.trim();
  const trimmedProviderCredential = provider_credential.trim();
  const trimmedBlurb = (blurb && typeof blurb === 'string') ? blurb.trim() || null : null;
  const trimmedEmail = contact_email.trim().toLowerCase();
  const affirmationsJson = JSON.stringify({
    find_the_cause: true,
    treat_the_disease: true,
    restore_function: true,
    rrm_scope: true,
  });

  const id = generatePartnerId();
  const baseSlug = slugify(trimmedName);

  // Attempt INSERT with slug collision retry up to 10 suffix variants
  const db = env.DB;
  const SUFFIXES = [null, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  for (const suffix of SUFFIXES) {
    const slug = suffix === null ? baseSlug : `${baseSlug}-${suffix}`;

    try {
      await db.prepare(`
        INSERT INTO partners (id, name, slug, site_url, country, city, provider_name, provider_credential, blurb, affirmations, contact_email, tier, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'friend', 'pending', datetime('now'))
      `).bind(
        id,
        trimmedName,
        slug,
        trimmedSiteUrl,
        trimmedCountry,
        trimmedCity,
        trimmedProviderName,
        trimmedProviderCredential,
        trimmedBlurb,
        affirmationsJson,
        trimmedEmail,
      ).run();

      log(env, waitUntil, 'partners', 'apply_success', 'ok', id, 0, 200);
      return json({ ok: true, id });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint')) {
        if (suffix === 10) {
          log(env, waitUntil, 'partners', 'slug_conflict', 'error', baseSlug, 0, 409);
          return json({ error: 'slug_conflict' }, 409);
        }
        continue;
      }
      log(env, waitUntil, 'partners', 'apply_error', 'error', err.message, 0, 500);
      return json({ error: 'internal_error' }, 500);
    }
  }

  return json({ error: 'slug_conflict' }, 409);
}
