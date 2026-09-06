# RRM Academy

Online education platform for restorative reproductive medicine. Built with Astro + Cloudflare Pages.

**Live site:** https://rrmacademy.org

## Stack

| Layer | Tech |
|-------|------|
| Framework | Astro 5.3 (static output) |
| Hosting | Cloudflare Pages |
| Functions | CF Pages Functions (edge, no Node) |
| Database | Cloudflare D1 (SQLite) |
| Search | Pagefind (build-time index) |
| Auth | DIY sessions via D1 + PBKDF2 |
| Payments | Stripe |
| Video | Vimeo embed |
| Content | Airtable (library + blog) |
| Router | CF Worker at `~/iCode/projects/rrm-router/` |

## Deploy

Push to `main` — Cloudflare Pages auto-builds and deploys. No manual step needed.

Build command: `npm run build` (`astro build && npx pagefind --site dist`)

## Local Dev

```bash
npm install
npm run dev          # Astro dev server (no CF Functions)
npm run preview      # Wrangler preview (includes CF Functions + D1)
```

To refresh Airtable data before building:

```bash
AIRTABLE_PAT=xxx npm run fetch-all
npm run build
```

## Red team

A targeted adversarial harness for the surfaces that take PII (accounts, the endo
quiz and survey, contact forms, community posts) and money (Stripe checkout,
donations, membership). 150 cases in six families: **auth** (session forgery,
expiry, role escalation, IDOR), **money** (checkout tampering, webhook
signatures, replay, membership without payment), **pii** (the writes that carry
a person, and the survey pseudonymisation split), **leak** (what a refusal
says), **headers** (CSP, HSTS, nosniff, CORS, no-store), and **cost** (what an
unauthorised request is allowed to spend).

Every case is a real request with an expected refusal. **A FAIL is a finding:**
fix the code, or adjudicate it with a `known: 'RRMA-RT-n'` id and a written
note. Never loosen the expectation. A `known` case that starts passing also
fails the run, so a stale marker cannot hide the next regression.

```bash
node scripts/redteam/run.mjs                    # hermetic, ~2s, no network
node scripts/redteam/run.mjs --family auth,money --verbose
node scripts/redteam/run.mjs --mode live        # against https://rrmacademy.org
```

**Hermetic** runs the Pages Functions in process against a real SQLite engine
loaded with the committed schema, the two survey databases as separate engines,
KV, R2, and an upstream router that counts every call to Stripe, SES, GA4,
Turnstile and Google Ads. It runs on every PR and every `claude/**` auto-merge
via `test/redteam.test.js`.

**Live** sends only GETs and requests that must be refused: never a real signup,
post, checkout, donation or webhook event. A case that could only run by doing
one of those reports SKIP with that reason rather than passing on a refusal that
proves nothing.

Reports land in `docs/redteam/<date>-<mode>.md`. Adding a route to
`scripts/redteam/targets.mjs` (plus its dispatch entry) puts it inside the
anonymous, cost and privilege sweeps automatically.

## Reference

| File | What it covers |
|------|----------------|
| `CLAUDE.md` | Architecture, site map, API endpoints, security guard |
| `STYLE-GUIDE.md` | Design tokens, typography, component patterns |
| `docs/plans/backlog.md` | Active backlog and project status |
| `docs/architecture/airtable-cf-pipeline.md` | Airtable → CF data pipeline |
| `wrangler.toml` | D1, KV, R2 bindings |
| `scripts/redteam/cases.mjs` | The red-team case table (see "Red team" above) |
| `docs/redteam/` | Red-team run reports, hermetic and live |
