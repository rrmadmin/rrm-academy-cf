# RRM Migration: Cost/Savings Analysis

> Generated: 2026-03-03. Living document — update after first CF Stream billing cycle and after Wix Premium Plus expires (Apr 2026).

---

## Before vs. After (steady state, post-April 2026)

| | Before | After |
|---|---|---|
| Bookkeeper | $400.00 | $0 |
| QuickBooks Online Plus | $60.95 | $0 |
| Perplexity Pro | $21.20 | $0 |
| Wix Premium Plus (rrmacademy.org) | $25.00 | $0 (CF Pages free) |
| Wix Premium Basic (rrm.foundation) | $28.62 | $0 |
| Wix Email Marketing Core | $30.74 | $4.50 (Buttondown) |
| Wix Hopp (scheduling) | $9.01 | $0 |
| Vimeo Starter | $20.00 | $0 (within CF Stream bundle) |
| Cloudflare (Workers Paid + Stream Bundle Basic) | $0 | $10.00 |
| CF R2 / Stream variable usage | $0 | ~$0-10 (TBD after first bill) |
| Domain rrmacademy.org | $1.25 | $0.77 (CF Registrar at-cost) |
| Airtable | $25.44 | $25.44 |
| Anthropic Max 20x | $0 | $200.00 |
| n8n | $0 | $0 (self-hosted free) |
| Resend | $0 | $20.00 |
| **Monthly total** | **$622.21** | **$260.71** |
| **Annual total** | **$7,467** | **$3,129** |

---

## Net Saving

| | Amount |
|---|---|
| **Monthly saving** | **$361.50/mo** |
| **Annual saving** | **$4,338/yr** |

If CF Stream variable usage stays near $0 (within included allocation), annual saving reaches ~$4,458/yr.

---

## Anthropic Max ROI

| | |
|---|---|
| Max 20x cost | $200/mo |
| Directly replaced | $482.15/mo (bookkeeper $400 + QuickBooks $60.95 + Perplexity $21.20) |
| **Net return on Max subscription alone** | **+$282.15/mo** |
| **ROI ratio** | **2.4x -- every $1 spent returns $2.30 in direct savings** |

This excludes the platform build value. The rrmacademy.org rebuild, endo survey, community system, and library pipeline would have cost $15,000-40,000 with an external agency.

---

## Sunk Cost

| Item | Amount | Expires |
|---|---|---|
| Wix Premium Plus (2yr, paid Apr 2024) | $322.04 (total) | ~Apr 30, 2026 |

Running both platforms in parallel until expiry. Once Wix Plus lapses, the full $25/mo saving is realized.

---

## Notes & Caveats

**CF Stream:** The $45/mo estimate in the Vimeo migration doc was based on unbundled pricing. Actual subscription is the Images Stream Bundle Basic at $5/mo, which includes 1,000 min stored + 10,000 min delivered. At 53 videos averaging ~5 min each (~265 min stored), storage is well within the included allocation. Variable delivery cost depends on actual monthly views -- likely $0-10/mo for current traffic levels. **Check first CF billing cycle after migration.**

**Resend at $20/mo** is a direct result of endo survey volume growth. If survey traffic continues scaling, this may need to increase. Track against survey submission growth.

**QuickBooks:** Was $60.95/mo on a 50% Wix coupon (full Intuit price ~$115/mo). Replaced by Airtable + n8n automation. Airtable was pre-existing ($25.44/mo, already in both columns -- wash on delta).

**Hopp Ultimate:** Wix scheduling app, $9.01/mo (annual), cancelled. Not replaced. If scheduling is needed in future, budget separately.

**Domain portfolio:** 15 domains now on CF Registrar at-cost pricing (~$9/yr .org, ~$8.57/yr .com). Previous Wix domain markups were ~$14.95/yr. Savings spread across all domains.

**Vimeo Starter was $20/mo** (not $25 as noted in backlog -- backlog entry needs correction).

---

## Action Items

- [ ] Check first CF billing cycle (due ~Mar 22, 2026) -- confirm Stream variable usage cost
- [ ] Update Vimeo entry in backlog.md: "$25/mo" → "$20/mo"
- [ ] Cancel Vimeo subscription (Stream confirmed working in production)
- [ ] Delete temp CF API token (`3h-YUCih...`)
- [ ] After Apr 30, 2026: confirm Wix Premium Plus lapses, update this doc with final steady-state numbers
