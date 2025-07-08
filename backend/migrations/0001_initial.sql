-- Minimal schema for SpeakMCP authentication
-- Cloudflare D1 (SQLite) database

-- Users table - minimal user data
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- Google OAuth sub claim
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Usage tracking - simple monthly quotas
CREATE TABLE usage (
  user_id TEXT REFERENCES users(id),
  month TEXT,                    -- YYYY-MM format
  stt_seconds INTEGER DEFAULT 0,
  chat_tokens INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

-- Create indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_usage_month ON usage(month);
