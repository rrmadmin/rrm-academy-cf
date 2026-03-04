/**
 * POST /api/admin/backlinks
 * Proxy endpoint for the backlinks dashboard.
 * Validates admin token, routes actions to the rrm-backlinks Worker.
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestPost(context) {
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

  // Validate backlinks service configuration
  if (!env.BACKLINKS_WORKER_URL || !env.BACKLINKS_API_TOKEN) {
    return json({ error: 'Backlinks service not configured' }, 503);
  }

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { action, params = {} } = body;

  if (!action) {
    return json({ error: 'Missing action field' }, 400);
  }

  const baseUrl = env.BACKLINKS_WORKER_URL.replace(/\/+$/, '');
  const workerHeaders = {
    'Authorization': `Bearer ${env.BACKLINKS_API_TOKEN}`,
    'Content-Type': 'application/json',
  };

  // Route action to Worker endpoint
  let workerUrl;
  let method = 'GET';

  switch (action) {
    case 'verify':
      workerUrl = `${baseUrl}/health`;
      break;

    case 'summary':
      workerUrl = `${baseUrl}/api/backlinks/summary`;
      break;

    case 'list': {
      const qs = new URLSearchParams();
      if (params.status) qs.set('status', params.status);
      if (params.domain) qs.set('domain', params.domain);
      if (params.source) qs.set('source', params.source);
      const query = qs.toString();
      workerUrl = `${baseUrl}/api/backlinks${query ? '?' + query : ''}`;
      break;
    }

    case 'changes':
      workerUrl = `${baseUrl}/api/backlinks/changes`;
      break;

    case 'top':
      workerUrl = `${baseUrl}/api/backlinks/top`;
      break;

    case 'check':
      if (!params.id || !/^\d+$/.test(String(params.id))) {
        return json({ error: 'Invalid or missing params.id' }, 400);
      }
      workerUrl = `${baseUrl}/api/check/${encodeURIComponent(params.id)}`;
      method = 'POST';
      break;

    default:
      return json({ error: `Unknown action: ${action}` }, 400);
  }

  // Forward request to Worker
  try {
    const workerResp = await fetch(workerUrl, { method, headers: workerHeaders });
    const data = await workerResp.json();
    return json(data, workerResp.status);
  } catch {
    return json({ error: 'Backlinks service unavailable' }, 502);
  }
}
