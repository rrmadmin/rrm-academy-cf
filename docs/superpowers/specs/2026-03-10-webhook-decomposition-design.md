# Webhook Decomposition + Endpoint Template

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Decompose `stripe-webhook.js` (509 lines, 21 bugs across 5 /arise runs) into focused per-event handler files, and create a canonical endpoint template to prevent the "sibling divergence" pattern that accounts for 21% of all /arise findings.

**Motivation:** `/arise-intel` report (2026-03-10) identified `stripe-webhook.js` as the #1 bug magnet file in the codebase and `cross-file` sibling divergence as the #1 bug category (35 findings, 21%).

## Part 1: Webhook Decomposition

### Current State

`functions/api/stripe-webhook.js` (509 lines) handles:
- Stripe signature verification + event deduplication
- `checkout.session.completed`: customer account linking/creation, course enrollment, STUC welcome email, GA4 purchase tracking (3 variants)
- `customer.subscription.updated`: past_due notification email
- `customer.subscription.deleted`: cancellation confirmation email
- `invoice.payment_failed`: payment failure notification email
- Shared helpers: `ensureAccountForCheckout`, `getEmailByStripeCustomer`, `sendEmailSafe`

### Proposed Structure

```
functions/api/
  stripe-webhook.js              (entry point: sig verify, dedup, route)
  billing/
    _webhook-checkout.js          (checkout.session.completed)
    _webhook-subscription.js      (subscription.updated + deleted)
    _webhook-invoice.js           (invoice.payment_failed)
    _webhook-shared.js            (getEmailByStripeCustomer, sendEmailSafe)
    portal.js                     (unchanged)
    status.js                     (unchanged)
    checkout-account.js           (unchanged)
```

### Handler Contract

Every handler function follows this signature:

```js
/**
 * @param {D1Database} db
 * @param {Stripe.Event} event - full Stripe event (handler extracts event.data.object)
 * @param {Object} env - CF Pages environment bindings
 * @param {Request} request - original webhook request (needed for sendGA4Event)
 * @param {Function} waitUntil - CF waitUntil for background work
 * @returns {Response|null} - Response to short-circuit (e.g. 500 for retry), or null for default 200
 */
export async function handleCheckoutCompleted(db, event, env, request, waitUntil) { ... }
```

If a handler returns a `Response`, the entry point uses it. If it returns `null`/`undefined`, the entry point returns the standard `{ received: true }` 200.

### File Responsibilities

**`stripe-webhook.js` (~100 lines)** -- Entry point only:
1. Validate `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` exist
2. Initialize Stripe client
3. Verify signature via `constructEventAsync`
4. Check DB binding exists
5. Deduplicate via `webhook_event` table
6. `switch` on `event.type`, call imported handler
7. Return handler's Response or default 200

Security invariants preserved: `stripe-signature` header check + `constructEventAsync` stay in this file. Guard manifest still validates this file.

**`billing/_webhook-checkout.js` (~200 lines)** -- `checkout.session.completed`:
- `handleCheckoutCompleted(db, event, env, request, waitUntil)`
- `ensureAccountForCheckout(db, session, env, waitUntil)` -- private to this file (only caller)
- Account linking (3 cases: logged-in, email match, auto-create)
- Course enrollment + confirmation email
- STUC membership welcome email
- GA4 purchase events (course, donation, subscription)
- Returns `Response(500)` on account linkage or enrollment failure (Stripe retries)

**`billing/_webhook-subscription.js` (~70 lines)**:
- `handleSubscriptionUpdated(db, event, env, request, waitUntil)` -- past_due notification
- `handleSubscriptionDeleted(db, event, env, request, waitUntil)` -- cancellation confirmation
- Both return `null` (always 200 -- email failures are logged, not retried)

**`billing/_webhook-invoice.js` (~40 lines)**:
- `handlePaymentFailed(db, event, env, request, waitUntil)` -- payment failure notification
- Returns `null` (always 200)

**`billing/_webhook-shared.js` (~80 lines)**:
- `getEmailByStripeCustomer(db, stripeCustomerId, env, waitUntil)` -- D1 lookup, used by subscription + invoice handlers
- `sendEmailSafe(env, waitUntil, { to, subject, text })` -- SES wrapper that logs errors but never throws

### Import Map

```
stripe-webhook.js
  ├── imports: auth/_shared.js (STRIPE_API_VERSION, SITE_URL, generateId, generateToken, hashToken)
  ├── imports: billing/_webhook-checkout.js (handleCheckoutCompleted)
  ├── imports: billing/_webhook-subscription.js (handleSubscriptionUpdated, handleSubscriptionDeleted)
  ├── imports: billing/_webhook-invoice.js (handlePaymentFailed)
  └── imports: _log.js (log)

billing/_webhook-checkout.js
  ├── imports: ../auth/_shared.js (SITE_URL, generateId, generateToken, hashToken)
  ├── imports: ../courses/enroll.js (enrollUser)
  ├── imports: ../courses/_shared.js (getCourse)
  ├── imports: ../_ses.js (sendEmail)
  ├── imports: ../_ga4.js (sendGA4Event)
  ├── imports: ../_log.js (log)
  └── imports: ./_webhook-shared.js (sendEmailSafe)

billing/_webhook-subscription.js
  ├── imports: ../auth/_shared.js (SITE_URL)
  ├── imports: ../_log.js (log)
  └── imports: ./_webhook-shared.js (getEmailByStripeCustomer, sendEmailSafe)

billing/_webhook-invoice.js
  ├── imports: ../auth/_shared.js (SITE_URL)
  ├── imports: ../_log.js (log)
  └── imports: ./_webhook-shared.js (getEmailByStripeCustomer, sendEmailSafe)
```

### What Does Not Change

- Route: `POST /api/stripe-webhook` (same file path)
- External behavior: same HTTP responses, same emails, same GA4 events
- Guard manifest: `stripe-webhook.js` still guarded (hash updated after refactor)
- Guard security invariants: `stripe-signature` + `constructEventAsync` stay in entry point
- Webhook dedup: stays in entry point
- All existing imports from other files into `stripe-webhook.js` remain valid

## Part 2: Endpoint Template

### Problem

21% of /arise findings (35 of 165) are `cross-file` sibling divergence. New endpoints copy from older templates that predate current conventions. Example: `contact/submit.js` defines its own `json()` and `CORS_HEADERS` instead of importing from `auth/_shared.js`.

### Solution

1. **Reference template** at `functions/api/_endpoint-template.js` -- a commented, copy-paste-ready file showing the canonical endpoint pattern. `_`-prefixed so CF Pages ignores it. Header comment says "REFERENCE ONLY -- do not import."

2. **Fix `contact/submit.js`** -- replace local `json()` and `CORS_HEADERS` with imports from `auth/_shared.js`. This eliminates the last known live divergence.

### Template Contents

The template documents these conventions (derived from the 35 cross-file findings):

```
1. JSDoc header: endpoint path, HTTP methods, purpose, auth requirement
2. Imports: json, optionsResponse from auth/_shared.js; log from _log.js
3. onRequestOptions() -> optionsResponse()
4. onRequest[Method]() with outer try/catch:
   - catch: log(env, waitUntil, ...) + return json({ ok: false, error: 'Internal error' }, 500)
5. Inner handler function:
   a. DB check: if (!env.DB) return json(..., 500)
   b. Auth check: validateSession -> 401 if needed
   c. Input validation: type checks, length limits, enum allowlists
   d. Business logic
   e. Return json({ ok: true, ... })
6. Never define local json() or CORS_HEADERS
7. Never leak err.message to client
8. Never skip try/catch on external service calls (Stripe, SES, Airtable)
```

### `contact/submit.js` Fix

Remove lines 8-19 (local `CORS_HEADERS` and `json()` definitions). Add import:
```js
import { json, optionsResponse } from '../auth/_shared.js';
```

Replace `onRequestOptions` body with `return optionsResponse()`.

This is a pure refactor -- same CORS origin (`https://rrmacademy.org`), same response shape.

## Risks

| Risk | Mitigation |
|------|-----------|
| Import path typos (no TypeScript) | Build verification after each file |
| Guard hash changes | Run `guard:update` after refactor |
| CF Pages routing surprise | All new files are `_`-prefixed (verified convention) |
| Missed behavior change | Pure code motion -- no logic changes. /arise run after to verify |

## Success Criteria

- [ ] `stripe-webhook.js` under 120 lines
- [ ] Each handler file has a single exported function
- [ ] `npm run build` passes (wrangler pages functions build)
- [ ] `npm run guard` passes after manifest update
- [ ] `contact/submit.js` uses shared `json()` and `optionsResponse()`
- [ ] No new routes created (verify with `wrangler pages functions build --outdir=dist`)
