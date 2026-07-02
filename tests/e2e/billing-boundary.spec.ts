import { test, expect } from '@playwright/test';

// Billing surface boundary (anonymous callers only — verified against endpoint source).
//
// IMPORTANT: page gating on this site is CLIENT-SIDE + API-level, NOT server middleware.
// functions/_middleware.js does NOT redirect static HTML page routes (see memory
// cf-pages-middleware-static-route-bypass) — /donate/ and /save-the-uterus-club/ are
// public static pages; money movement is gated inside functions/api/* handlers:
//   - /api/billing/status + /api/billing/portal require a session (401 anonymous).
//   - /api/create-checkout allows anonymous checkout by design, so the boundary tested
//     here is the input contract: invalid mode / sub-minimum amount are rejected BEFORE
//     stripe.checkout.sessions.create is ever called (no Stripe session is minted).
//   - /api/stripe-webhook requires a stripe-signature header (400 without one).
//   - checkout-account + supporter-badge validate session_id format BEFORE rate limit
//     and BEFORE any Stripe retrieve.
//   - fund-progress + fund-supporters are public read-only (200 + fail-soft).
//
// PROD-SAFETY CONTRACT (hard): zero mutating success paths — no checkout session is
// created, no webhook event is processed, nothing is written. Request volume is kept
// to 1-2 per endpoint (several share 5-per-15-min per-IP rate limits).
//
// Run against the live site or a local wrangler pages dev:
//   BILLING_E2E_BASE=https://rrmacademy.org npx playwright test tests/e2e/billing-boundary.spec.ts --project=desktop-chrome
// Not wired into CI (deploy.yml runs no e2e); this is a local + post-deploy regression aid.

const BASE = process.env.BILLING_E2E_BASE || 'http://localhost:8788';
test.use({ baseURL: BASE });

test.describe('Billing pages — public static pages serve 200', () => {
  for (const path of ['/donate/', '/save-the-uterus-club/']) {
    test(`page ${path} serves 200`, async ({ request }) => {
      const resp = await request.get(path, { maxRedirects: 0 });
      expect(resp.status(), `${path} is a public giving page`).toBe(200);
    });
  }
});

test.describe('Session-required billing endpoints reject anonymous callers', () => {
  test('GET /api/billing/status anonymous -> 401', async ({ request }) => {
    // status.js: rate limit (30/15min per IP) then validateSession -> 401 'Not authenticated'.
    const resp = await request.get('/api/billing/status', { maxRedirects: 0 });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });

  test('POST /api/billing/portal anonymous -> 401', async ({ request }) => {
    // portal.js: rate limit (10/15min per IP) then validateSession -> 401 BEFORE any
    // Stripe billingPortal.sessions.create call.
    const resp = await request.post('/api/billing/portal', { data: {} });
    expect(resp.status()).toBe(401);
    expect((await resp.json()).error).toBe('Not authenticated');
  });
});

test.describe('POST /api/create-checkout — input contract rejects before Stripe', () => {
  test('empty object body -> 400 invalid mode (before rate limit, before Stripe)', async ({ request }) => {
    // create-checkout.js: mode check is the FIRST validation after body parse — it runs
    // before checkRateLimit, before session resolution, and before any Stripe API call.
    const resp = await request.post('/api/create-checkout', { data: {} });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Invalid mode');
  });

  test('payment mode with sub-minimum amount -> 400 before sessions.create', async ({ request }) => {
    // create-checkout.js payment branch: Number(100) < 500 -> 400 'Minimum donation is $5'.
    // This is the earliest payment-branch validator and fires BEFORE
    // stripe.checkout.sessions.create — no checkout session is minted.
    // Consumes 1 of 5 checkout rate slots (rate limit precedes the amount check).
    const resp = await request.post('/api/create-checkout', { data: { mode: 'payment', amount: 100 } });
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('Minimum donation is $5');
  });
});

test.describe('POST /api/stripe-webhook — signature gate', () => {
  test('missing stripe-signature header -> 400, no event processed', async ({ request }) => {
    // stripe-webhook.js: requireWebhookConfig passes in prod, then the missing
    // stripe-signature header returns 400 'Missing signature' BEFORE constructEventAsync,
    // dedup, and every sub-handler. Nothing is written.
    const resp = await request.post('/api/stripe-webhook', { data: {} });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toBe('Missing signature');
  });
});

test.describe('Checkout follow-up reads — session_id format gate', () => {
  test('GET /api/billing/checkout-account without session_id -> 400', async ({ request }) => {
    // checkout-account.js: missing/non-cs_ session_id -> 400 BEFORE rate limit and
    // BEFORE any Stripe sessions.retrieve.
    const resp = await request.get('/api/billing/checkout-account', { maxRedirects: 0 });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toBe('Invalid session_id');
  });

  test('GET /api/billing/supporter-badge without session_id -> 400', async ({ request }) => {
    // supporter-badge.js: SESSION_ID_RE fails on null -> 400 'invalid_session_id'
    // BEFORE rate limit and BEFORE any Stripe sessions.retrieve.
    const resp = await request.get('/api/billing/supporter-badge', { maxRedirects: 0 });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).error).toBe('invalid_session_id');
  });
});

test.describe('Public fundraising reads serve 200 with documented shapes', () => {
  test('GET /api/fund-progress -> 200 { raised_cents, goal_cents, count, supporters }', async ({ request }) => {
    const resp = await request.get('/api/fund-progress', { maxRedirects: 0 });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    for (const key of ['raised_cents', 'goal_cents', 'count', 'supporters']) {
      expect(typeof body[key], `fund-progress key ${key}`).toBe('number');
    }
  });

  test('GET /api/fund-supporters -> 200 with founding-supporter shape', async ({ request }) => {
    const resp = await request.get('/api/fund-supporters', { maxRedirects: 0 });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(typeof body.total_gifts).toBe('number');
    expect(typeof body.consented_count).toBe('number');
    expect(Array.isArray(body.recent)).toBe(true);
    expect(Array.isArray(body.founding)).toBe(true);
    expect(typeof body.founding_cap).toBe('number');
    expect(typeof body.founding_left).toBe('number');
    expect(typeof body.founding_closed).toBe('boolean');
    expect(typeof body.anonymous_founders).toBe('number');
  });
});
