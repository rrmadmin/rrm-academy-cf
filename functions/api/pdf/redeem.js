import { log } from '../_log.js';
import { SITE_URL } from '../auth/_shared.js';
import { GUIDE_PDFS } from '../_guide-pdfs.js';

export async function onRequestGet(context) {
  const { request, env, waitUntil } = context;

  if (!env.DB) {
    log(env, waitUntil, 'pdf', 'config_missing', 'error', 'DB binding not configured', 0, 500);
    return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302);
  }
  if (!env.R2_ASSETS) {
    log(env, waitUntil, 'pdf', 'config_missing', 'error', 'R2_ASSETS binding not configured', 0, 500);
    return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302);
  }

  const token = new URL(request.url).searchParams.get('token');
  if (!token) {
    return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302);
  }

  try {
    const row = await env.DB.prepare(
      'SELECT * FROM pdf_token WHERE token = ?'
    ).bind(token).first();

    if (!row) {
      return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302);
    }

    const guideConfig = GUIDE_PDFS[row.guide_slug];
    const pagePath = guideConfig?.pagePath || '/guides/';

    if (row.expires_at < Math.floor(Date.now() / 1000)) {
      return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=expired`, 302);
    }

    if (row.used_at) {
      return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=used`, 302);
    }

    const result = await env.DB.prepare(
      'UPDATE pdf_token SET used_at = unixepoch() WHERE token = ? AND used_at IS NULL'
    ).bind(token).run();

    if (result.meta.changes === 0) {
      return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=used`, 302);
    }

    let obj;
    try {
      obj = await env.R2_ASSETS.get(guideConfig.r2Key);
    } catch (err) {
      log(env, waitUntil, 'pdf', 'r2_fetch_error', 'error', err.message, 0, 502);
      await env.DB.prepare(
        'UPDATE pdf_token SET used_at = NULL WHERE token = ?'
      ).bind(token).run();
      return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=unavailable`, 302);
    }

    if (!obj) {
      await env.DB.prepare(
        'UPDATE pdf_token SET used_at = NULL WHERE token = ?'
      ).bind(token).run();
      return Response.redirect(`${SITE_URL}${pagePath}?pdf_error=unavailable`, 302);
    }

    log(env, waitUntil, 'pdf', 'redeem', 'ok', row.guide_slug, 0, 200);

    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${row.guide_slug}.pdf"`,
        'Content-Length': String(obj.size),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    log(env, waitUntil, 'pdf', 'redeem_fail', 'error', err.message, 0, 500);
    return Response.redirect(`${SITE_URL}/guides/?pdf_error=notfound`, 302);
  }
}
