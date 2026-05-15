/**
 * GET /api/providers
 * Build-time read endpoint for the Provider Directory.
 * Auth: Bearer LIBRARY_BUILD_TOKEN (same gate as /api/partners + /api/blog/posts).
 * Returns all listability != 'unlisted' provider records as JSON.
 * Used by src/lib/fetch-providers-data.mjs at build time.
 */
import { json, optionsResponse, constantTimeEqual } from '../auth/_shared.js';
import { log } from '../_log.js';

export function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  if (!env.LIBRARY_BUILD_TOKEN) {
    return json({ error: 'service_unavailable' }, 503);
  }

  if (!env.DB) {
    return json({ error: 'service_unavailable' }, 503);
  }

  const auth = request.headers.get('Authorization');
  if (!constantTimeEqual(auth, `Bearer ${env.LIBRARY_BUILD_TOKEN}`)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let results;
  try {
    const { results: rows } = await env.DB.prepare(
      `SELECT id, slug, entity_type, parent_id, name, credentials, bio, photo_url,
              primary_email, primary_phone, website_url, address_json,
              latitude, longitude, npi, methods_json, languages_json,
              telehealth, telehealth_states_licensed_json,
              telehealth_states_attested_json, telehealth_states_negative_json,
              accepting_new_patients, listability, relevance, verification_tier,
              badges_json, partner_id, verified_contact, do_not_contact,
              created_at, updated_at, last_verified_by_provider_at,
              source_records_json
       FROM provider
       WHERE listability IN ('full', 'basic', 'minimal')
       ORDER BY name`
    ).all();
    results = rows || [];
  } catch (err) {
    log(env, waitUntil, 'providers', 'list_error', 'error', err.message, 0, 500);
    return json({ error: 'internal_error' }, 500);
  }

  const providers = results.map((r) => ({
    id: r.id,
    slug: r.slug,
    entity_type: r.entity_type,
    parent_id: r.parent_id,
    name: r.name,
    credentials: r.credentials,
    bio: r.bio,
    photo_url: r.photo_url,
    primary_email: r.primary_email,
    primary_phone: r.primary_phone,
    website_url: r.website_url,
    address: r.address_json ? JSON.parse(r.address_json) : null,
    latitude: r.latitude,
    longitude: r.longitude,
    npi: r.npi,
    methods: r.methods_json ? JSON.parse(r.methods_json) : [],
    languages: r.languages_json ? JSON.parse(r.languages_json) : [],
    telehealth: r.telehealth || 'unknown',
    telehealth_states_licensed: r.telehealth_states_licensed_json ? JSON.parse(r.telehealth_states_licensed_json) : [],
    telehealth_states_attested: r.telehealth_states_attested_json ? JSON.parse(r.telehealth_states_attested_json) : [],
    telehealth_states_negative: r.telehealth_states_negative_json ? JSON.parse(r.telehealth_states_negative_json) : [],
    accepting_new_patients: r.accepting_new_patients || 'unknown',
    listability: r.listability,
    relevance: r.relevance,
    verification_tier: r.verification_tier,
    badges: r.badges_json ? JSON.parse(r.badges_json) : [],
    partner_id: r.partner_id,
    verified_contact: r.verified_contact === 1,
    do_not_contact: r.do_not_contact === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_verified_by_provider_at: r.last_verified_by_provider_at,
    source_records: r.source_records_json ? JSON.parse(r.source_records_json) : [],
  }));

  return json({ ok: true, providers, count: providers.length }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
}
