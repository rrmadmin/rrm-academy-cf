import { test, expect } from '@playwright/test';

// Course-player surface boundary (anonymous callers only — verified against endpoint source).
//
// IMPORTANT: page gating on this site is CLIENT-SIDE + API-level, NOT server middleware.
// functions/_middleware.js does NOT redirect static HTML page routes (see memory
// cf-pages-middleware-static-route-bypass). Course pages — the /courses/ catalog, each
// sales page (src/pages/courses/[slug].astro), and every lesson-player step page
// (src/pages/courses/[slug]/[stepId].astro via getStaticPaths) — are BUILD-TIME STATIC
// and serve 200 anonymously. The real access boundary is the API surface:
//   - enroll / progress / quiz / comments / certificate / rendition / stream-token all
//     validate the session cookie FIRST and reject anonymous callers with 401.
//   - Enrollment/membership checks (403) sit behind that and are not probed here
//     (they would require a real session).
//
// PROD-SAFETY CONTRACT (hard): GETs and anonymous-rejection checks only — no enrollment
// is created, no progress written, no quiz submitted, no Stream token minted.
// Request volume: 1 request per endpoint.
//
// Run against the live site or a local wrangler pages dev:
//   COURSES_E2E_BASE=https://rrmacademy.org npx playwright test tests/e2e/course-player.spec.ts --project=desktop-chrome
// Not wired into CI (deploy.yml runs no e2e); this is a local + post-deploy regression aid.

const BASE = process.env.COURSES_E2E_BASE || 'http://localhost:8788';
test.use({ baseURL: BASE });

test.describe('Course pages — static shells serve 200 anonymously', () => {
  test('catalog -> sales page -> lesson step shell chain', async ({ request }) => {
    // 1. Catalog serves 200 and lists at least one course card link.
    const catalog = await request.get('/courses/', { maxRedirects: 0 });
    expect(catalog.status(), '/courses/ catalog is public').toBe(200);
    const catalogHtml = await catalog.text();
    const slugMatch = catalogHtml.match(/href="\/courses\/([a-z0-9-]+)\/"/);
    expect(slugMatch, 'catalog must contain at least one /courses/<slug>/ card link').toBeTruthy();
    const slug = slugMatch![1];

    // 2. First course sales page serves 200 anonymously.
    const sales = await request.get(`/courses/${slug}/`, { maxRedirects: 0 });
    expect(sales.status(), `sales page /courses/${slug}/ is public`).toBe(200);

    // 3. Lesson-player step pages are statically built (getStaticPaths in
    //    src/pages/courses/[slug]/[stepId].astro) — the shell serves 200 anonymously
    //    and client JS + the 401-gated APIs enforce access. Derive a real step URL
    //    from the sales page markup; not every sales page renders a step link
    //    (affiliate/coming-soon variants), so skip quietly when absent.
    const salesHtml = await sales.text();
    const stepMatch = salesHtml.match(new RegExp(`href="(/courses/${slug}/[a-z0-9][^/"]*/)"`));
    if (!stepMatch) {
      test.info().annotations.push({
        type: 'note',
        description: `no step link on /courses/${slug}/ (affiliate or gated CTA variant); step-shell check skipped`,
      });
      return;
    }
    const step = await request.get(stepMatch[1], { maxRedirects: 0 });
    expect(step.status(), `lesson step shell ${stepMatch[1]} is a public static shell`).toBe(200);
  });
});

test.describe('Course APIs reject anonymous callers before any side effect', () => {
  test('POST /api/courses/enroll anonymous -> 401', async ({ request }) => {
    // enroll.js: validateSession runs before body parse -> 401 'Not authenticated'.
    // No enrollment row and no Stripe checkout can be created on this path.
    const resp = await request.post('/api/courses/enroll', { data: {} });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });

  test('GET /api/courses/progress anonymous -> 401', async ({ request }) => {
    const resp = await request.get('/api/courses/progress', { maxRedirects: 0 });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });

  test('POST /api/courses/quiz anonymous -> 401', async ({ request }) => {
    // quiz.js handleQuizSubmit: validateSession before rate limit and body parse.
    const resp = await request.post('/api/courses/quiz', { data: {} });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });

  test('GET /api/courses/comments anonymous -> 401', async ({ request }) => {
    const resp = await request.get('/api/courses/comments', { maxRedirects: 0 });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });

  test('GET /api/courses/certificate anonymous -> 401 HTML', async ({ request }) => {
    // certificate.js returns a printable HTML error page (htmlError), not JSON:
    // anonymous -> htmlError('Please log in...', 401, '/login').
    const resp = await request.get('/api/courses/certificate', { maxRedirects: 0 });
    expect(resp.status()).toBe(401);
    expect(resp.headers()['content-type'] || '').toContain('text/html');
  });

  test('GET /api/courses/rendition anonymous -> 401', async ({ request }) => {
    // rendition.js: session check precedes stepId/format validation -> 401 even bare.
    const resp = await request.get('/api/courses/rendition', { maxRedirects: 0 });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });

  test('GET /api/stream/token anonymous -> 401', async ({ request }) => {
    // stream/token.js: session check precedes videoId validation -> 401; no signed
    // Stream token can be minted anonymously.
    const resp = await request.get('/api/stream/token', { maxRedirects: 0 });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });
});
