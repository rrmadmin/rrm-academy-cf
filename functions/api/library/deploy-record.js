/**
 * POST /api/library/deploy-record
 *
 * Called by the Airtable automation when "Sync to RRM Library" flips to "Synced".
 * Triggers a CF Pages rebuild so the new article appears on rrmacademy.org/library.
 *
 * The library is SSG — articles.json is rebuilt from Airtable at build time.
 * This endpoint triggers a GitHub Actions rebuild via repository_dispatch.
 *
 * Required env vars (CF Pages secrets):
 *   DEPLOY_SECRET        — shared secret for Airtable automation auth
 *   GITHUB_DEPLOY_TOKEN  — GitHub PAT with repo scope (for repository_dispatch)
 *
 * Request body (from Airtable automation):
 *   { "recordId": "recXXXXXXXXXXXXXX" }
 */

var GITHUB_REPO = 'rrmadmin/rrm-academy-cf';

export async function onRequestPost(context) {
  var { request, env } = context;

  // Auth — simple shared secret in header
  var secret = request.headers.get('X-Deploy-Secret') || '';
  if (!env.DEPLOY_SECRET || secret !== env.DEPLOY_SECRET) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse body
  var body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  var recordId = body.recordId || '';
  console.log('[deploy-record] Triggered by Airtable record:', recordId);

  // Trigger GitHub Actions rebuild via repository_dispatch
  var ghToken = env.GITHUB_DEPLOY_TOKEN;
  if (!ghToken) {
    console.error('[deploy-record] GITHUB_DEPLOY_TOKEN not configured');
    return new Response(JSON.stringify({ error: 'GitHub token not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    var ghResp = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/dispatches', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + ghToken,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'rrm-academy-deploy',
      },
      body: JSON.stringify({
        event_type: 'publish',
        client_payload: { recordId: recordId },
      }),
    });

    if (ghResp.status !== 204) {
      var ghBody = await ghResp.text().catch(function () { return ''; });
      console.error('[deploy-record] GitHub dispatch failed:', ghResp.status, ghBody);
      return new Response(JSON.stringify({
        error: 'GitHub dispatch failed',
        status: ghResp.status,
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.log('[deploy-record] Rebuild triggered for record:', recordId);
    return new Response(JSON.stringify({
      success: true,
      recordId: recordId,
      message: 'Site rebuild triggered via GitHub Actions',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[deploy-record] Error triggering deploy:', e.message);
    return new Response(JSON.stringify({ error: 'Deploy trigger failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
