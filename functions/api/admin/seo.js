/**
 * GET /api/admin/seo
 * Proxy endpoint for the SEO health monitor dashboard.
 * Validates admin token, routes actions to the rrm-seo-monitor Worker.
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://rrmacademy.org',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://rrmacademy.org',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  // Fail-closed: reject if ADMIN_TOKEN is not configured
  if (!env.ADMIN_TOKEN) {
    return json({ error: 'Admin not configured' }, 503);
  }

  // Validate bearer token
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== env.ADMIN_TOKEN) {
    return json({ error: 'Unauthorized' }, 401);
  }

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
