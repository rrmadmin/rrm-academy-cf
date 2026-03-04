import { json, optionsResponse, CORS_HEADERS } from '../auth/_shared.js';
import { requireMember } from './_shared.js';

var MAX_SIZE = 5 * 1024 * 1024; // 5 MB
var ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env;
  var member = await requireMember(request, env);
  if (member instanceof Response) return member;

  var ct = request.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data'))
    return json({ error: 'Multipart required' }, 400);

  var formData = await request.formData();
  var file = formData.get('file');
  if (!file || !file.size)
    return json({ error: 'No file provided' }, 400);

  if (file.size > MAX_SIZE)
    return json({ error: 'File too large (max 5 MB)' }, 413);

  var ext = ALLOWED[file.type];
  if (!ext)
    return json({ error: 'Unsupported file type' }, 400);

  var id = crypto.randomUUID();
  var key = 'community/' + id + '.' + ext;

  await env.R2_ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  var url = '/api/assets/' + key;
  return new Response(JSON.stringify({ url: url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
