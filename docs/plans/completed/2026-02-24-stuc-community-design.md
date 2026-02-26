# STUC Community — Design Document

**Date:** 2026-02-24
**Status:** Approved
**Scope:** Build a lightweight member-only community into the RRM Academy Astro site, replacing the Wix Groups dependency for Save the Uterus Club.

---

## Problem

The Save the Uterus Club (STUC) member community lives on Wix Groups. Three hardcoded Wix URLs across the site point members there. This is the last user-facing Wix dependency blocking decommission. Members use the group for announcements, discussion, and — critically — accessing Google Meet links for live calls.

## Decision

Build the community directly into the Astro site. Same stack (D1 + CF Pages Functions), same auth, same patterns. No new infrastructure. API-first so future integrations (Discord bot, mobile app, etc.) can consume the same endpoints.

## Key Insight: STUC Membership as Access Token

STUC membership is not just a discussion board — it's a site-wide permission. An active Stripe subscription gates access to:
- Community discussions + announcements
- Live call links (Google Meet)
- Call recordings + transcripts
- Future courses and gated content

The `requireMember()` helper validates session + active subscription. Any endpoint can use it.

**Free account holders** (no STUC subscription) are directed to the Instagram "Uterus Allies" group instead of an on-site community.

---

## Data Model

### Tables

```sql
CREATE TABLE community_post (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL REFERENCES user(id),
    type TEXT NOT NULL,          -- 'announcement' | 'discussion' | 'event' | 'resource'
    title TEXT NOT NULL,
    body TEXT,                   -- markdown
    pinned INTEGER DEFAULT 0,
    event_date TEXT,             -- ISO datetime (events only)
    event_link TEXT,             -- Google Meet URL (events only)
    resource_url TEXT,           -- recording/PDF link (resources only)
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_community_post_type ON community_post(type);
CREATE INDEX idx_community_post_pinned ON community_post(pinned, created_at);

CREATE TABLE community_comment (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES community_post(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES user(id),
    parent_id TEXT REFERENCES community_comment(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_community_comment_post ON community_comment(post_id);

CREATE TABLE community_reaction (
    user_id TEXT NOT NULL REFERENCES user(id),
    target_type TEXT NOT NULL,   -- 'post' | 'comment'
    target_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, target_type, target_id, emoji)
);
CREATE INDEX idx_community_reaction_target ON community_reaction(target_type, target_id);
```

### No Groups Table

Single community (STUC). If multiple groups are needed later, add `group_id` to `community_post`. YAGNI for now.

### Membership Check

No new membership table. Active Stripe subscription = member. Reusable helper:

```js
async function requireMember(request, env) {
  // 1. Validate session (existing pattern)
  // 2. Check active subscription via Stripe customer ID
  // Returns { user, tier } or returns 401/403 response
}
```

---

## User Roles

Uses existing `user.role` column (already in D1 schema).

| Role | Who | Example |
|------|-----|---------|
| `superadmin` | Brian | Full system control |
| `admin` | Naomi, future staff | Content + role management |
| `mod` | Lorraine, future mods | Moderation |
| `member` | Subscribers | Participate |

### Permission Matrix

| Action | superadmin | admin | mod | member |
|--------|-----------|-------|-----|--------|
| Create discussion post | yes | yes | yes | yes |
| Create announcement/event/resource | yes | yes | no | no |
| Edit own post | yes | yes | yes | yes |
| Delete own post | yes | yes | yes | yes |
| Edit/delete any post | yes | yes | no | no |
| Pin/unpin posts | yes | yes | yes | no |
| Delete any comment | yes | yes | yes | no |
| Comment/react | yes | yes | yes | yes |
| Manage roles (admin/mod/member) | yes | yes | no | no |
| Set superadmin role | yes | no | no | no |

---

## API Endpoints

All at `functions/api/community/`. Follow existing patterns: session cookie auth, `json()` helper, CORS headers.

| Method | Endpoint | Who | What |
|--------|----------|-----|------|
| `GET` | `/api/community/posts` | Members | List posts (paginated, filterable by type) |
| `POST` | `/api/community/posts` | Members (discussion) / Staff (other types) | Create post |
| `PATCH` | `/api/community/posts` | Author (own) / Staff (any) | Edit post, pin/unpin |
| `DELETE` | `/api/community/posts` | Author (own) / Staff (any) | Delete post |
| `GET` | `/api/community/comments` | Members | List comments for a post (threaded) |
| `POST` | `/api/community/comments` | Members | Add comment or reply |
| `DELETE` | `/api/community/comments` | Author (own) / Mod+ (any) | Delete comment |
| `POST` | `/api/community/reactions` | Members | Toggle reaction |
| `DELETE` | `/api/community/reactions` | Members | Remove reaction |
| `PATCH` | `/api/community/roles` | Admin+ | Update user role |

### Pagination

Cursor-based using `created_at`. Default 20 posts per page. Client sends `?before=<ISO-date>` for next page.

### Event Sorting

`GET /posts?type=event` returns upcoming events first (by `event_date` ASC where `event_date > now`), then past events (by `event_date` DESC).

---

## Pages & UI

### Routes

| Route | What | Access |
|-------|------|--------|
| `/community` | Main feed — all post types, filterable tabs, inline comments/edit | Members (subscription required) |
| `/community/events` | Upcoming + past events view | Members |
| `/community/post/[id]` | Permalink fallback (kept for shared links, not linked from feed) | Members |

All are static Astro shells with client-side fetch (same pattern as courses/account).

### Gate Behavior

- **Not logged in** → redirect to `/login?redirect=/community`
- **Logged in, no subscription** → gate page with STUC tier pitch
- **Logged in, active subscription** → full community access

### Main Feed (`/community`) — Fully Inline

Everything happens within the feed. No page navigation for any interaction.

- Filter tabs: All | Announcements | Events | Resources | Discussions
- Pinned posts at top
- Post cards show: type label, author name + avatar, time-ago, title, body preview (collapsed if >280 chars), reaction bar, comment count
- **Card click → expand/collapse**: shows full body + loads threaded comments inline
- **Inline comments**: compose textarea at top, threaded replies (one level deep), emoji reactions, delete
- **Reply**: "Reply" button slides open textarea below top-level comment, submits with `parentId`
- **Edit modal**: full-screen overlay with pre-populated title/body/type fields, PATCH updates card in-place
- **Comment count button**: toggles expand/collapse (not a link)
- "New Post" compose form (inline, not separate page)
  - Members: title + body (type defaults to "discussion")
  - Staff: title + body + type selector + event/resource fields

### Single Post (`/community/post/[id]`) — Permalink Fallback

Retained for shared links and direct URL access. Not linked from the feed.

- Full body (markdown rendered to HTML)
- Reaction bar (emoji toggles)
- Threaded comments (one level deep)
- Staff/mod controls: edit, delete, pin/unpin

### Events View (`/community/events`)

- Upcoming events: date prominent, Google Meet link visible, "Add to Calendar" link
- Past events: date, recording link (if resource post linked)

### Staff Compose Form

Type selector reveals conditional fields:
- **Discussion:** title + body
- **Announcement:** title + body
- **Event:** title + body + date/time + Meet link
- **Resource:** title + body + URL

---

## Navigation Updates

- **Header desktop nav:** add "Community" between Courses and action buttons
- **Footer Help column:** add "Community"
- **Mobile nav Education section:** add "Community"

---

## Wix Cutover Strategy

### Build Now, Flip Later

All community code ships immediately. The 3 Wix URLs stay unchanged until Brian says "flip it."

**Wix URLs tagged for cutover:**

| File | Current (Wix) | New (after cutover) |
|------|---------------|---------------------|
| `save-the-uterus-club/thank-you.astro` | `wixstudio.com/.../group/save-the-uterus-club` | `/community` |
| `save-the-uterus-club/thank-you.astro` | `wixstudio.com/.../discussion` | `/community` |
| `linkinbio/jointhecall.astro` | `wixstudio.com/.../discussion` | `/community/events` |
| `stripe-webhook.js` | `wixstudio.com/.../group/save-the-uterus-club` | `/community` |

Each gets a `// STUC-CUTOVER:` comment with the replacement URL. Cutover = uncomment new, delete old, commit, push. 2 minutes.

### Free Account Holders

Post-signup, post-enrollment, and post-comment flows that previously nudged toward the free group → "Join Uterus Allies on Instagram" CTA instead.

---

## Post-Merge Enhancements

### Profile Avatars

**Status:** Not yet implemented. Currently all avatars are colored circles with first initial (purple for staff, gray for members).

**Problem:** The `user` table has no `picture` column. Google OAuth fetches the profile picture URL but never stores it. No API endpoint returns avatar URLs. ~26 of 36 STUC members have custom avatars on Wix (`static.wixstatic.com`) that will die at decommission.

**Implementation:**

1. **Schema migration** — add `picture TEXT` column to `user` table
2. **Google OAuth capture** — store `profile.picture` on sign-in and update on subsequent logins (`functions/api/auth/google-callback.js`)
3. **Wix avatar migration** — download the 26 custom images from Wix static media, upload to R2 (`avatars/` prefix), update `user.picture` for matched accounts. Source data: `~/Downloads/Here are all 36 members...scraped with their avatars and badges.md`
4. **API changes** — include `authorPicture` in responses from:
   - `GET /api/community/status` (user object)
   - `GET /api/community/posts` (each post)
   - `GET /api/community/comments` (each comment)
5. **Frontend rendering** — replace initial-circle `<span>` with `<img>` when picture URL exists, fall back to initial circle when null. Affects:
   - `/community` feed (post avatars, comment avatars, compose trigger avatar)
   - `/community/post/[id]` detail page (comment avatars — currently renders no avatars at all)
   - Account/profile page (if applicable)

**Avatar URL sources by priority:**
1. R2-hosted upload (migrated from Wix or future self-upload)
2. Google profile picture (`lh3.googleusercontent.com`)
3. Fall back to colored initial circle

---

## Non-Goals (Explicitly Out of Scope)

- Real-time updates (WebSocket/SSE) — polling or manual refresh is fine for this community size
- Direct messaging between members
- ~~File/image uploads in posts~~ — **Implemented 2026-02-26**: inline images via R2 upload + `![alt](url)` markdown, bare domain URL auto-detection in `linkify()`
- Email notifications for new posts (can add later)
- Multiple groups/spaces
- Rich text editor (markdown + a simple formatting toolbar is enough)
