CREATE TABLE pdf_token (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token      TEXT    NOT NULL UNIQUE,
  email      TEXT    NOT NULL,
  guide_slug TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_pdf_token_token ON pdf_token(token);
CREATE INDEX idx_pdf_token_email_slug ON pdf_token(email, guide_slug);
