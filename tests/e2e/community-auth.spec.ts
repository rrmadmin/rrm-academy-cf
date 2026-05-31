import { test, expect } from '@playwright/test';

// STUC do-tank middleware carve-out (Phase 2 — functions/_middleware.js).
//
// The auth redirect runs ONLY under `npx wrangler pages dev dist` (NOT `astro dev` on
// :4321, which does not execute _middleware.js). Run:
//   npm run build && npx wrangler pages dev dist --port 8788
//   COMMUNITY_E2E_BASE=http://localhost:8788 npm run test:e2e -- community-auth
//
// Not wired into CI (deploy.yml runs no e2e); this is a local + Phase-9 regression gate.
// The definitive behavioral check is the post-deploy curl against the live site.
//
// Logged-out (no session cookie) contract — the recruiting surface is public, the live
// conversation + member surfaces stay gated (fail closed):
//   PUBLIC (200):            /community/ , /community/areas/<slug>/
//   GATED (302 -> /login):   /community/events/ , /community/members/ ,
//                            /community/post/<id> , /account/

const BASE = process.env.COMMUNITY_E2E_BASE || 'http://localhost:8788';
test.use({ baseURL: BASE });

const PUBLIC_PATHS = ['/community/', '/community/areas/research/'];
const GATED_PATHS = ['/community/events/', '/community/members/', '/community/post/test-id', '/account/'];

test.describe('STUC community middleware carve-out — logged out', () => {
  for (const path of PUBLIC_PATHS) {
    test(`public: ${path} serves without a login redirect`, async ({ request }) => {
      const resp = await request.get(path, { maxRedirects: 0 });
      expect(resp.status(), `${path} should be publicly reachable`).toBe(200);
      const loc = resp.headers()['location'] || '';
      expect(loc).not.toContain('/login');
    });
  }

  for (const path of GATED_PATHS) {
    test(`gated: ${path} redirects logged-out users to /login`, async ({ request }) => {
      const resp = await request.get(path, { maxRedirects: 0 });
      expect([301, 302, 307, 308], `${path} should redirect`).toContain(resp.status());
      const loc = resp.headers()['location'] || '';
      expect(loc, `${path} should redirect to /login`).toContain('/login');
    });
  }
});
