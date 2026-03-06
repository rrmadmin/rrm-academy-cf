# STUC Community Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add member tier badges, achievement badges, avatar population, a members list page, and fix the duplicate pinned post bug in the Save the Uterus Club community.

**Architecture:** All changes build on existing D1 schema (`user_label` table, already populated from Wix import), the community API layer (`functions/api/community/`), and frontend rendering in `community/index.astro`. No new tables, no new external runtime dependencies.

**Tech Stack:** Cloudflare Pages Functions (JS), D1 (SQLite), R2 (object storage), Astro (SSG pages), vanilla JS frontend

**Design doc:** `docs/plans/2026-03-06-stuc-community-enhancements-design.md`

---

### Task 1: Fix Duplicate Pinned Post Bug

**Files:**
- Modify: `functions/api/community/posts.js:73-96`

**Context:** When "Load more" fires, the paginated query returns pinned posts again because the `WHERE` clause doesn't exclude them. Pinned posts should only appear at the top on the initial load, not in paginated results.

**Step 1: Add pinned exclusion to pagination branch**

In `functions/api/community/posts.js`, inside the `else` branch (non-event queries, line 73), add a condition that excludes pinned posts when `before` is set.

Change lines 82-84 from:
```javascript
      if (before) {
        whereClause += ' AND p.created_at < ?';
        params.push(before);
      }
```

To:
```javascript
      if (before) {
        whereClause += ' AND p.created_at < ? AND p.pinned = 0';
        params.push(before);
      }
```

**Step 2: Verify manually**

Open `https://rrmacademy.org/community/` in browser. Scroll to bottom. Click "Load more". Confirm the pinned "Welcome to our group" post does NOT appear a second time in the loaded results.

**Step 3: Commit**

```bash
cd ~/iCode/projects/rrm-academy-cf
git add functions/api/community/posts.js
git commit -m "fix: exclude pinned posts from paginated Load More results"
```

---

### Task 2: Add Tier Label Mapping to Shared Helpers

**Files:**
- Modify: `functions/api/community/_shared.js:1-136`

**Context:** The `user_label` table contains tier labels like `Uterus Member 🐻`, `Uterus Hero 💖`, `Uterus Super Hero 🦸‍♀️`. We need a shared mapping and a helper to convert label text to a tier string for use in posts and comments APIs.

**Step 1: Add tier constants after the role hierarchy block**

In `functions/api/community/_shared.js`, after line 17 (`}`), add:

```javascript

// --- Tier badge labels (from user_label table, Wix-imported) ---

export const TIER_LABEL_MAP = {
  'Uterus Member 🐻': 'member',
  'Uterus Hero 💖': 'hero',
  'Uterus Super Hero 🦸‍♀️': 'superhero',
};

export const TIER_LABELS_SQL = Object.keys(TIER_LABEL_MAP)
  .map(l => `'${l.replace(/'/g, "''")}'`)
  .join(', ');

export function tierFromLabel(label) {
  return label ? (TIER_LABEL_MAP[label] || null) : null;
}

export const TIER_DISPLAY = {
  member: '🐻 Member',
  hero: '💖 Hero',
  superhero: '🦸‍♀️ Superhero',
};
```

**Step 2: Commit**

```bash
git add functions/api/community/_shared.js
git commit -m "feat: add tier label mapping to community shared helpers"
```

---

### Task 3: Add authorTier to Posts API

**Files:**
- Modify: `functions/api/community/posts.js:28-159`

**Context:** The posts GET query joins `user` for author info but doesn't fetch the author's tier label. Add a LEFT JOIN on `user_label` to get the tier, and include `authorTier` in the response.

**Step 1: Update imports**

At line 9, add `tierFromLabel` and `TIER_LABELS_SQL` to the import:

```javascript
import {
  requireMember, displayName, canCreateType, canEditPost, canDeletePost, canPin, roleAtLeast,
  tierFromLabel, TIER_LABELS_SQL,
} from './_shared.js';
```

**Step 2: Update the event query SQL (lines 60-71)**

Change the SELECT and FROM to include the tier label LEFT JOIN:

```javascript
      sql = `
        SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar,
          ul.label as author_tier_label,
          (SELECT COUNT(*) FROM community_comment WHERE post_id = p.id) as comment_count
        FROM community_post p
        JOIN user u ON u.id = p.author_id
        LEFT JOIN user_label ul ON ul.user_id = p.author_id AND ul.label IN (${TIER_LABELS_SQL})
        ${eventWhere}
        ORDER BY
          CASE WHEN p.event_date >= ? THEN 0 ELSE 1 END,
          CASE WHEN p.event_date >= ? THEN p.event_date END ASC,
          CASE WHEN p.event_date < ? THEN p.event_date END DESC
        LIMIT ?
      `;
```

**Step 3: Update the non-event query SQL (lines 87-96)**

Same change:

```javascript
      sql = `
        SELECT p.*, u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar,
          ul.label as author_tier_label,
          (SELECT COUNT(*) FROM community_comment WHERE post_id = p.id) as comment_count
        FROM community_post p
        JOIN user u ON u.id = p.author_id
        LEFT JOIN user_label ul ON ul.user_id = p.author_id AND ul.label IN (${TIER_LABELS_SQL})
        WHERE 1=1 ${whereClause}
        ORDER BY p.pinned DESC, p.created_at DESC
        LIMIT ?
      `;
```

**Step 4: Add authorTier to the response mapping (lines 133-152)**

In the `rows.results.map()` callback, add after `authorAvatar`:

```javascript
      authorTier: tierFromLabel(r.author_tier_label),
```

**Step 5: Add authorTier to the POST create response (lines 230-244)**

In the created post response object, add after `authorRole`:

```javascript
        authorTier: null, // new posts don't need tier immediately; refresh will pick it up
```

**Step 6: Commit**

```bash
git add functions/api/community/posts.js
git commit -m "feat: include authorTier in posts API from user_label"
```

---

### Task 4: Add authorTier to Comments API

**Files:**
- Modify: `functions/api/community/comments.js:1-218`

**Context:** Same pattern as posts -- add LEFT JOIN on `user_label` for tier, include in response.

**Step 1: Update imports (line 7)**

```javascript
import { requireMember, displayName, canDeleteComment, roleAtLeast, tierFromLabel, TIER_LABELS_SQL } from './_shared.js';
```

**Step 2: Update the comments query SQL (lines 31-38)**

```javascript
    const rows = await db.prepare(`
      SELECT c.id, c.author_id, c.content, c.parent_id, c.created_at,
             u.name as author_name, u.first_name, u.last_name, u.role as author_role, u.avatar_url as author_avatar,
             ul.label as author_tier_label
      FROM community_comment c
      JOIN user u ON u.id = c.author_id
      LEFT JOIN user_label ul ON ul.user_id = c.author_id AND ul.label IN (${TIER_LABELS_SQL})
      WHERE c.post_id = ?
      ORDER BY c.created_at ASC
    `).bind(postId).all();
```

**Step 3: Add authorTier to comment object (lines 76-88)**

In the comment object construction, add after `authorAvatar`:

```javascript
        authorTier: tierFromLabel(row.author_tier_label),
```

**Step 4: Add authorTier to POST create response (lines 155-169)**

Add after `authorRole`:

```javascript
        authorTier: null,
```

**Step 5: Commit**

```bash
git add functions/api/community/comments.js
git commit -m "feat: include authorTier in comments API from user_label"
```

---

### Task 5: Render Tier Badges in Feed (Frontend)

**Files:**
- Modify: `src/pages/community/index.astro:496-570` (post rendering JS)
- Modify: `src/pages/community/index.astro:950-980` (comment rendering JS)
- Modify: `src/pages/community/index.astro:1782-1790` (CSS)

**Context:** The API now returns `authorTier` on posts and comments. The frontend needs to render tier badge pills for non-staff authors who have a tier.

**Step 1: Add tier display config near the top of the script block**

After the `STAFF_ROLES` array (find `var STAFF_ROLES`), add:

```javascript
      var TIER_DISPLAY = {
        member: '\u{1F43B} Member',
        hero: '\u{1F496} Hero',
        superhero: '\u{1F9B8}\u200D\u2640\uFE0F Superhero',
      };
```

**Step 2: Add tier badge to post card rendering**

In `renderPostCard()`, after the staff role badge block (lines 556-561), add an `else if` for tier badges:

Find this block:
```javascript
        if (authorIsStaff) {
          var roleBadge = document.createElement('span');
          roleBadge.className = 'post-role-badge';
          roleBadge.textContent = capitalize(post.authorRole);
          header.appendChild(roleBadge);
        }
```

Change to:
```javascript
        if (authorIsStaff) {
          var roleBadge = document.createElement('span');
          roleBadge.className = 'post-role-badge';
          roleBadge.textContent = capitalize(post.authorRole);
          header.appendChild(roleBadge);
        } else if (post.authorTier && TIER_DISPLAY[post.authorTier]) {
          var tierBadge = document.createElement('span');
          tierBadge.className = 'post-tier-badge post-tier-badge--' + post.authorTier;
          tierBadge.textContent = TIER_DISPLAY[post.authorTier];
          header.appendChild(tierBadge);
        }
```

**Step 3: Add tier badge to comment rendering**

In `renderCommentHtml()`, after the staff badge block (lines 974-976):

Find:
```javascript
        if (authorIsStaff) {
          html += '<span class="post-role-badge">' + escapeHtml(capitalize(c.authorRole)) + '</span>';
        }
```

Change to:
```javascript
        if (authorIsStaff) {
          html += '<span class="post-role-badge">' + escapeHtml(capitalize(c.authorRole)) + '</span>';
        } else if (c.authorTier && TIER_DISPLAY[c.authorTier]) {
          html += '<span class="post-tier-badge post-tier-badge--' + c.authorTier + '">' + escapeHtml(TIER_DISPLAY[c.authorTier]) + '</span>';
        }
```

**Step 4: Add tier badge CSS**

In the `<style>` block, after the `.post-role-badge` rule (after line 1790), add:

```css
  .post-tier-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 0 6px;
    border-radius: 8px;
    line-height: 18px;
  }
  .post-tier-badge--member {
    background: var(--neutral-100);
    color: var(--text-secondary);
  }
  .post-tier-badge--hero {
    background: #fef3c7;
    color: #92400e;
  }
  .post-tier-badge--superhero {
    background: #fce7f3;
    color: #9d174d;
  }
```

**Step 5: Verify manually**

Deploy to preview. Open /community. Check that:
- Brian's posts show "Superadmin" badge (staff, unchanged)
- Lorraine Truman's posts show a tier badge if she has one (check D1)
- Members without a tier label show no badge
- Comments also show tier badges

**Step 6: Commit**

```bash
git add src/pages/community/index.astro
git commit -m "feat: render tier badges for STUC members in feed and comments"
```

---

### Task 6: Create Members API Endpoint

**Files:**
- Create: `functions/api/community/members.js`

**Context:** New endpoint that returns all active STUC members with their tier, labels, and last activity timestamp. Uses the same membership gate logic as the feed but lists ALL qualifying members rather than just the current user.

**Step 1: Create the file**

Create `functions/api/community/members.js`:

```javascript
/**
 * GET /api/community/members -- list all active STUC members
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { requireMember, displayName, roleAtLeast, tierFromLabel, TIER_LABEL_MAP } from './_shared.js';

const TIER_LABELS = Object.keys(TIER_LABEL_MAP);

const ACHIEVEMENT_LABELS = {
  'Donor 👏': 'Donor',
  'Masterclass in Endometriosis & Surgery': 'Endo Masterclass',
  'Masterclass in Endometriosis and Surgery': 'Endo Masterclass',
  'Long Term Endometriosis Management': 'Long Term Endo',
  'Restorative Reproductive Medicine (RRM) vs Standard ART: A New Approach to Infertility': 'RRM vs ART',
  'Postpartum Depression & Anxiety: a restorative approach to recovery': 'Postpartum',
};

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;

    const db = env.DB;

    // Get all users who are STUC members:
    // 1. Staff (mod+)
    // 2. Users with grandfathered label 'Save the Uterus Club 🏷️'
    // 3. Users with active Stripe subscription (we approximate by having stripe_customer_id)
    // Note: For simplicity, we include anyone with the STUC label OR staff role.
    // Stripe-only members without a label are rare (only 2 have stripe_customer_id).
    const rows = await db.prepare(`
      SELECT DISTINCT u.id, u.name, u.first_name, u.last_name, u.role, u.avatar_url, u.created_at,
        (SELECT MAX(created_at) FROM (
          SELECT created_at FROM community_post WHERE author_id = u.id
          UNION ALL
          SELECT created_at FROM community_comment WHERE author_id = u.id
        )) as last_active
      FROM user u
      WHERE u.blocked = 0 AND (
        u.role IN ('mod', 'admin', 'superadmin')
        OR u.id IN (SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club 🏷️')
      )
      ORDER BY last_active DESC NULLS LAST, u.created_at DESC
    `).all();

    const userIds = rows.results.map(r => r.id);
    if (!userIds.length) return json({ ok: true, members: [] });

    // Fetch all labels for these users in one query
    const placeholders = userIds.map(() => '?').join(',');
    const labelsRows = await db.prepare(
      `SELECT user_id, label FROM user_label WHERE user_id IN (${placeholders})`
    ).bind(...userIds).all();

    // Build label map: userId -> { tier, achievements }
    const labelMap = {};
    for (const row of labelsRows.results) {
      if (!labelMap[row.user_id]) labelMap[row.user_id] = { tier: null, achievements: [] };
      if (TIER_LABELS.includes(row.label)) {
        labelMap[row.user_id].tier = TIER_LABEL_MAP[row.label];
      }
      if (ACHIEVEMENT_LABELS[row.label]) {
        const display = ACHIEVEMENT_LABELS[row.label];
        if (!labelMap[row.user_id].achievements.includes(display)) {
          labelMap[row.user_id].achievements.push(display);
        }
      }
    }

    const members = rows.results.map(r => {
      const info = labelMap[r.id] || { tier: null, achievements: [] };
      return {
        id: r.id,
        name: r.name || displayName(r),
        role: r.role,
        avatarUrl: r.avatar_url || null,
        tier: info.tier,
        achievements: info.achievements,
        lastActive: r.last_active || null,
        joinedAt: r.created_at,
      };
    });

    return json({ ok: true, members });
  } catch (err) {
    console.error('community members GET error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

**Step 2: Commit**

```bash
git add functions/api/community/members.js
git commit -m "feat: add GET /api/community/members endpoint"
```

---

### Task 7: Create Members List Page

**Files:**
- Create: `src/pages/community/members.astro`

**Context:** New page at `/community/members` showing all STUC members in a responsive grid with avatars, tier badges, achievement badges, and activity status. Same membership gate as the feed.

**Step 1: Create the page**

Create `src/pages/community/members.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
---
<BaseLayout
  title="Members | Save the Uterus Club"
  description="Meet the members of the Save the Uterus Club community."
  noindex
>
  <section class="members-page">
    <div class="container">

      <div id="members-loading" class="members-loading">
        <p>Loading...</p>
      </div>

      <div id="members-gate" hidden>
        <div class="gate-hero">
          <h1>Save the Uterus Club</h1>
          <p>You need an active membership to view the members list.</p>
          <a href="/save-the-uterus-club/" class="btn btn--primary btn--lg">Join the Save the Uterus Club</a>
        </div>
      </div>

      <div id="members-feed" hidden>
        <div class="members-header">
          <h2>Members</h2>
          <a href="/community/" class="members-back">&larr; Back to Feed</a>
        </div>
        <div id="members-grid" class="members-grid"></div>
      </div>

    </div>
  </section>

  <script is:inline>
    (function () {
      var loadingEl = document.getElementById('members-loading');
      var gateEl = document.getElementById('members-gate');
      var feedEl = document.getElementById('members-feed');
      var gridEl = document.getElementById('members-grid');

      var TIER_DISPLAY = {
        member: '\u{1F43B} Member',
        hero: '\u{1F496} Hero',
        superhero: '\u{1F9B8}\u200D\u2640\uFE0F Superhero',
      };

      function escapeHtml(str) {
        var d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
      }

      function timeAgo(dateStr) {
        if (!dateStr) return null;
        var now = Date.now();
        var then = new Date(dateStr.replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z')).getTime();
        var diff = Math.floor((now - then) / 1000);
        if (diff < 60) return 'Active now';
        if (diff < 3600) return 'Active ' + Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return 'Active ' + Math.floor(diff / 3600) + 'h ago';
        if (diff < 2592000) return 'Active ' + Math.floor(diff / 86400) + 'd ago';
        var d = new Date(then);
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return 'Member since ' + months[d.getMonth()] + ' ' + d.getFullYear();
      }

      function renderMemberCard(m) {
        var html = '<div class="member-card">';

        // Avatar
        if (m.avatarUrl) {
          html += '<img class="member-avatar member-avatar--img" src="' + escapeHtml(m.avatarUrl) + '" alt="' + escapeHtml(m.name) + '" loading="lazy" />';
        } else {
          html += '<span class="member-avatar">' + escapeHtml((m.name || 'M').charAt(0).toUpperCase()) + '</span>';
        }

        // Info
        html += '<div class="member-info">';
        html += '<span class="member-name">' + escapeHtml(m.name) + '</span>';

        // Badges row
        html += '<div class="member-badges">';

        // Staff or tier badge
        var STAFF_ROLES = ['superadmin', 'admin', 'mod'];
        if (STAFF_ROLES.indexOf(m.role) !== -1) {
          html += '<span class="post-role-badge">' + escapeHtml(m.role.charAt(0).toUpperCase() + m.role.slice(1)) + '</span>';
        } else if (m.tier && TIER_DISPLAY[m.tier]) {
          html += '<span class="post-tier-badge post-tier-badge--' + m.tier + '">' + escapeHtml(TIER_DISPLAY[m.tier]) + '</span>';
        }

        // Achievement badges
        if (m.achievements && m.achievements.length) {
          for (var i = 0; i < m.achievements.length; i++) {
            html += '<span class="achievement-badge">' + escapeHtml(m.achievements[i]) + '</span>';
          }
        }

        html += '</div>'; // .member-badges

        // Activity
        var activity = m.lastActive ? timeAgo(m.lastActive) : timeAgo(m.joinedAt);
        if (activity) {
          html += '<span class="member-activity">' + escapeHtml(activity) + '</span>';
        }

        html += '</div>'; // .member-info
        html += '</div>'; // .member-card
        return html;
      }

      // Status check
      fetch('/api/community/status', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          loadingEl.hidden = true;
          if (!data.ok || data.access !== 'member') {
            gateEl.hidden = false;
            return;
          }
          feedEl.hidden = false;
          loadMembers();
        })
        .catch(function () {
          loadingEl.hidden = true;
          gateEl.hidden = false;
        });

      function loadMembers() {
        fetch('/api/community/members', { credentials: 'same-origin' })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok || !data.members) {
              gridEl.innerHTML = '<p>Unable to load members.</p>';
              return;
            }
            var html = '';
            for (var i = 0; i < data.members.length; i++) {
              html += renderMemberCard(data.members[i]);
            }
            gridEl.innerHTML = html;
          })
          .catch(function () {
            gridEl.innerHTML = '<p>Unable to load members.</p>';
          });
      }
    })();
  </script>

  <style>
    .members-page {
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
    .members-loading {
      text-align: center;
      padding: 4rem 0;
      color: var(--text-secondary);
    }
    .members-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 1.5rem;
    }
    .members-header h2 {
      font-size: 1.5rem;
      margin: 0;
    }
    .members-back {
      font-size: 14px;
      color: var(--text-secondary);
      text-decoration: none;
    }
    .members-back:hover {
      color: var(--accent);
    }
    .members-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .member-card {
      display: flex;
      gap: 12px;
      padding: 12px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      background: var(--bg-surface);
    }
    .member-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--neutral-200);
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1rem;
      flex-shrink: 0;
    }
    img.member-avatar--img {
      object-fit: cover;
    }
    .member-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }
    .member-name {
      font-weight: 700;
      font-size: 14px;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .member-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .achievement-badge {
      font-size: 10px;
      font-weight: 500;
      color: var(--text-tertiary);
      background: var(--neutral-100);
      padding: 0 5px;
      border-radius: 6px;
      line-height: 16px;
    }
    .member-activity {
      font-size: 12px;
      color: var(--text-tertiary);
    }

    /* Reuse badge styles from community feed */
    .post-role-badge {
      font-size: 11px;
      font-weight: 600;
      color: var(--purple-700);
      background: var(--purple-50);
      padding: 0 6px;
      border-radius: 8px;
      line-height: 18px;
    }
    .post-tier-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 0 6px;
      border-radius: 8px;
      line-height: 18px;
    }
    .post-tier-badge--member {
      background: var(--neutral-100);
      color: var(--text-secondary);
    }
    .post-tier-badge--hero {
      background: #fef3c7;
      color: #92400e;
    }
    .post-tier-badge--superhero {
      background: #fce7f3;
      color: #9d174d;
    }

    @media (max-width: 600px) {
      .members-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</BaseLayout>
```

**Step 2: Verify manually**

Deploy to preview. Navigate to `/community/members`. Confirm:
- Page loads and shows member grid
- Each member card shows avatar (or initial), name, tier badge, achievement badges
- Activity status shows relative time or "Member since" date
- Responsive: at 375px width, grid collapses to single column
- Non-members see gate page

**Step 3: Commit**

```bash
git add src/pages/community/members.astro
git commit -m "feat: add /community/members page with tier and achievement badges"
```

---

### Task 8: Fix Display Names for Members with No Name

**Context:** 6 STUC members have no `name` field set. Some have `first_name`/`last_name`. Fix via one-time D1 SQL.

**Step 1: Run the SQL update via Cloudflare API**

Using the Cloudflare API MCP tool, execute:

```sql
UPDATE user
SET name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
WHERE name IS NULL OR name = ''
  AND (first_name IS NOT NULL OR last_name IS NOT NULL)
  AND id IN (
    SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club 🏷️'
  );
```

**Step 2: Verify**

Query the same 6 members to confirm names are now set:

```sql
SELECT id, name, first_name, last_name, email
FROM user
WHERE id IN (SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club 🏷️')
  AND (name IS NULL OR name = '');
```

Expected: 0 rows (all fixed), OR remaining rows where first_name and last_name are both null (nothing we can do).

**Step 3: No git commit needed** -- this is a data fix, not a code change.

---

### Task 9: Populate Avatars via unavatar.io Batch Script

**Files:**
- Create: `scripts/populate-avatars.mjs`

**Context:** 36 STUC members have no avatar. We'll fetch from unavatar.io, upload to R2, and update D1. This script runs locally once via `node scripts/populate-avatars.mjs`.

**Step 1: Create the script**

Create `scripts/populate-avatars.mjs`:

```javascript
#!/usr/bin/env node
/**
 * populate-avatars.mjs
 *
 * Fetches avatars from unavatar.io for STUC members missing them,
 * uploads to R2 via Cloudflare API, updates D1 avatar_url.
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID env vars
 * Usage: node scripts/populate-avatars.mjs
 */

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_ID = '22742c9c-77fa-4344-abda-7e7e8b0da9de';
const R2_BUCKET = 'rrm-assets'; // adjust to actual bucket name

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN env vars');
  process.exit(1);
}

async function d1Query(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result[0].results;
}

async function main() {
  // Get STUC members missing avatars
  const members = await d1Query(`
    SELECT u.id, u.email, u.name
    FROM user u
    JOIN user_label ul ON ul.user_id = u.id AND ul.label = 'Save the Uterus Club 🏷️'
    WHERE (u.avatar_url IS NULL OR u.avatar_url = '')
      AND u.blocked = 0
  `);

  console.log(`Found ${members.length} STUC members without avatars`);

  let found = 0;
  let skipped = 0;

  for (const m of members) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`https://unavatar.io/${encodeURIComponent(m.email)}`, {
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!res.ok || res.status === 404) {
        console.log(`  SKIP ${m.name || m.email}: ${res.status}`);
        skipped++;
        continue;
      }

      const contentType = res.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        console.log(`  SKIP ${m.name || m.email}: not an image (${contentType})`);
        skipped++;
        continue;
      }

      const imageData = await res.arrayBuffer();
      if (imageData.byteLength < 100) {
        console.log(`  SKIP ${m.name || m.email}: image too small`);
        skipped++;
        continue;
      }

      // Upload to R2
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const r2Key = `avatars/${m.id}.${ext}`;
      const r2Url = `/api/assets/${r2Key}`;

      const uploadRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}/objects/${r2Key}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${CF_API_TOKEN}`,
            'Content-Type': contentType,
          },
          body: imageData,
        }
      );

      if (!uploadRes.ok) {
        console.log(`  FAIL ${m.name || m.email}: R2 upload failed (${uploadRes.status})`);
        skipped++;
        continue;
      }

      // Update D1
      await d1Query(
        'UPDATE user SET avatar_url = ? WHERE id = ?',
        [r2Url, m.id]
      );

      console.log(`  OK   ${m.name || m.email} -> ${r2Url}`);
      found++;
    } catch (err) {
      console.log(`  FAIL ${m.name || m.email}: ${err.message}`);
      skipped++;
    }

    // Rate limit: 1 req/sec to unavatar.io
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone: ${found} avatars found and saved, ${skipped} skipped`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
```

**Step 2: Run the script**

```bash
cd ~/iCode/projects/rrm-academy-cf
# Set env vars (get token from 1Password or wrangler whoami)
export CLOUDFLARE_ACCOUNT_ID="your-account-id"
export CLOUDFLARE_API_TOKEN="your-api-token"
node scripts/populate-avatars.mjs
```

Review output. Note: the R2 bucket name and asset serving path may need adjustment. Check `wrangler.toml` for the actual R2 bucket binding name.

**Step 3: Commit**

```bash
git add scripts/populate-avatars.mjs
git commit -m "feat: add one-time avatar population script using unavatar.io"
```

---

### Task 10: Deploy and Verify

**Step 1: Build and deploy**

```bash
cd ~/iCode/projects/rrm-academy-cf
npm run build
source ~/.zshrc && npx wrangler pages deploy dist --project-name rrm-academy
```

**Step 2: Verify all features**

Using Playwright or manual browser testing:

1. **Pinned post fix**: Load /community, click "Load more", confirm no duplicate pinned post
2. **Tier badges in feed**: Check posts by members with tier labels show colored pill badges
3. **Staff badges unchanged**: Brian's posts still show "Superadmin" purple badge
4. **Comment tier badges**: Expand comments, check tier badges on comment authors
5. **Members list**: Navigate to /community/members, confirm grid loads with all STUC members
6. **Achievement badges on members list**: Check that course/donation badges appear on member cards
7. **Avatar population**: Check that previously avatar-less members now show images (after running batch script)
8. **Mobile**: Resize to 375px, confirm members grid collapses to single column

**Step 3: Final commit and push**

```bash
git add -A
git commit -m "feat: STUC community enhancements -- tier badges, members list, avatar population"
git push
```
