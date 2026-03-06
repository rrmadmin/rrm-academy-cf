# SEO Health Monitor -- Design

> Automated SEO monitoring for rrmacademy.org. Lightweight CF Worker cron for 24/7 checks and alerts, with manual trigger from admin dashboard.

## Problem

All SEO monitoring is manual. No alerts when pages break, schema disappears, robots.txt changes, or backlinks die. The existing `seo-dashboard` (Python, local CLI) does deep analysis but only runs when Brian remembers to run it.

## Solution: Approach C (Hybrid)

- **CF Worker (`rrm-seo-monitor`)**: daily cron for lightweight checks, weekly digest, Telegram alerts, admin dashboard API
- **Python `seo-dashboard`**: remains the deep analysis tool (GSC queries, SERP tracking, AEO scores). Run manually or via n8n for weekly deep reports later.

## Architecture

```
rrm-seo-monitor (CF Worker)
    |
    +-- Cron: daily 06:00 UTC
    |   +-- fetch 10 key pages (check 200)
    |   +-- fetch + validate sitemap-index.xml (count URLs)
    |   +-- fetch + hash robots.txt (detect changes)
    |   +-- fetch + check llms.txt (200 + non-empty)
    |   +-- fetch + parse JSON-LD from 3 sample pages
    |   +-- call rrm-backlinks API (/api/backlinks/summary)
    |   +-- check security headers (HSTS, CSP)
    |   +-- compare against baselines in KV
    |   +-- alert via Telegram ONLY if failures detected
    |
    +-- Cron: weekly Saturday 14:00 UTC (10am ET)
    |   +-- all daily checks
    |   +-- backlink changes summary
    |   +-- always sends Telegram digest
    |
    +-- API (Bearer auth)
    |   +-- GET /api/check      -- run all checks, return JSON
    |   +-- GET /api/baseline   -- view current baselines
    |   +-- PUT /api/baseline   -- update baselines
    |   +-- GET /health         -- simple health check
    |
    +-- Storage
    |   +-- KV: baselines (robots.txt hash, sitemap URL count, expected headers)
    |   +-- Analytics Engine: worker-events dataset
    |
    +-- Alerts: Telegram via @rrm_n8n_notification_bot
```

## Checks

| Check | Method | Alert When |
|-------|--------|------------|
| Key pages alive | `fetch()` 10 URLs, check 200 | Any non-200 |
| Sitemap health | Fetch sitemap-index.xml, parse, count URLs | Count drops >10% from baseline |
| robots.txt integrity | Fetch, SHA-256 hash, compare to baseline | Hash changed |
| llms.txt alive | Fetch /llms.txt, check 200 + non-empty | Non-200 or empty body |
| Schema validation | Fetch homepage + 1 course + 1 article, extract JSON-LD | Missing or unparseable JSON-LD |
| Backlinks summary | GET rrm-backlinks Worker /api/backlinks/summary | New dead links or domain count drop |
| Security headers | Check HSTS, CSP on homepage response | Missing expected headers |

### Key Pages (10)

1. `/`
2. `/about/`
3. `/courses/`
4. `/courses/endo-masterclass/`
5. `/library/`
6. `/commentary/`
7. `/faqs/`
8. `/donate/`
9. `/save-the-uterus-club/`
10. `/what-is-rrm/`

### Schema Sample Pages (3)

1. `/` -- WebSite + EducationalOrganization
2. `/courses/endo-masterclass/` -- Course + CourseInstance
3. Latest commentary post -- BlogPosting

## Telegram Alert Format

### Daily (only on failure)

```
SEO Alert -- rrmacademy.org

Pages: /courses returned 503
Schema: JSON-LD missing on /courses/endo-masterclass
Backlinks: 2 new dead links detected

Run full check: rrmacademy.org/admin
```

### Weekly digest (always sends, Saturday 10am ET)

```
SEO Weekly -- rrmacademy.org

All 10 key pages healthy
Sitemap: 3,402 URLs (baseline: 3,374)
robots.txt unchanged
llms.txt OK
Schema valid on 3 sample pages
Security headers present
Backlinks: 1 lost (example.com/page)

Next deep analysis: run seo_dashboard.py
```

## Admin Dashboard

New **"SEO"** tab in admin nav (between Content and Revenue).

- Status cards at top: green/red per check category
- "Run Check" button calls `/api/check`
- Last checked timestamp at bottom
- Expandable details per card (which pages failed, what changed)

## Infrastructure

| Item | Value |
|------|-------|
| Worker name | `rrm-seo-monitor` |
| Repo | `rrmadmin/rrm-seo-monitor` (new, standalone) |
| KV namespace | `SEO_BASELINES` |
| Analytics Engine | `worker-events` (shared dataset) |
| Auth | Bearer token (`SEO_MONITOR_API_TOKEN`) |

### Secrets

| Secret | Purpose |
|--------|---------|
| `SEO_MONITOR_API_TOKEN` | Auth for /api/* endpoints |
| `TELEGRAM_BOT_TOKEN` | @rrm_n8n_notification_bot |
| `TELEGRAM_CHAT_ID` | Brian's Telegram user ID |
| `BACKLINKS_API_TOKEN` | Auth for rrm-backlinks Worker API |

### Cron Schedule

```toml
[triggers]
crons = ["0 6 * * *", "0 14 * * 6"]
```

## Not in Scope (Option B, later)

- GSC API queries from the Worker (stays in Python dashboard)
- SERP rank tracking (stays in Brave collector)
- Content gap analysis / auto-generated briefs
- AEO scoring
