# STUC Community Enhancements -- Design

**Goal:** Add member tier badges, achievement badges, avatar population, a members list page, and fix the duplicate pinned post bug.

**Architecture:** All changes build on existing D1 schema (`user_label` already populated from Wix import), the community API layer (`functions/api/community/`), and frontend rendering in `community/index.astro`. No new tables, no new external runtime dependencies.

---

## 1. Duplicate Pinned Post Fix

**File:** `functions/api/community/posts.js`

The GET handler returns pinned posts in both the pinned-first sort and the `before` cursor results. Fix: add `AND pinned = 0` to the pagination branch when `before` is provided.

```sql
-- When before= is set (Load More):
WHERE channel = ? AND pinned = 0 AND created_at < ? ORDER BY created_at DESC LIMIT ?
```

---

## 2. Tier Badges in Feed

**Files:** `functions/api/community/_shared.js`, `posts.js`, `comments.js`, `src/pages/community/index.astro`

### Data flow

Tier comes from `user_label` table (Wix-imported), not Stripe. One LEFT JOIN per query:

```sql
LEFT JOIN user_label ul ON ul.user_id = u.id
  AND ul.label IN ('Uterus Member \U0001F43B', 'Uterus Hero \U0001F496', 'Uterus Super Hero \U0001F9B8\u200D\u2640\uFE0F')
```

Label-to-tier mapping in `_shared.js`:

```javascript
const TIER_LABELS = {
  'Uterus Member \U0001F43B': 'member',
  'Uterus Hero \U0001F496': 'hero',
  'Uterus Super Hero \U0001F9B8\u200D\u2640\uFE0F': 'superhero',
};
```

### API response

Posts and comments gain: `authorTier: 'member' | 'hero' | 'superhero' | null`

### Frontend rendering

- Staff get purple role badge ("Superadmin", "Admin", "Mod") -- unchanged
- Non-staff get tier badge if present:
  - `member` -- gray pill, text: "\U0001F43B Member"
  - `hero` -- amber/gold pill, text: "\U0001F496 Hero"
  - `superhero` -- pink/magenta pill, text: "\U0001F9B8\u200D\u2640\uFE0F Superhero"
- Staff + tier: show only staff badge (staff takes precedence)
- Same logic for comment authors

### CSS

```css
.post-tier-badge { font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 8px; line-height: 18px; }
.post-tier-badge--member    { background: var(--neutral-100); color: var(--text-secondary); }
.post-tier-badge--hero      { background: #fef3c7; color: #92400e; }
.post-tier-badge--superhero { background: #fce7f3; color: #9d174d; }
```

---

## 3. Achievement Badges (Members List Only)

Achievement badges display only on the members list page, not in the feed.

### Badge mapping

| Label | Badge display |
|---|---|
| `Donor` | "Donor" |
| `Masterclass in Endometriosis & Surgery` / `...and Surgery` | "Endo Masterclass" |
| `Long Term Endometriosis Management` | "Long Term Endo" |
| `RRM vs Standard ART...` | "RRM vs ART" |
| `Postpartum Depression & Anxiety...` | "Postpartum" |

Course badges prefixed with mortar board icon. Small muted pills, smaller than tier badges. Wrap to multiple lines on member card.

---

## 4. Members List Page

**URL:** `/community/members` -- same STUC membership gate as feed.

### New API: GET `/api/community/members`

```json
{
  "members": [{
    "id": "...",
    "name": "Naomi Whittaker, MD",
    "avatarUrl": "https://...",
    "tier": "superhero",
    "role": "member",
    "labels": ["Donor", "Masterclass in Endometriosis & Surgery"],
    "lastActive": "2026-02-24T...",
    "joinedAt": "2025-09-01T..."
  }]
}
```

### Who appears

Users with active Stripe subscription OR `Save the Uterus Club` grandfathered label. Staff (mod+) always appear.

### Last active

`MAX(created_at)` from `community_post` and `community_comment` where `author_id = user.id`. Falls back to `user.created_at` if no posts/comments.

### Sort

Most recently active first.

### Layout

Responsive grid of member cards. Each card:
- Avatar (40px, same style as feed)
- Name
- Tier badge (emoji + text pill)
- Achievement badges (small pills, wrapping)
- "Active 3 days ago" or "Member since Oct 2025" (if never posted)

---

## 5. Avatar Population (One-Time Batch)

**New file:** `scripts/populate-avatars.mjs`

1. Query D1 for 36 STUC members missing avatars
2. Fetch `https://unavatar.io/{email}` per member (3s timeout)
3. If 200: download image, upload to R2 at `avatars/{userId}.jpg`, update D1 `avatar_url`
4. If 404/timeout: skip (keeps initial-letter fallback)
5. Log results summary

R2 storage avoids external dependency at runtime.

---

## 6. Display Name Fix

One-time D1 SQL for 6 members with no `name` set:
- If `first_name`/`last_name` exist, set `name = first_name || ' ' || last_name`
- Otherwise leave as-is (displays "Member" in UI)

---

## Summary

| Area | Files |
|---|---|
| Pinned post fix | `posts.js` (1 line) |
| Tier badge data | `_shared.js`, `posts.js`, `comments.js` |
| Tier badge UI | `community/index.astro` (JS + CSS) |
| Members API | New: `functions/api/community/members.js` |
| Members page | New: `src/pages/community/members.astro` |
| Avatar batch | New: `scripts/populate-avatars.mjs` |
| Name fix | One-time D1 SQL |

No new D1 tables. No new external runtime dependencies. No Stripe calls in the hot path.
