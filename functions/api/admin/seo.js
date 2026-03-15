/**
 * GET /api/admin/seo
 * PUT /api/admin/seo?action=keywords
 * POST /api/admin/seo?action=dismiss
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

    case 'report':
      workerUrl = `${baseUrl}/api/report`;
      break;

    case 'history':
      workerUrl = `${baseUrl}/api/report/history`;
      break;

    case 'keywords':
      workerUrl = `${baseUrl}/api/keywords`;
      break;

    case 'alerts':
      workerUrl = `${baseUrl}/api/alerts`;
      break;

    case 'google-auth': {
      const authUrl = `${baseUrl}/api/auth/google`;
      try {
        const resp = await fetch(authUrl, { headers: workerHeaders, redirect: 'manual' });
        if (resp.status === 302) {
          return new Response(null, { status: 302, headers: { Location: resp.headers.get('Location') } });
        }
        const data = await resp.json();
        return json(data, resp.status);
      } catch {
        return json({ error: 'OAuth consent failed' }, 502);
      }
    }

    case 'google-callback': {
      const code = url.searchParams.get('code');
      const cbUrl = `${baseUrl}/api/auth/google/callback?code=${encodeURIComponent(code || '')}`;
      try {
        const resp = await fetch(cbUrl, { headers: workerHeaders, redirect: 'manual' });
        if (resp.status === 302) {
          return new Response(null, { status: 302, headers: { Location: '/admin/seo' } });
        }
        const data = await resp.json();
        return json(data, resp.status);
      } catch {
        return json({ error: 'OAuth callback failed' }, 502);
      }
    }

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

export async function onRequestPut(context) {
  const { request, env } = context;

  // Session-based admin auth
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;

  // Validate SEO service configuration
  if (!env.SEO_MONITOR_API_TOKEN) {
    return json({ error: 'SEO service not configured' }, 503);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action !== 'keywords') {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'Invalid payload' }, 400);

  const baseUrl = 'https://rrm-seo-monitor.administrator-cloudflare.workers.dev';
  const workerHeaders = {
    'Authorization': `Bearer ${env.SEO_MONITOR_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  try {
    const workerResp = await fetch(`${baseUrl}/api/keywords`, {
      method: 'PUT',
      headers: workerHeaders,
      body: JSON.stringify(body),
    });
    const data = await workerResp.json();
    return json(data, workerResp.status);
  } catch {
    return json({ error: 'SEO service unavailable' }, 502);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // Session-based admin auth
  const auth = await requireSuperAdmin(request, env.DB);
  if (auth instanceof Response) return auth;

  // Validate SEO service configuration
  if (!env.SEO_MONITOR_API_TOKEN) {
    return json({ error: 'SEO service not configured' }, 503);
  }

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action !== 'dismiss') {
    return json({ error: `Unknown action: ${action}` }, 400);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return json({ error: 'Invalid payload' }, 400);

  const baseUrl = 'https://rrm-seo-monitor.administrator-cloudflare.workers.dev';
  const workerHeaders = {
    'Authorization': `Bearer ${env.SEO_MONITOR_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  try {
    const workerResp = await fetch(`${baseUrl}/api/alerts/dismiss`, {
      method: 'POST',
      headers: workerHeaders,
      body: JSON.stringify(body),
    });
    const data = await workerResp.json();
    return json(data, workerResp.status);
  } catch {
    return json({ error: 'SEO service unavailable' }, 502);
  }
}
