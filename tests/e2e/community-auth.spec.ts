import { test, expect } from '@playwright/test';

// STUC do-tank public/member boundary (verified live 2026-05-31).
//
// IMPORTANT: page gating on this site is CLIENT-SIDE + API-level, NOT server middleware.
// functions/_middleware.js does NOT redirect static HTML page routes (see memory
// cf-pages-middleware-static-route-bypass) — a logged-out GET to /account/ or
// /community/events/ returns 200 and the page JS gates content. So the real boundary is:
//   - Public PAGES serve 200 (the hub renders a logged-out gate-hero; area pages render read-only).
//   - The Action Area detail SPA rewrite (public/_redirects) must serve arbitrary slugs to the shell.
//   - Member DATA is gated at /api/community/* via requireMember (401/403 without a session);
//     public read APIs (areas/projects/impact) serve 200.
//
// Run against the live site or a local wrangler pages dev:
//   COMMUNITY_E2E_BASE=https://rrmacademy.org npm run test:e2e -- community-auth
//   (or: npm run build && npx wrangler pages dev dist --port 8788 ; COMMUNITY_E2E_BASE=http://localhost:8788 ...)
// Not wired into CI (deploy.yml runs no e2e); this is a local + post-deploy regression aid.

const BASE = process.env.COMMUNITY_E2E_BASE || 'http://localhost:8788';
test.use({ baseURL: BASE });

test.describe('STUC community — public pages reachable (logged out)', () => {
  for (const path of ['/community/', '/community/areas/research/']) {
    test(`public page ${path} serves 200`, async ({ request }) => {
      const resp = await request.get(path, { maxRedirects: 0 });
      expect(resp.status(), `${path} should serve 200 (public recruiting surface)`).toBe(200);
    });
  }
});

test.describe('STUC community — member data gated at the API', () => {
  test('/api/community/memberships rejects anonymous callers', async ({ request }) => {
    const resp = await request.get('/api/community/memberships', { maxRedirects: 0 });
    expect([401, 403], 'member API must reject anonymous').toContain(resp.status());
  });

  test('/api/community/areas is public (recruiting surface)', async ({ request }) => {
    const resp = await request.get('/api/community/areas', { maxRedirects: 0 });
    expect(resp.status()).toBe(200);
  });
});
