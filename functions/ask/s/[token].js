/**
 * GET /ask/s/:token — public HTML view for a shared Q&A
 *
 * Server-rendered HTML. No auth. No JS required.
 * Validates token, queries D1, renders branded page with the Q&A.
 */

const TOKEN_RE = /^[0-9a-f]{32}$/;
const SITE_URL = 'https://rrmacademy.org';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.toString() : '';
  } catch {
    return '';
  }
}

function renderAnswer(text) {
  // Escape raw text first, then apply markdown-lite transformations on the escaped output.
  const escaped = escapeHtml(text);

  // Split into paragraphs on double newline (escaped as literal \n\n in content)
  const paragraphs = escaped.split(/\n\n+/);

  const rendered = paragraphs.map(para => {
    // Within each paragraph: apply inline transforms
    let p = para;
    // Bold: **text** -> <strong>text</strong>
    p = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Markdown link: [text](url) -> <a href="url">text</a> (safeUrl validated on raw URL)
    p = p.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, rawUrl) => {
      const href = safeUrl(rawUrl);
      if (!href) return escapeHtml(linkText);
      return `<a href="${escapeHtml(href)}" rel="noopener" target="_blank">${linkText}</a>`;
    });
    // Single newlines -> <br>
    p = p.replace(/\n/g, '<br>');
    return `<p>${p}</p>`;
  });

  return rendered.join('\n');
}

function htmlPage(token, row) {
  const canonicalUrl = `${SITE_URL}/ask/s/${escapeHtml(token)}`;
  const titleText = row.question.slice(0, 60);
  const pageTitle = escapeHtml(titleText) + ' — RRM Academy';
  const ogDescription = escapeHtml(row.answer.slice(0, 200));
  // Auto-generated OG card. functions/og/[[path]].js detects ask-<token>
  // slugs and queries D1 for the question. Bumping og-config.ts OG_VERSION
  // also busts these.
  const ogImage = `${SITE_URL}/og/ask-${escapeHtml(token)}.png?v=v1`;

  let citations = [];
  try { citations = JSON.parse(row.citations_json); } catch { /* leave empty */ }

  const citationsList = citations.length > 0
    ? `<ol class="citations">${citations.map(c => {
        const href = safeUrl(c.url || '');
        const label = escapeHtml(c.title || c.url || '');
        if (!href) return `<li>${label}</li>`;
        return `<li><a href="${escapeHtml(href)}" rel="noopener" target="_blank">${label}</a></li>`;
      }).join('\n')}</ol>`
    : '';

  const answerHtml = renderAnswer(row.answer);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <link rel="canonical" href="${canonicalUrl}">
  <title>${pageTitle}</title>
  <meta property="og:title" content="${escapeHtml(titleText)} — RRM Academy">
  <meta property="og:description" content="${ogDescription}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600&display=swap">
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: #faf9f7;
      color: #1a1a1a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 16px;
      line-height: 1.65;
    }
    .page-wrap {
      max-width: 720px;
      margin: 0 auto;
      padding: 32px 16px;
    }
    .site-header {
      margin-bottom: 40px;
    }
    .site-header a {
      font-family: "Cormorant Garamond", Georgia, serif;
      font-weight: 600;
      font-size: 1.375rem;
      color: #1a1a1a;
      text-decoration: none;
      letter-spacing: 0.01em;
    }
    .site-header a:hover {
      color: #6b4f8a;
    }
    .label {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b4f8a;
      margin-bottom: 8px;
    }
    .question-block {
      border-left: 3px solid #6b4f8a;
      padding-left: 12px;
      color: #555;
      font-style: italic;
      margin-bottom: 32px;
      font-size: 1.0625rem;
      line-height: 1.6;
    }
    .answer-block {
      margin-bottom: 32px;
    }
    .answer-block p {
      margin: 0 0 1em 0;
    }
    .answer-block p:last-child {
      margin-bottom: 0;
    }
    .citations-section {
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e0d8;
    }
    .citations-section h2 {
      font-family: "Cormorant Garamond", Georgia, serif;
      font-weight: 600;
      font-size: 1.125rem;
      color: #1a1a1a;
      margin: 0 0 12px 0;
    }
    ol.citations {
      margin: 0;
      padding-left: 1.5em;
    }
    ol.citations li {
      margin-bottom: 6px;
      font-size: 0.9375rem;
      color: #444;
    }
    ol.citations a {
      color: #6b4f8a;
      word-break: break-all;
    }
    ol.citations a:hover {
      text-decoration: none;
    }
    .cta-section {
      margin-top: 40px;
      padding: 24px;
      background: #f0ebf5;
      border: 1px solid #d8cce6;
      border-radius: 8px;
      text-align: center;
    }
    .cta-section p {
      margin: 0 0 16px 0;
      color: #3d2a52;
      font-size: 0.9375rem;
    }
    .cta-section a {
      display: inline-block;
      padding: 10px 22px;
      background: #6b4f8a;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-size: 0.9375rem;
      font-weight: 500;
      transition: background 0.15s;
    }
    .cta-section a:hover {
      background: #4c3568;
    }
    .site-footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid #e5e0d8;
      font-size: 0.8125rem;
      color: #888;
      line-height: 1.6;
    }
    .site-footer a {
      color: #888;
      text-decoration: underline;
    }
    .site-footer a:hover {
      color: #1a1a1a;
    }
  </style>
</head>
<body>
  <div class="page-wrap">
    <header class="site-header">
      <a href="/">RRM Academy</a>
    </header>
    <main>
      <div class="label">Question</div>
      <div class="question-block">${escapeHtml(row.question)}</div>
      <div class="answer-block">${answerHtml}</div>${citationsList ? `
      <div class="citations-section">
        <h2>Sources</h2>
        ${citationsList}
      </div>` : ''}
      <div class="cta-section">
        <p>Have questions about restorative reproductive medicine?</p>
        <a href="/ask/">Try Ask RRM Academy</a>
      </div>
    </main>
    <footer class="site-footer">
      Generated by <a href="/ask/">Ask RRM Academy</a>.
      Cited sources may be incomplete; verify against the linked research.
      &bull; <a href="/ask/">Back to Ask</a>
    </footer>
  </div>
</body>
</html>`;
}

function errorPage(status, message) {
  const safeMsg = escapeHtml(message);
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Not Found — RRM Academy</title>
  <style>
    body { margin: 0; padding: 32px 16px; background: #faf9f7; color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .wrap { max-width: 480px; margin: 0 auto; }
    .brand { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 600; font-size: 1.375rem; color: #1a1a1a; text-decoration: none; display: block; margin-bottom: 40px; }
    h1 { font-family: "Cormorant Garamond", Georgia, serif; font-weight: 600; font-size: 1.75rem; margin: 0 0 16px 0; }
    p { color: #555; }
    a.back { color: #6b4f8a; }
  </style>
</head>
<body>
  <div class="wrap">
    <a class="brand" href="/">RRM Academy</a>
    <h1>${status === 503 ? 'Service Unavailable' : 'Not Found'}</h1>
    <p>${safeMsg}</p>
    <p><a class="back" href="/ask/">Back to Ask RRM Academy</a></p>
  </div>
</body>
</html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function onRequest(context) {
  const { env, params } = context;

  if (!env.DB) {
    return errorPage(503, 'The service is temporarily unavailable. Please try again later.');
  }

  const token = params?.token || '';
  if (!TOKEN_RE.test(token)) {
    return errorPage(404, 'This shared Q&amp;A could not be found or the link is invalid.');
  }

  let row;
  try {
    row = await env.DB.prepare(
      'SELECT id, question, answer, citations_json FROM ask_saved WHERE id = ?'
    ).bind(token).first();
  } catch (err) {
    if (env.EVENTS) {
      env.EVENTS.writeDataPoint({
        blobs: ['rrm-academy', 'ask', 'shared_page_error', 'error', String(err?.message || '').slice(0, 200)],
        doubles: [0, 1, 500],
        indexes: ['shared_page_error'],
      });
    }
    return errorPage(503, 'The service is temporarily unavailable. Please try again later.');
  }

  if (!row) {
    return errorPage(404, 'This shared Q&amp;A could not be found or the link is invalid.');
  }

  return new Response(htmlPage(token, row), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
