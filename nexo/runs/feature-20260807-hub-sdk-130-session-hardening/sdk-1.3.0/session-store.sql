-- Schema for @fxl-business/hub-sdk `SqlHubSessionStore`.
--
-- These two tables hold the server side of a product's Hub BFF session. The browser
-- only ever holds the opaque `id` in an HttpOnly cookie; the Hub refresh token and the
-- PKCE verifier live here, sealed with AES-256-GCM under a key the application
-- supplies. The database never sees either in plaintext.
--
-- Apply this with whatever migration tool the consuming app already uses. The SDK does
-- not run migrations and does not bundle a database driver.

-- ── sessions ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub_bff_session (
  -- Opaque, unguessable id (two concatenated v4 UUIDs, hyphens stripped). This is the
  -- value the browser cookie carries, so it must never be sequential or derivable.
  id                  text        PRIMARY KEY,

  -- The AES-256-GCM envelope: {"iv","tag","ct"}, all base64. Holds the serialized
  -- HubSessionRecord, including the Hub refresh token. Never queried on, only read
  -- whole, so no index and no functional dependency on its contents.
  payload             text        NOT NULL,

  -- Sliding and hard expiry. Kept as real columns rather than only inside `payload`
  -- so a sweeper can delete expired rows without decrypting anything.
  expires_at          timestamptz,
  absolute_expires_at timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Supports the expiry sweep below. The store itself always reads by primary key.
CREATE INDEX IF NOT EXISTS hub_bff_session_expires_at_idx
  ON hub_bff_session (expires_at);

-- ── login transactions ──────────────────────────────────────────────────────────
-- The short-lived bridge between GET /auth/login and GET /auth/callback. Holds the
-- PKCE code verifier and the CSRF state. Single-use: the store deletes the row on
-- consume, expired or not, so a replayed callback cannot retry a stale verifier.
CREATE TABLE IF NOT EXISTS hub_bff_login_transaction (
  id                  text        PRIMARY KEY,
  payload             text        NOT NULL,
  expires_at          timestamptz,
  -- Unused for login transactions; present so both tables share one row shape and the
  -- store can issue identical SQL against either.
  absolute_expires_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hub_bff_login_transaction_expires_at_idx
  ON hub_bff_login_transaction (expires_at);

-- ── access control ──────────────────────────────────────────────────────────────
-- These tables are SERVICE-CONTEXT ONLY. They are not tenant data: there is no org_id
-- and no per-user read path, because a row is only ever fetched by an id that the
-- requester already proved possession of via the session cookie.
--
-- If the application connects as a role that is not the table owner, enable RLS with
-- no permissive policy so only explicitly-granted service roles reach these rows.
-- Uncomment and adapt:
--
--   ALTER TABLE hub_bff_session              ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE hub_bff_session              FORCE  ROW LEVEL SECURITY;
--   ALTER TABLE hub_bff_login_transaction    ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE hub_bff_login_transaction    FORCE  ROW LEVEL SECURITY;
--
--   GRANT SELECT, INSERT, UPDATE, DELETE ON hub_bff_session           TO <app_role>;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON hub_bff_login_transaction TO <app_role>;
--
-- FORCE matters: without it, the table owner bypasses RLS entirely, which is usually
-- the very role the application connects as.

-- ── connection pool sizing (READ THIS) ──────────────────────────────────────────
-- The BFF calls the Hub over HTTP from INSIDE the transaction that holds a session's
-- row lock. That is deliberate: it serializes concurrent refreshes so a rotated
-- refresh token cannot be lost. The consequence is that a transaction, a row lock,
-- and a POOLED CONNECTION are held across a network round-trip, bounded by the BFF's
-- `timeoutMs` (default 10s).
--
-- The failure mode arrives exactly when you least want it: a slow or degraded Hub
-- makes refreshes pile up, each pinning a connection for up to 10 seconds, until the
-- pool is exhausted and every query in the application stalls, not just auth.
--
--   * Size the pool for peak concurrent REFRESHES, not peak concurrent requests.
--   * Lower the BFF `timeoutMs` if the Hub is nearby; 10s is a conservative ceiling.
--   * Set a reaper so a wedged transaction cannot block VACUUM forever:
--
--       ALTER ROLE <app_role> SET idle_in_transaction_session_timeout = '30s';
--
--   * If you already run PgBouncer, use SESSION mode. Transaction mode is fine too,
--     but statement mode will break `FOR UPDATE` semantics.

-- ── key rotation ────────────────────────────────────────────────────────────────
-- `payload` is sealed with a key the application holds, and the store throws rather
-- than returning null when a row will not authenticate. So changing the key without
-- clearing these tables produces errors for every logged-in user, not a graceful
-- mass re-login. Rotate by truncating both tables in the same deploy that introduces
-- the new key:
--
--   TRUNCATE hub_bff_session, hub_bff_login_transaction;
--
-- Everyone is logged out once. That is the same cost as any session-store change.

-- ── expiry sweep ────────────────────────────────────────────────────────────────
-- The store treats an expired row as absent and deletes it on access, so correctness
-- does not depend on this. It only stops dead rows accumulating. Schedule it however
-- the app schedules other periodic work (pg_cron, a worker, a container cron):
--
--   DELETE FROM hub_bff_session
--    WHERE (expires_at          IS NOT NULL AND expires_at          < now())
--       OR (absolute_expires_at IS NOT NULL AND absolute_expires_at < now());
--
--   DELETE FROM hub_bff_login_transaction
--    WHERE expires_at IS NOT NULL AND expires_at < now();
