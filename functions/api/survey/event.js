/**
 * POST /api/survey/event
 * Receives navigator.sendBeacon events from the endo survey results page.
 * Writes to Analytics Engine (ANALYTICS binding, dataset worker_events).
 * No auth required -- anonymous event tracking.
 */
import { CORS_HEADERS, optionsResponse } from '../auth/_shared.js';
import { log } from '../_log.js';

const ALLOWED_ACTIONS = ['calculate', 'download_pdf', 'copy_for_ai', 'follow_instagram'];

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;

  try {
    if (!env.ANALYTICS) {
      return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    let body;
    try {
      const text = await request.text();
      body = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const { action, viewport_width } = body;

    if (typeof action !== 'string' || !ALLOWED_ACTIONS.includes(action)) {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (typeof viewport_width !== 'number') {
      return new Response(JSON.stringify({ ok: false, error: 'viewport_width must be a number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    const device_type = viewport_width <= 768 ? 'mobile' : viewport_width <= 1024 ? 'tablet' : 'desktop';

    env.ANALYTICS.writeDataPoint({
      blobs: ['survey', 'survey_event', action, device_type, ''],
      doubles: [0, 0, viewport_width],
      indexes: [action],
    });

    return new Response(null, { status: 204, headers: CORS_HEADERS });
  } catch (err) {
    console.error(err);
    log(env, waitUntil, 'survey', 'event_fail', 'error', err.message);
    return new Response(JSON.stringify({ ok: false, error: 'An unexpected error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
}
