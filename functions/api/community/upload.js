import { json, optionsResponse, CORS_HEADERS, checkRateLimit } from '../auth/_shared.js';
import { requireMember } from './_shared.js';
import { log } from '../_log.js';

var MAX_SIZE = 5 * 1024 * 1024; // 5 MB
var ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost(context) {
  try {
    var request = context.request;
    var env = context.env;
    var waitUntil = context.waitUntil.bind(context);
    var member = await requireMember(request, env);
    if (member instanceof Response) return member;

    var ip = request.headers.get('cf-connecting-ip');
    if (!ip) return json({ error: 'service_unavailable' }, 503);
    var cupAllowed = await checkRateLimit(env, `cup:${ip}`, 10, 60);
    if (!cupAllowed) return json({ error: 'rate_limited' }, 429);

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

    var buf = await file.arrayBuffer();
    var bytes = new Uint8Array(buf);
    var isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    var isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
    var isWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    var isGif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
    var sniffedOk = (file.type === 'image/png' && isPng) ||
      (file.type === 'image/jpeg' && isJpeg) ||
      (file.type === 'image/webp' && isWebp) ||
      (file.type === 'image/gif' && isGif);
    if (!sniffedOk)
      return json({ error: 'File contents do not match declared type' }, 400);

    var id = crypto.randomUUID();
    var key = 'community/' + id + '.' + ext;

    try {
      await Promise.race([
        env.R2_ASSETS.put(key, buf, { httpMetadata: { contentType: file.type } }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('r2_put_timeout')), 10000)),
      ]);
    } catch (r2Err) {
      if (r2Err.message === 'r2_put_timeout') {
        log(env, waitUntil, 'community', 'upload_timeout', 'error', key, 0, 504);
        return json({ error: 'upload_timeout' }, 504);
      }
      throw r2Err;
    }

    var url = '/api/assets/' + key;
    return new Response(JSON.stringify({ url: url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    console.error('Upload error:', err.message);
    return json({ error: 'Upload failed' }, 500);
  }
}
