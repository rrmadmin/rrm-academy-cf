# Phase 8 Migration & Go-Live Design

**Date:** 2026-02-26
**Status:** Approved
**Scope:** Member migration, group/community migration, course enrollment migration, Google OAuth, Stripe live activation

## Context

Phase 8 (Courses & Community Groups) is near-complete. Course pages, enrollment APIs, quiz system, community feed, and Stripe products are all built. What remains is populating the system with real data and going live.

Three workstreams:
1. Migrate members (4,142 Wix site members → D1)
2. Complete course buildout (enroll members, migrate group content)
3. Activate Stripe live

## Approach: Parallel Foundation, Then Activate

### Layer 1 — Foundation (parallel, no dependencies between items)

**1a. D1 Schema Changes**

New table:
```sql
CREATE TABLE user_label (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, label)
);
CREATE INDEX idx_user_label_label ON user_label(label);
```

User table additions:
```sql
ALTER TABLE user ADD COLUMN google_id TEXT;
ALTER TABLE user ADD COLUMN wix_member_id TEXT;
ALTER TABLE user ADD COLUMN blocked INTEGER DEFAULT 0;
```

Community post addition:
```sql
ALTER TABLE community_post ADD COLUMN channel TEXT NOT NULL DEFAULT 'stuc';
CREATE INDEX idx_community_post_channel ON community_post(channel, created_at);
```

Channels: `stuc` (active), `members` (archive), `masterclass` (archive).

**1b. Member Import Script**

Input CSVs (all in ~/Downloads/):
- `contacts (1).csv` — 3,885 site members (main import)
- `contacts (2).csv` — 45 STUC members (some not in main export)
- `contacts (3).csv` — 61 Masterclass members (47 pre-Wix imports from Teachable/Thinkific)
- `contacts (4).csv` — Kendal Fraser (manual lookup)
- `contacts (5).csv` — Maggie Fogarty (manual lookup)
- `contacts (6).csv` — Pamela Schoenfeld (manual lookup)

Import logic per contact:
1. Create `user` record: id (UUID), email, name, first_name, last_name, hashed_password (empty — must use Google OAuth or password reset), email_verified=1, wix_member_id, blocked (1 if label contains "Spam 🛑"), created_at from CSV
2. Create `user_label` records: one per semicolon-delimited label
3. Create `enrollment` records where labels match courses:
   - "Masterclass in Endometriosis & Surgery" OR "Masterclass in Endometriosis and Surgery" → `masterclass-endo-surgery`
   - "Long Term Endometriosis Management" → `long-term-endo-management`
   - "Restorative Reproductive Medicine (RRM) vs Standard ART..." → `rrm-vs-ivf`
   - "Postpartum Depression & Anxiety..." → `postpartum-depression-anxiety`

Deduplication: merge on email. If email exists in multiple CSVs, union labels.
Collision with existing D1 users (4 accounts): match on email, merge labels/enrollments into existing record.

**1c. Course Progress Enrichment**

After member import, match course participant CSVs (name-only) against imported users to add progress data:
- `course participants - masterclass.csv` (38 records) — status, performance %, certificate date
- `course participants - long term endo.csv` (30 records)

Matching: full name → email match, email prefix → email match, plus ~8 manual overrides:
- MM / Maggie McCarthy → maggievdb@gmail.com
- mollyg242 / Molly Y → mollyg242@gmail.com
- Amelia D / Amelia Burke → maroonnurse@gmail.com
- Kendal Fraser → kendalfertility@gmail.com
- Pam Schoenfeld → womenfamilynutrition@gmail.com
- Naomi Whittaker → naomimwhittaker@gmail.com

**1d. Google OAuth**

Endpoints:
- `GET /api/auth/google` — redirect to Google OAuth consent
- `GET /api/auth/google/callback` — exchange code, match/create user, set session

Match logic:
1. google_id exists in D1 → log in (returning Google user)
2. email matches existing D1 user → link google_id, log in (first Google login for imported member)
3. else → create new user with google_id, log in

Google Cloud setup (Brian): create OAuth 2.0 credentials, set redirect URI to `https://rrmacademy.org/api/auth/google/callback`.

UI: add "Sign in with Google" button to login + signup pages.

No changes to session system, enrollment checks, or requireMember().

### Layer 2 — Content + Testing (parallel, after Layer 1)

**2a. Community Content Migration**

Source: Wix Groups discussions scraped by Claude in Chrome → structured text.

STUC feed: 73 posts, ~80+ comments (June 2025 – Feb 2026). Active feed, migrated into `community_post` with channel='stuc'.

RRM Academy Members: ~197 posts. Admin-only archive, channel='members'.
Masterclass Members: ~18 posts. Admin-only archive, channel='masterclass'.

Import logic:
- Match author by email against D1 users. If matched → attribute to user_id. If not → attribute to system account with original author name in content.
- Preserve original created_at timestamps.
- Map post tags to type field (Live Call → event, Recording → resource, etc.)
- "Joined the group" posts: import for completeness.
- External links (Google Docs, YouTube) survive as-is. Wix-hosted images flagged as potentially broken.
- PDF attachments: link to existing URLs or upload to R2.

Archive pages: `/community/archive/members` and `/community/archive/masterclass` — read-only, admin/superadmin access only.

**2b. STUC Community Testing**

Brian tests and critiques the live STUC feed. Issues logged and fixed. Must approve before Layer 3.

**2c. Quiz Content**

Replace sample quiz questions with real Wix content. Existing TODO from Phase 8.

### Layer 3 — Go Live (sequential, after Brian approval)

**3a. Stripe Live Activation**

Current state: Stripe API key in 1Password is sk_live_*, 5 live products exist, live webhook enabled. But CF Pages environment variables are using test keys.

Steps:
1. Swap CF Pages secrets to live keys: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
2. Verify STRIPE_PRICE_MEMBER/HERO/SUPERHERO match live price IDs (they should — products were created with live key)
3. Test purchase end-to-end: enroll in paid course, subscribe to STUC tier
4. Verify webhook fires, D1 records created, confirmation email sent
5. Verify billing portal works

**3b. STUC Community Go-Live**

Uncomment `STUC-CUTOVER` nav links in header/footer templates.
Remove noindex/nofollow from community pages.

**3c. Member Transition Communications**

Inform members about the new site. Include Google OAuth as primary login path. Password reset as fallback for non-Gmail users.

## Data Inventory

| Data Source | Records | Has Email | Matching Needed |
|-------------|---------|-----------|-----------------|
| contacts (1).csv — site members | 3,885 | Yes | No |
| contacts (2).csv — STUC members | 45 | Yes | No |
| contacts (3).csv — Masterclass members | 61 | Yes | No |
| contacts (4-6).csv — manual lookups | 3 | Yes | No |
| course participants - masterclass | 38 | No (name) | Yes (~8 manual) |
| course participants - long term endo | 30 | No (name) | Yes (few manual) |
| Masterclass Group Members | 28 | No (name) | Yes (covered by above) |
| STUC discussion posts | 73 | N/A | Author matching |
| RRM Academy discussion posts | ~197 | N/A | Author matching |
| Masterclass discussion posts | ~18 | N/A | Author matching |

## Labels System

Labels are informational metadata only — not used for access control. Access is governed by the enrollment table (courses) and requireMember() helper (STUC subscription check via Stripe).

Wix label taxonomy preserved as-is:
- Course labels: "Masterclass in Endometriosis & Surgery", "Long Term Endometriosis Management", etc.
- Group labels: "RRM Academy Members Group member", "Save the Uterus Club Group member", etc.
- STUC tiers: "Uterus Member 🐻", "Uterus Hero 💖", "Uterus Super Hero 🦸‍♀️"
- Historical: "SQSP ◼️", "Pre-SQSP 🪨"
- Operational: "Spam 🛑", "Contacted Me", "Research Sub 🧪"

## Decisions Made

- **Labels are metadata, not access control.** Enrollment table governs course access, Stripe subscription governs STUC access.
- **All 3,885 site members imported, including spam** (blocked=1 for spam-labeled).
- **Google OAuth as primary login for imported members** (no passwords migrated, password reset as fallback).
- **Three community channels:** stuc (active), members (admin archive), masterclass (admin archive).
- **Community content migrated** to preserve continuity. STUC feed is active, archives are admin-only.
- **General member community → Instagram Uterus Allies** (external, not on-site).
- **Masterclass group chat not continuing** (archive only).
- **Course participant CSVs enriched with progress data** (status, performance %, certificate dates).
- **Contacts (3).csv captures pre-Wix Masterclass members** (47 from Teachable/Thinkific era) — these get enrollment records despite never being Wix course participants.
