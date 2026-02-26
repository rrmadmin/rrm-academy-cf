-- Member migration: labels, OAuth columns, community channels
-- Applied to D1 database: rrm-auth
-- Run: wrangler d1 execute rrm-auth --remote --file=migrations/003-member-migration.sql

-- Labels system (informational metadata, not access control)
CREATE TABLE IF NOT EXISTS user_label (
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(user_id, label)
);
CREATE INDEX IF NOT EXISTS idx_user_label_label ON user_label(label);

-- User table additions for OAuth and migration tracking
ALTER TABLE user ADD COLUMN google_id TEXT;
ALTER TABLE user ADD COLUMN wix_member_id TEXT;
ALTER TABLE user ADD COLUMN blocked INTEGER DEFAULT 0;

-- Community channels (stuc=active, members/masterclass=admin archives)
ALTER TABLE community_post ADD COLUMN channel TEXT NOT NULL DEFAULT 'stuc';
CREATE INDEX IF NOT EXISTS idx_community_post_channel ON community_post(channel, created_at);
