/**
 * GET /api/admin/seo
 * Proxy endpoint for the SEO health monitor dashboard.
 * Validates session-based admin auth, routes actions to the rrm-seo-monitor Worker.
 */
import { json, optionsResponse, requireSuperAdmin } from '../auth/_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // Session-based admin auth
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;

  // Validate SEO service configuration
  if (!env.SEO_MONITOR_API_TOKEN) {
    return json({ error: 'SEO service not configured' }, 503);
  }

  const baseUrl = 'https://rrm-seo-monitor.administrator-cloudflare.workers.dev';
  const workerHeaders = {
    'Authorization': `Bearer ${env.SEO_MONITOR_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // Route action to Worker endpoint
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'check';

  // Observatory actions proxy to rrm-observatory Worker
  if (action === 'observatory') {
    if (!env.OBSERVATORY_API_TOKEN) {
      return json({ error: 'Observatory service not configured' }, 503);
    }
    const obsUrl = 'https://rrm-observatory.administrator-cloudflare.workers.dev/api/health';
    try {
      const obsResp = await fetch(obsUrl, {
        headers: { 'Authorization': `Bearer ${env.OBSERVATORY_API_TOKEN}` },
      });
      const data = await obsResp.json();
      return json(data, obsResp.status);
    } catch {
      return json({ error: 'Observatory service unavailable' }, 502);
    }
  }

  let workerUrl;
  let method = 'GET';

  switch (action) {
    case 'check':
      workerUrl = `${baseUrl}/api/check`;
      break;

    case 'baseline':
      workerUrl = `${baseUrl}/api/baseline`;
      break;

    case 'cached':
      workerUrl = `${baseUrl}/api/baseline`;
      break;

    default:
      return json({ error: `Unknown action: ${action}` }, 400);
  }

  // Forward request to Worker
  try {
    const workerResp = await fetch(workerUrl, { method, headers: workerHeaders });
    const data = await workerResp.json();

    // For 'cached' action, extract last_results from baseline response
    if (action === 'cached') {
      const lastResults = data.last_results;
      if (lastResults) {
        try {
          return json(JSON.parse(lastResults));
        } catch {
          return json({ error: 'Invalid cached results' }, 500);
        }
      }
      return json({ error: 'No cached results available' }, 404);
    }

    return json(data, workerResp.status);
  } catch {
    return json({ error: 'SEO service unavailable' }, 502);
  }
}
