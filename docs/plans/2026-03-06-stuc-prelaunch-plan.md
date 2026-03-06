# STUC Community Pre-Launch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reporting/flagging, user banning, comment editing, and email notifications to the STUC community so it's ready for launch.

**Architecture:** Four independent features built on the existing CF Workers + D1 + R2 stack. Each feature adds an API endpoint (following existing patterns in `functions/api/community/`), a schema migration (ALTER TABLE via D1 REST API), and frontend JS in the existing inline `<script is:inline>` blocks. Email notifications use the existing SES helper (`functions/api/_ses.js`).

**Tech Stack:** Cloudflare Workers (Pages Functions), D1 (SQLite), AWS SES via `aws4fetch`, Astro (static pages with inline JS)

**Design doc:** `docs/plans/2026-03-06-stuc-prelaunch-design.md`

---

### Task 1: Schema migrations -- community_flag table and column additions

Add the `community_flag` table, `updated_at` column to `community_comment`, and `community_email_opt_out` column to `user`.

**Files:**
- Modify: `schema.sql` (append new table + indexes)

**Step 1: Add community_flag table and new columns to schema.sql**

Append to the end of `schema.sql` (before any trailing whitespace):

```sql
-- Community Flags (reporting/flagging)

CREATE TABLE IF NOT EXISTS community_flag (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id),
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_by TEXT REFERENCES user(id),
    resolved_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_community_flag_status ON community_flag(status);
CREATE INDEX IF NOT EXISTS idx_community_flag_target ON community_flag(target_type, target_id);
```

**Step 2: Run migrations against live D1**

Run each statement individually via the Cloudflare D1 REST API (same pattern as existing scripts). Use the `wrangler d1 execute` command:

```bash
cd ~/iCode/projects/rrm-academy-cf

# Create community_flag table
npx wrangler d1 execute rrm-auth --remote --command "CREATE TABLE IF NOT EXISTS community_flag (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id), target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'pending', resolved_by TEXT REFERENCES user(id), resolved_at TEXT, created_at TEXT DEFAULT (datetime('now')), UNIQUE(user_id, target_type, target_id))"

# Create indexes
npx wrangler d1 execute rrm-auth --remote --command "CREATE INDEX IF NOT EXISTS idx_community_flag_status ON community_flag(status)"
npx wrangler d1 execute rrm-auth --remote --command "CREATE INDEX IF NOT EXISTS idx_community_flag_target ON community_flag(target_type, target_id)"

# Add updated_at to community_comment
npx wrangler d1 execute rrm-auth --remote --command "ALTER TABLE community_comment ADD COLUMN updated_at TEXT"

# Add community_email_opt_out to user
npx wrangler d1 execute rrm-auth --remote --command "ALTER TABLE user ADD COLUMN community_email_opt_out INTEGER DEFAULT 0"
```

**Step 3: Verify migrations**

```bash
npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(community_flag)"
npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(community_comment)" | grep updated_at
npx wrangler d1 execute rrm-auth --remote --command "PRAGMA table_info(user)" | grep community_email_opt_out
```

Expected: all three return rows showing the new columns/table.

**Step 4: Commit**

```bash
git add schema.sql
git commit -m "schema: add community_flag table, comment updated_at, email opt-out column"
```

---

### Task 2: Reporting/Flagging API

Create the flags endpoint and add a helper to send mod notification emails.

**Files:**
- Create: `functions/api/community/flags.js`
- Modify: `functions/api/community/_shared.js` (add `canResolveFlag` helper)

**Step 1: Add canResolveFlag to _shared.js**

Add after the existing `canDeleteComment` function (around line 65):

```js
export function canResolveFlag(role) {
  return roleAtLeast(role, 'admin');
}
```

**Step 2: Create flags.js**

Create `functions/api/community/flags.js`:

```js
/**
 * POST   /api/community/flags   -- create a flag (any member)
 * GET    /api/community/flags   -- list pending flags (mod+ only)
 * PATCH  /api/community/flags   -- resolve/dismiss a flag (admin+ only)
 */
import { json, optionsResponse, generateId } from '../auth/_shared.js';
import { SITE_URL } from '../auth/_shared.js';
import { requireMember, roleAtLeast, canResolveFlag, displayName } from './_shared.js';
import { sendEmail } from '../_ses.js';

const VALID_REASONS = ['inappropriate', 'spam', 'harassment', 'other'];

export async function onRequestOptions() {
  return optionsResponse();
}

// --- POST: create flag ---

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { targetType, targetId, reason, note } = body;

    if (!targetType || !['post', 'comment'].includes(targetType)) {
      return json({ ok: false, error: 'Invalid targetType' }, 400);
    }
    if (!targetId) return json({ ok: false, error: 'targetId required' }, 400);
    if (!reason || !VALID_REASONS.includes(reason)) {
      return json({ ok: false, error: 'Invalid reason' }, 400);
    }
    if (note && note.length > 500) {
      return json({ ok: false, error: 'Note too long (max 500 chars)' }, 400);
    }

    const db = env.DB;

    // Verify target exists
    if (targetType === 'post') {
      const post = await db.prepare('SELECT id FROM community_post WHERE id = ?').bind(targetId).first();
      if (!post) return json({ ok: false, error: 'Post not found' }, 404);
    } else {
      const comment = await db.prepare('SELECT id FROM community_comment WHERE id = ?').bind(targetId).first();
      if (!comment) return json({ ok: false, error: 'Comment not found' }, 404);
    }

    // Check for duplicate flag
    const existing = await db.prepare(
      'SELECT id FROM community_flag WHERE user_id = ? AND target_type = ? AND target_id = ?'
    ).bind(user.id, targetType, targetId).first();
    if (existing) {
      return json({ ok: false, error: 'You have already flagged this content' }, 409);
    }

    const id = generateId();
    await db.prepare(`
      INSERT INTO community_flag (id, user_id, target_type, target_id, reason, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, user.id, targetType, targetId, reason, note?.trim() || null).run();

    // Send email notification to all mod+ users
    try {
      await notifyMods(env, db, user, targetType, targetId, reason, note);
    } catch (err) {
      console.error('Failed to send flag notification email:', err.message);
      // Don't fail the flag creation if email fails
    }

    return json({ ok: true, flagId: id }, 201);
  } catch (err) {
    console.error('community flags POST error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- GET: list flags (mod+ only) ---

export async function onRequestGet({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!roleAtLeast(user.role, 'mod')) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || 'pending';

    const db = env.DB;
    const rows = await db.prepare(`
      SELECT f.*, u.name as reporter_name, u.first_name as reporter_first_name, u.last_name as reporter_last_name
      FROM community_flag f
      JOIN user u ON u.id = f.user_id
      WHERE f.status = ?
      ORDER BY f.created_at DESC
      LIMIT 50
    `).bind(status).all();

    // Fetch content previews for each flag
    const flags = [];
    for (const f of rows.results) {
      let contentPreview = '';
      let contentAuthor = '';
      if (f.target_type === 'post') {
        const post = await db.prepare('SELECT title, body, author_id FROM community_post WHERE id = ?').bind(f.target_id).first();
        if (post) {
          contentPreview = post.title + (post.body ? ': ' + post.body.slice(0, 100) : '');
          const author = await db.prepare('SELECT name, first_name, last_name FROM user WHERE id = ?').bind(post.author_id).first();
          contentAuthor = author ? (author.name || displayName(author)) : 'Unknown';
        }
      } else {
        const comment = await db.prepare('SELECT content, author_id FROM community_comment WHERE id = ?').bind(f.target_id).first();
        if (comment) {
          contentPreview = comment.content.slice(0, 200);
          const author = await db.prepare('SELECT name, first_name, last_name FROM user WHERE id = ?').bind(comment.author_id).first();
          contentAuthor = author ? (author.name || displayName(author)) : 'Unknown';
        }
      }

      flags.push({
        id: f.id,
        reporterName: f.reporter_name || displayName({ first_name: f.reporter_first_name, last_name: f.reporter_last_name }),
        targetType: f.target_type,
        targetId: f.target_id,
        reason: f.reason,
        note: f.note,
        status: f.status,
        contentPreview,
        contentAuthor,
        createdAt: f.created_at,
      });
    }

    return json({ ok: true, flags });
  } catch (err) {
    console.error('community flags GET error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- PATCH: resolve/dismiss flag (admin+ only) ---

export async function onRequestPatch({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!canResolveFlag(user.role)) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { flagId, status } = body;
    if (!flagId) return json({ ok: false, error: 'flagId required' }, 400);
    if (!status || !['resolved', 'dismissed'].includes(status)) {
      return json({ ok: false, error: 'status must be resolved or dismissed' }, 400);
    }

    const db = env.DB;
    const flag = await db.prepare('SELECT * FROM community_flag WHERE id = ?').bind(flagId).first();
    if (!flag) return json({ ok: false, error: 'Flag not found' }, 404);

    await db.prepare(
      "UPDATE community_flag SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?"
    ).bind(status, user.id, flagId).run();

    return json({ ok: true });
  } catch (err) {
    console.error('community flags PATCH error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- Email notification helper ---

async function notifyMods(env, db, reporter, targetType, targetId, reason, note) {
  // Get all mod+ users' emails
  const mods = await db.prepare(
    "SELECT email FROM user WHERE role IN ('mod', 'admin', 'superadmin') AND blocked = 0"
  ).all();

  if (!mods.results.length) return;

  // Get content preview
  let contentPreview = '';
  let postId = targetId;
  if (targetType === 'post') {
    const post = await db.prepare('SELECT title, body FROM community_post WHERE id = ?').bind(targetId).first();
    if (post) contentPreview = post.title + (post.body ? ': ' + post.body.slice(0, 100) : '');
  } else {
    const comment = await db.prepare('SELECT content, post_id FROM community_comment WHERE id = ?').bind(targetId).first();
    if (comment) {
      contentPreview = comment.content.slice(0, 200);
      postId = comment.post_id;
    }
  }

  const reporterName = displayName(reporter);
  const link = `${SITE_URL}/community/post/${postId}/`;

  const subject = `[STUC] Content flagged: ${reason}`;
  const html = `
    <p><strong>${reporterName}</strong> flagged a ${targetType} as <strong>${reason}</strong>.</p>
    ${note ? `<p>Note: ${note}</p>` : ''}
    <p>Content preview:<br><em>${contentPreview || '(unable to load preview)'}</em></p>
    <p><a href="${link}">View in community</a></p>
  `;
  const text = `${reporterName} flagged a ${targetType} as ${reason}.\n${note ? `Note: ${note}\n` : ''}Content: ${contentPreview || '(unable to load)'}\nView: ${link}`;

  const modEmails = mods.results.map(m => m.email);

  await sendEmail(env, {
    from: 'noreply@rrmacademy.org',
    to: modEmails,
    subject,
    html,
    text,
  });
}
```

**Step 3: Commit**

```bash
git add functions/api/community/flags.js functions/api/community/_shared.js
git commit -m "feat: add reporting/flagging API with mod email notifications"
```

---

### Task 3: Flagging UI on post detail page

Add flag button and modal to the post detail page for both posts and comments.

**Files:**
- Modify: `src/pages/community/post/[...id].astro`

**Step 1: Add flag modal HTML**

Add after the `<!-- Edit form -->` section (around line 132), before `<!-- Comments section -->`:

```html
        <!-- Flag modal -->
        <div id="flag-modal" class="modal-overlay" hidden>
          <div class="modal-card">
            <h3 class="modal-title">Report Content</h3>
            <div class="form-group">
              <label class="form-label" for="flag-reason">Reason</label>
              <select class="form-input" id="flag-reason">
                <option value="">Select a reason...</option>
                <option value="inappropriate">Inappropriate</option>
                <option value="spam">Spam</option>
                <option value="harassment">Harassment</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="flag-note">Details (optional)</label>
              <textarea class="form-input form-textarea form-textarea--sm" id="flag-note" rows="2" maxlength="500" placeholder="Any additional context..."></textarea>
            </div>
            <div id="flag-error" class="edit-feedback edit-feedback--error" hidden>
              <p id="flag-error-text"></p>
            </div>
            <div class="modal-actions">
              <button id="flag-submit" class="btn btn--primary btn--sm">Submit Report</button>
              <button id="flag-cancel" class="btn btn--secondary btn--sm">Cancel</button>
            </div>
          </div>
        </div>
```

**Step 2: Add flag button to post controls**

In the post controls div (line ~90-94), add a flag button visible to all members:

```html
        <!-- Staff controls -->
        <div id="post-controls" class="post-controls" hidden>
          <button id="ctrl-edit" class="btn btn--text btn--sm">Edit</button>
          <button id="ctrl-pin" class="btn btn--text btn--sm" hidden></button>
          <button id="ctrl-delete" class="btn btn--text btn--sm ctrl-delete">Delete</button>
        </div>
        <!-- Flag button (all members) -->
        <button id="ctrl-flag-post" class="btn btn--text btn--sm flag-btn" hidden>Flag</button>
```

**Step 3: Add flag button to comment rendering**

In the `renderCommentHtml` function (around line 621), add a flag button in the comment-actions div. Add after the delete button line:

```js
        html += '<button class="btn btn--text btn--sm comment-flag-btn" data-target-type="comment" data-target-id="' + c.id + '">Flag</button>';
```

**Step 4: Add flag modal JS logic**

Add to the `<script is:inline>` block, after the existing comment event handlers. Add these variable declarations near the top DOM refs section:

```js
      var flagModal = document.getElementById('flag-modal');
      var flagReason = document.getElementById('flag-reason');
      var flagNote = document.getElementById('flag-note');
      var flagSubmit = document.getElementById('flag-submit');
      var flagCancel = document.getElementById('flag-cancel');
      var flagError = document.getElementById('flag-error');
      var flagErrorText = document.getElementById('flag-error-text');
      var ctrlFlagPost = document.getElementById('ctrl-flag-post');
      var flagTargetType = null;
      var flagTargetId = null;
```

Add the flag modal logic:

```js
      // Show flag button for non-own posts
      function updateFlagPostButton() {
        if (currentPost && !currentPost.isOwn) {
          ctrlFlagPost.hidden = false;
        }
      }

      // Open flag modal
      function openFlagModal(targetType, targetId) {
        flagTargetType = targetType;
        flagTargetId = targetId;
        flagReason.value = '';
        flagNote.value = '';
        flagError.hidden = true;
        flagModal.hidden = false;
      }

      ctrlFlagPost.addEventListener('click', function () {
        openFlagModal('post', currentPost.id);
      });

      // Delegated handler for comment flag buttons
      document.addEventListener('click', function (e) {
        var flagBtn = e.target.closest('.comment-flag-btn');
        if (!flagBtn) return;
        openFlagModal(
          flagBtn.getAttribute('data-target-type'),
          flagBtn.getAttribute('data-target-id')
        );
      });

      flagCancel.addEventListener('click', function () {
        flagModal.hidden = true;
      });

      flagSubmit.addEventListener('click', function () {
        var reason = flagReason.value;
        if (!reason) {
          flagErrorText.textContent = 'Please select a reason.';
          flagError.hidden = false;
          return;
        }
        flagError.hidden = true;
        flagSubmit.disabled = true;
        flagSubmit.textContent = 'Submitting...';
        fetch('/api/community/flags', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetType: flagTargetType,
            targetId: flagTargetId,
            reason: reason,
            note: flagNote.value.trim() || null,
          }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            flagSubmit.disabled = false;
            flagSubmit.textContent = 'Submit Report';
            if (!data.ok) {
              flagErrorText.textContent = data.error || 'Failed to submit report.';
              flagError.hidden = false;
              return;
            }
            flagModal.hidden = true;
            alert('Report submitted. Thank you.');
          })
          .catch(function () {
            flagSubmit.disabled = false;
            flagSubmit.textContent = 'Submit Report';
            flagErrorText.textContent = 'Network error. Please try again.';
            flagError.hidden = false;
          });
      });
```

**Step 5: Call updateFlagPostButton at end of renderPost function**

In the `renderPost` function, add at the end (after `showState(contentEl)`):

```js
        updateFlagPostButton();
```

**Step 6: Add modal CSS**

Add to the `<style>` section:

```css
    /* Flag modal */
    .flag-btn {
      color: var(--text-tertiary);
    }
    .flag-btn:hover {
      color: var(--red-600, #dc2626);
    }
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 16px;
    }
    .modal-card {
      background: var(--white, #fff);
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
    }
    .modal-title {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 16px;
    }
    .modal-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
```

**Step 7: Commit**

```bash
git add src/pages/community/post/[...id].astro
git commit -m "feat: add flag button and modal to post detail page"
```

---

### Task 4: User banning API

Add ban/unban endpoints for admin+ users.

**Files:**
- Create: `functions/api/community/ban.js`

**Step 1: Create ban.js**

```js
/**
 * POST /api/community/ban    -- ban a user (admin+ only)
 * POST /api/community/unban  -- unban a user (admin+ only)
 *
 * Note: These are separate route files. ban.js handles POST to /api/community/ban.
 * unban.js handles POST to /api/community/unban.
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { requireMember, roleAtLeast } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { userId, deleteContent } = body;
    if (!userId) return json({ ok: false, error: 'userId required' }, 400);

    const db = env.DB;

    // Verify target user exists and isn't already blocked
    const target = await db.prepare('SELECT id, role, blocked FROM user WHERE id = ?').bind(userId).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (target.blocked) return json({ ok: false, error: 'User is already banned' }, 409);

    // Prevent banning admins/superadmins
    if (roleAtLeast(target.role, 'admin')) {
      return json({ ok: false, error: 'Cannot ban an admin' }, 403);
    }

    // Prevent banning yourself
    if (userId === user.id) {
      return json({ ok: false, error: 'Cannot ban yourself' }, 400);
    }

    const statements = [
      // Block the user
      db.prepare('UPDATE user SET blocked = 1 WHERE id = ?').bind(userId),
      // Delete their sessions (immediate logout)
      db.prepare('DELETE FROM session WHERE user_id = ?').bind(userId),
    ];

    if (deleteContent) {
      // Delete reactions on their posts
      statements.push(
        db.prepare("DELETE FROM community_reaction WHERE target_type = 'post' AND target_id IN (SELECT id FROM community_post WHERE author_id = ?)").bind(userId)
      );
      // Delete reactions on comments on their posts
      statements.push(
        db.prepare("DELETE FROM community_reaction WHERE target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE author_id = ?)").bind(userId)
      );
      // Delete their comments
      statements.push(
        db.prepare('DELETE FROM community_comment WHERE author_id = ?').bind(userId)
      );
      // Delete their posts (CASCADE will handle post comments)
      statements.push(
        db.prepare('DELETE FROM community_post WHERE author_id = ?').bind(userId)
      );
      // Resolve any pending flags against this user's content
      statements.push(
        db.prepare("UPDATE community_flag SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE status = 'pending' AND ((target_type = 'post' AND target_id IN (SELECT id FROM community_post WHERE author_id = ?)) OR (target_type = 'comment' AND target_id IN (SELECT id FROM community_comment WHERE author_id = ?)))").bind(user.id, userId, userId)
      );
    }

    await db.batch(statements);

    return json({ ok: true });
  } catch (err) {
    console.error('community ban POST error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

**Step 2: Create unban.js**

Create `functions/api/community/unban.js`:

```js
/**
 * POST /api/community/unban -- unban a user (admin+ only)
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { requireMember, roleAtLeast } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    if (!roleAtLeast(user.role, 'admin')) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { userId } = body;
    if (!userId) return json({ ok: false, error: 'userId required' }, 400);

    const db = env.DB;
    const target = await db.prepare('SELECT id, blocked FROM user WHERE id = ?').bind(userId).first();
    if (!target) return json({ ok: false, error: 'User not found' }, 404);
    if (!target.blocked) return json({ ok: false, error: 'User is not banned' }, 409);

    await db.prepare('UPDATE user SET blocked = 0 WHERE id = ?').bind(userId).run();

    return json({ ok: true });
  } catch (err) {
    console.error('community unban POST error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

**Step 3: Commit**

```bash
git add functions/api/community/ban.js functions/api/community/unban.js
git commit -m "feat: add ban/unban API endpoints for admin+"
```

---

### Task 5: Ban/unban UI on members page

Add ban button on member cards for admins.

**Files:**
- Modify: `src/pages/community/members.astro`

**Step 1: Add ban button to member card rendering**

In the `renderMembers` function (around line 82), add a ban/unban button after the activity HTML, visible only to admins. The `currentUser` needs to be tracked -- add it to the init flow.

Add a `currentUserRole` variable in the script:

```js
      var currentUserRole = null;
```

Set it in the `init` function after `statusData`:

```js
          currentUserRole = statusData.role || 'member';
```

In the `renderMembers` function, after `activityHtml` and before `html += '<div class="member-card">'`, add:

```js
          var banHtml = '';
          if (currentUserRole && (currentUserRole === 'admin' || currentUserRole === 'superadmin') && !isStaff(m.role)) {
            banHtml = '<button class="btn btn--text btn--sm member-ban-btn" data-user-id="' + escapeHtml(m.id) + '" data-user-name="' + escapeHtml(m.name) + '">Ban</button>';
          }
```

Then include `banHtml` in the member card HTML, after `activityHtml`:

```js
          html += activityHtml;
          html += banHtml;
```

**Step 2: Add ban click handler**

Add a delegated click handler in the script:

```js
      document.addEventListener('click', function (e) {
        var banBtn = e.target.closest('.member-ban-btn');
        if (!banBtn) return;
        var userId = banBtn.getAttribute('data-user-id');
        var userName = banBtn.getAttribute('data-user-name');
        var deleteContent = confirm('Also remove all posts and comments by ' + userName + '?');
        if (!confirm('Ban ' + userName + '? This blocks their login immediately.')) return;
        banBtn.disabled = true;
        banBtn.textContent = 'Banning...';
        fetch('/api/community/ban', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: userId, deleteContent: deleteContent }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (data.ok) {
              banBtn.closest('.member-card').remove();
            } else {
              banBtn.disabled = false;
              banBtn.textContent = 'Ban';
              alert(data.error || 'Ban failed.');
            }
          })
          .catch(function () {
            banBtn.disabled = false;
            banBtn.textContent = 'Ban';
          });
      });
```

**Step 3: Add ban button CSS**

```css
    .member-ban-btn {
      color: var(--text-tertiary);
      font-size: 12px;
      margin-top: 4px;
    }
    .member-ban-btn:hover {
      color: var(--red-600, #dc2626);
    }
```

**Step 4: Commit**

```bash
git add src/pages/community/members.astro
git commit -m "feat: add ban button to members page for admins"
```

---

### Task 6: Comment editing API

Add PATCH handler to the existing comments endpoint.

**Files:**
- Modify: `functions/api/community/comments.js`

**Step 1: Add onRequestPatch to comments.js**

Add after the existing `onRequestDelete` function:

```js
// --- PATCH: edit comment ---

export async function onRequestPatch({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { commentId, content } = body;
    if (!commentId) return json({ ok: false, error: 'commentId required' }, 400);
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return json({ ok: false, error: 'Content required' }, 400);
    }
    if (content.length > 2000) {
      return json({ ok: false, error: 'Comment too long (max 2000 chars)' }, 400);
    }

    const db = env.DB;
    const comment = await db.prepare('SELECT * FROM community_comment WHERE id = ?').bind(commentId).first();
    if (!comment) return json({ ok: false, error: 'Comment not found' }, 404);

    // Only the author can edit their own comment
    if (comment.author_id !== user.id) {
      return json({ ok: false, error: 'Not authorized' }, 403);
    }

    await db.prepare(
      "UPDATE community_comment SET content = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(content.trim(), commentId).run();

    return json({ ok: true });
  } catch (err) {
    console.error('community comments PATCH error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

**Step 2: Update GET handler to return updated_at**

In the existing `onRequestGet` SELECT query (around line 33), add `c.updated_at` to the selected columns:

Change:
```sql
SELECT c.id, c.author_id, c.content, c.parent_id, c.created_at,
```
To:
```sql
SELECT c.id, c.author_id, c.content, c.parent_id, c.created_at, c.updated_at,
```

In the comment object mapping (around line 78-91), add `updatedAt`:

```js
        updatedAt: row.updated_at || null,
```

**Step 3: Commit**

```bash
git add functions/api/community/comments.js
git commit -m "feat: add comment editing API (author only, tracks updated_at)"
```

---

### Task 7: Comment editing UI

Add edit button and inline editing to comments on the post detail page.

**Files:**
- Modify: `src/pages/community/post/[...id].astro`

**Step 1: Update renderCommentHtml to include edit button and show (edited) label**

In the `renderCommentHtml` function, modify the comment-body line to include an edited indicator:

Change the comment-body line from:
```js
        html += '<div class="comment-body">' + escapeHtml(c.content) + '</div>';
```
To:
```js
        html += '<div class="comment-body">' + escapeHtml(c.content);
        if (c.updatedAt) html += ' <span class="comment-edited">(edited)</span>';
        html += '</div>';
```

In the comment-actions div, add an edit button for the comment author (before the flag button):

```js
        if (c.isOwn) {
          html += '<button class="btn btn--text btn--sm comment-edit-btn" data-comment-id="' + c.id + '">Edit</button>';
        }
```

**Step 2: Add delegated click handler for comment edit**

Add to the delegated click event listener section:

```js
      // Comment edit
      document.addEventListener('click', function (e) {
        var editBtn = e.target.closest('.comment-edit-btn');
        if (!editBtn) return;
        var cid = editBtn.getAttribute('data-comment-id');
        var comment = findComment(cid);
        if (!comment) return;

        var commentEl = document.querySelector('[data-comment-id="' + cid + '"]');
        var bodyEl = commentEl.querySelector('.comment-body');
        var actionsEl = commentEl.querySelector('.comment-actions');

        // Replace body with textarea
        var textarea = document.createElement('textarea');
        textarea.className = 'form-input form-textarea form-textarea--sm';
        textarea.rows = 3;
        textarea.maxLength = 2000;
        textarea.value = comment.content;

        var saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn--primary btn--sm';
        saveBtn.textContent = 'Save';

        var cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn--secondary btn--sm';
        cancelBtn.textContent = 'Cancel';

        var editActions = document.createElement('div');
        editActions.className = 'comment-edit-actions';
        editActions.appendChild(saveBtn);
        editActions.appendChild(cancelBtn);

        bodyEl.hidden = true;
        actionsEl.hidden = true;
        bodyEl.parentNode.insertBefore(textarea, bodyEl.nextSibling);
        bodyEl.parentNode.insertBefore(editActions, textarea.nextSibling);
        textarea.focus();

        cancelBtn.addEventListener('click', function () {
          textarea.remove();
          editActions.remove();
          bodyEl.hidden = false;
          actionsEl.hidden = false;
        });

        saveBtn.addEventListener('click', function () {
          var newContent = textarea.value.trim();
          if (!newContent) return;
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
          fetch('/api/community/comments', {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commentId: cid, content: newContent }),
          })
            .then(function (r) { return r.json(); })
            .then(function (data) {
              if (data.ok) {
                comment.content = newContent;
                comment.updatedAt = new Date().toISOString();
                textarea.remove();
                editActions.remove();
                bodyEl.hidden = false;
                actionsEl.hidden = false;
                renderComments();
              } else {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save';
                alert(data.error || 'Edit failed.');
              }
            })
            .catch(function () {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Save';
            });
        });
      });
```

**Step 3: Add CSS for edited label and edit actions**

```css
    .comment-edited {
      color: var(--text-tertiary);
      font-size: 11px;
      font-style: italic;
    }
    .comment-edit-actions {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
```

**Step 4: Commit**

```bash
git add src/pages/community/post/[...id].astro
git commit -m "feat: add inline comment editing with (edited) indicator"
```

---

### Task 8: Email notification on new post

Send email to all opted-in STUC members when a new post is created in the stuc channel, with a 15-minute batching window.

**Files:**
- Modify: `functions/api/community/posts.js`
- Create: `functions/api/community/_email.js` (shared email helpers)

**Step 1: Create _email.js helper**

```js
/**
 * Community email notification helpers.
 * Prefixed with _ so CF Pages doesn't treat it as a route handler.
 */
import { sendEmail } from '../_ses.js';
import { SITE_URL } from '../auth/_shared.js';

/**
 * Send "new post" email to all opted-in STUC members.
 * Checks KV for a 15-minute cooldown to batch rapid posts.
 */
export async function notifyNewPost(env, db, post, authorName) {
  // 15-minute batching: check KV cooldown
  if (env.KV) {
    const lastSent = await env.KV.get('community:last_post_email');
    if (lastSent) {
      const elapsed = Date.now() - parseInt(lastSent, 10);
      if (elapsed < 15 * 60 * 1000) return; // Skip, within cooldown
    }
  }

  // Get all STUC members who haven't opted out
  // STUC members: mod+ OR has grandfathered label OR has active subscription (approximated by stripe_customer_id)
  const members = await db.prepare(`
    SELECT DISTINCT u.email FROM user u
    WHERE u.blocked = 0
      AND u.community_email_opt_out = 0
      AND u.id != ?
      AND (
        u.role IN ('mod', 'admin', 'superadmin')
        OR u.id IN (SELECT user_id FROM user_label WHERE label = 'Save the Uterus Club \u{1F3F7}\u{FE0F}')
      )
  `).bind(post.authorId).all();

  if (!members.results.length) return;

  const link = `${SITE_URL}/community/post/${post.id}/`;
  const preview = post.body ? post.body.slice(0, 200) : '';

  const subject = `[Save the Uterus Club] New post: ${post.title}`;
  const html = `
    <p><strong>${authorName}</strong> posted in the Save the Uterus Club:</p>
    <h3>${post.title}</h3>
    ${preview ? `<p>${preview}${post.body && post.body.length > 200 ? '...' : ''}</p>` : ''}
    <p><a href="${link}">View post</a></p>
    <p style="font-size:12px;color:#888;">You're receiving this because you're a Save the Uterus Club member. <a href="${SITE_URL}/community/">Manage notifications</a></p>
  `;
  const text = `${authorName} posted: ${post.title}\n${preview}\nView: ${link}\n\nManage notifications: ${SITE_URL}/community/`;

  await sendEmail(env, {
    from: 'noreply@rrmacademy.org',
    to: members.results.map(m => m.email),
    subject,
    html,
    text,
  });

  // Set cooldown in KV
  if (env.KV) {
    await env.KV.put('community:last_post_email', String(Date.now()), { expirationTtl: 900 });
  }
}

/**
 * Send "reply" notification to the author of the parent post or comment.
 */
export async function notifyReply(env, db, postId, parentId, replierName, replyContent) {
  let recipientId = null;
  let targetLabel = 'post';

  if (parentId) {
    // Reply to a comment -- notify the comment author
    const parentComment = await db.prepare('SELECT author_id FROM community_comment WHERE id = ?').bind(parentId).first();
    if (parentComment) {
      recipientId = parentComment.author_id;
      targetLabel = 'comment';
    }
  } else {
    // Top-level comment -- notify the post author
    const post = await db.prepare('SELECT author_id FROM community_post WHERE id = ?').bind(postId).first();
    if (post) {
      recipientId = post.author_id;
      targetLabel = 'post';
    }
  }

  if (!recipientId) return;

  // Don't notify yourself
  const recipient = await db.prepare(
    'SELECT email, community_email_opt_out FROM user WHERE id = ? AND blocked = 0'
  ).bind(recipientId).first();

  if (!recipient || recipient.community_email_opt_out) return;

  const link = `${SITE_URL}/community/post/${postId}/`;
  const preview = replyContent.slice(0, 200);

  const subject = `[Save the Uterus Club] ${replierName} replied to your ${targetLabel}`;
  const html = `
    <p><strong>${replierName}</strong> replied to your ${targetLabel}:</p>
    <blockquote style="border-left:3px solid #ddd;padding-left:12px;color:#555;">${preview}${replyContent.length > 200 ? '...' : ''}</blockquote>
    <p><a href="${link}">View conversation</a></p>
    <p style="font-size:12px;color:#888;">You're receiving this because someone replied to your content. <a href="${SITE_URL}/community/">Manage notifications</a></p>
  `;
  const text = `${replierName} replied to your ${targetLabel}:\n"${preview}"\nView: ${link}\n\nManage notifications: ${SITE_URL}/community/`;

  await sendEmail(env, {
    from: 'noreply@rrmacademy.org',
    to: recipient.email,
    subject,
    html,
    text,
  });
}
```

**Step 2: Wire notifyNewPost into posts.js onRequestPost**

In `functions/api/community/posts.js`, add the import at the top:

```js
import { notifyNewPost } from './_email.js';
```

After the successful INSERT (around line 234), before the return, add:

```js
    // Send email notification (fire-and-forget)
    try {
      await notifyNewPost(env, db, {
        id, title: title.trim(), body: postBody?.trim() || null, authorId: user.id,
      }, displayName(user));
    } catch (err) {
      console.error('Failed to send new post notification:', err.message);
    }
```

**Step 3: Wire notifyReply into comments.js onRequestPost**

In `functions/api/community/comments.js`, add the import at the top:

```js
import { notifyReply } from './_email.js';
```

After the successful INSERT (around line 156), before the return, add:

```js
    // Send reply notification (fire-and-forget)
    try {
      await notifyReply(env, db, postId, parentId || null, displayName(user), content.trim());
    } catch (err) {
      console.error('Failed to send reply notification:', err.message);
    }
```

**Step 4: Commit**

```bash
git add functions/api/community/_email.js functions/api/community/posts.js functions/api/community/comments.js
git commit -m "feat: add email notifications for new posts and replies"
```

---

### Task 9: Email opt-out API and UI

Add opt-out toggle endpoint and UI in the community feed.

**Files:**
- Create: `functions/api/community/notifications.js`
- Modify: `src/pages/community/index.astro`
- Modify: `functions/api/community/status.js`

**Step 1: Create notifications.js**

```js
/**
 * PATCH /api/community/notifications -- toggle email opt-out
 */
import { json, optionsResponse } from '../auth/_shared.js';
import { requireMember } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestPatch({ request, env }) {
  try {
    const auth = await requireMember(request, env);
    if (auth instanceof Response) return auth;
    const { user } = auth;

    let body;
    try { body = await request.json(); } catch {
      return json({ ok: false, error: 'Invalid JSON' }, 400);
    }

    const { emailOptOut } = body;
    if (typeof emailOptOut !== 'boolean') {
      return json({ ok: false, error: 'emailOptOut must be boolean' }, 400);
    }

    const db = env.DB;
    await db.prepare('UPDATE user SET community_email_opt_out = ? WHERE id = ?')
      .bind(emailOptOut ? 1 : 0, user.id).run();

    return json({ ok: true, emailOptOut });
  } catch (err) {
    console.error('community notifications PATCH error:', err.message, err.stack);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}
```

**Step 2: Update status.js to return emailOptOut**

In `functions/api/community/status.js`, read the `community_email_opt_out` column from the user query and include it in the response. Find the user SELECT query and add `community_email_opt_out` to the selected fields. In the response JSON, add:

```js
emailOptOut: !!user.community_email_opt_out,
```

**Step 3: Add opt-out toggle to community feed header**

In `src/pages/community/index.astro`, find the feed header area (the section shown to members). Add a notification toggle:

```html
        <div class="notification-toggle" id="notification-toggle" hidden>
          <label class="toggle-label">
            <input type="checkbox" id="email-toggle" checked />
            <span>Email notifications</span>
          </label>
        </div>
```

Add the JS handler:

```js
      var notifToggle = document.getElementById('notification-toggle');
      var emailToggle = document.getElementById('email-toggle');

      // Show toggle after status loads (set initial state from status response)
      function initNotificationToggle(emailOptOut) {
        emailToggle.checked = !emailOptOut;
        notifToggle.hidden = false;
      }

      emailToggle.addEventListener('change', function () {
        var optOut = !emailToggle.checked;
        fetch('/api/community/notifications', {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailOptOut: optOut }),
        })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            if (!data.ok) {
              emailToggle.checked = !emailToggle.checked; // Revert
            }
          })
          .catch(function () {
            emailToggle.checked = !emailToggle.checked; // Revert
          });
      });
```

Call `initNotificationToggle(statusData.emailOptOut)` in the init function after confirming member access.

**Step 4: Add CSS**

```css
    .notification-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .toggle-label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
    }
```

**Step 5: Commit**

```bash
git add functions/api/community/notifications.js functions/api/community/status.js src/pages/community/index.astro
git commit -m "feat: add email notification opt-out toggle"
```

---

### Task 10: Deploy and verify

Deploy all changes to production and verify each feature works.

**Files:** None (deployment only)

**Step 1: Deploy**

```bash
cd ~/iCode/projects/rrm-academy-cf
npm run build && npx wrangler pages deploy dist --project-name rrm-academy
```

**Step 2: Verify flag API**

```bash
# Should return 401 (not authenticated)
curl -s https://rrmacademy.org/api/community/flags | head -c 100
```

**Step 3: Verify ban API**

```bash
# Should return 401
curl -s -X POST https://rrmacademy.org/api/community/ban | head -c 100
```

**Step 4: Verify notifications API**

```bash
# Should return 401
curl -s -X PATCH https://rrmacademy.org/api/community/notifications | head -c 100
```

**Step 5: Commit any remaining changes and push**

```bash
git push
```

---

## Summary

| Task | Feature | Files |
|------|---------|-------|
| 1 | Schema migrations | `schema.sql` + D1 commands |
| 2 | Flagging API | `flags.js`, `_shared.js` |
| 3 | Flagging UI | `post/[...id].astro` |
| 4 | Banning API | `ban.js`, `unban.js` |
| 5 | Banning UI | `members.astro` |
| 6 | Comment edit API | `comments.js` |
| 7 | Comment edit UI | `post/[...id].astro` |
| 8 | Email notifications | `_email.js`, `posts.js`, `comments.js` |
| 9 | Email opt-out | `notifications.js`, `status.js`, `index.astro` |
| 10 | Deploy and verify | Deployment only |
