-- Migration 024: Hot-path indexes flagged by 2026-05-27 /arise D1 audit sweep
-- Database: rrm-auth (community_post, community_comment, enrollment)
--
-- Each WHERE-on-column-with-no-index identified by the sweep:
--
-- 1. enrollment.stripe_payment_intent
--    Used by functions/api/billing/_webhook-refund.js:24 on every Stripe
--    charge.refunded webhook. Full-table scan today; partial index keeps
--    storage cheap because only paid enrollments carry a payment_intent.
--
-- 2. community_post.slug
--    Used by functions/api/community/posts.js:371,376 on every post-create
--    slug-uniqueness + collision-suffix check. COLLATE NOCASE per the
--    site-wide SQL discipline rule.
--
-- 3. community_post.author_id
--    Used by community/ban.js (5 sub-queries during user-ban cascade),
--    community/members.js (per-row last-activity correlated subquery),
--    community/_shared.js (profile lookups). Currently full-scan on every
--    member-list render.
--
-- 4. community_comment.author_id
--    Used by community/ban.js (4 sub-queries) and members.js (last-activity).
--    Same shape as community_post.author_id; same fix.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS is a no-op if the index already
-- exists. Safe to re-run.

CREATE INDEX IF NOT EXISTS idx_enrollment_stripe_pi
  ON enrollment(stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_community_post_slug
  ON community_post(slug COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_community_post_author
  ON community_post(author_id);

CREATE INDEX IF NOT EXISTS idx_community_comment_author
  ON community_comment(author_id);
