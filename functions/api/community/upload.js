import { requireMember } from './_shared.js';

var MAX_SIZE = 5 * 1024 * 1024; // 5 MB
var ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function onRequestPost(context) {
  var request = context.request;
  var env = context.env;
  var member = await requireMember(request, env);
  if (member instanceof Response) return member;

  var ct = request.headers.get('content-type') || '';
  if (!ct.startsWith('multipart/form-data'))
    return new Response(JSON.stringify({ error: 'Multipart required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  var formData = await request.formData();
  var file = formData.get('file');
  if (!file || !file.size)
    return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  if (file.size > MAX_SIZE)
    return new Response(JSON.stringify({ error: 'File too large (max 5 MB)' }), { status: 413, headers: { 'Content-Type': 'application/json' } });

  var ext = ALLOWED[file.type];
  if (!ext)
    return new Response(JSON.stringify({ error: 'Unsupported file type' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  var id = crypto.randomUUID();
  var key = 'community/' + id + '.' + ext;

  await env.R2_ASSETS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type },
  });

  var url = '/api/assets/' + key;
  return new Response(JSON.stringify({ url: url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
