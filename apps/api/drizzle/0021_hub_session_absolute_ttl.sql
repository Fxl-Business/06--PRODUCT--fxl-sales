-- Absolute session lifetime for the Hub BFF session store.
--
-- expires_at is SLIDING: hub-session-store.ts rewrites it to now + SESSION_TTL_MS
-- (30 days) on every refresh-token rotation. An idle session dies; an ACTIVE one
-- never did, so a stolen session id that the attacker keeps refreshing stayed valid
-- forever. absolute_expires_at is the hard ceiling: written ONCE at session create
-- and never moved by a rotation.
--
-- Backfill: created_at + 90 days, the same window a session created after this
-- migration gets. created_at is the row's only creation anchor and it is NOT NULL
-- with a now() default since 0016, so it is exact rather than approximate.
--
-- This backfill logs NOBODY out. hub_bff_sessions was created by
-- 0016_hub_bff_session_store on 2026-08-03, so on the day this ships no row can be
-- more than a few days old and no backfilled value can already be in the past.
-- That safety argument HAS A SHELF LIFE: it holds only while the oldest row is under
-- 90 days old. If this migration sits unshipped past 2026-11-01, any row older than
-- 90 days would be backfilled into the past and die on its next access. Re-check
-- before shipping if this is delayed.
-- The two alternatives were both rejected: leaving the column NULL on existing rows
-- makes every currently-live session immortal forever, which is the exact defect
-- this migration exists to close; anchoring on now() instead of created_at grants
-- every existing session a fresh full window and quietly rewards the session that
-- has been alive longest.
--
-- NOT NULL, deliberately, and with NO column default. The SDK's bundled DDL leaves
-- both expiry columns nullable because its store treats a missing value as "no
-- expiry" - which is precisely the state that must be unrepresentable here. With no
-- default, an INSERT that forgets the column fails loudly instead of silently
-- minting an uncapped session, and Drizzle's inferred insert type makes the omission
-- a compile error.
--
-- hub_bff_sessions is FORCE ROW LEVEL SECURITY with only the app.fxl_admin policy,
-- so in a deployment whose migration role is the table owner rather than a
-- superuser the UPDATE below would match ZERO rows without an admin session
-- context. Same reason and same shape as the backfill in 0020 and the system-função
-- seed in 0012. If it were ever dropped the SET NOT NULL that follows would fail on
-- the remaining NULLs, so the failure mode is loud, not silent.
--
-- Down path: ALTER TABLE hub_bff_sessions DROP COLUMN absolute_expires_at, and drop
-- the index. No data is lost that is not derivable from created_at.

ALTER TABLE "hub_bff_sessions" ADD COLUMN "absolute_expires_at" timestamp with time zone;--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "hub_bff_sessions" SET "absolute_expires_at" = "created_at" + interval '90 days' WHERE "absolute_expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "hub_bff_sessions" ALTER COLUMN "absolute_expires_at" SET NOT NULL;--> statement-breakpoint
-- The nightly sweep deletes on `expires_at <= now OR absolute_expires_at <= now`.
-- A row can be past the absolute ceiling while its sliding expiry is still 29 days
-- in the future - that is the whole point of the column - so the OR branch is
-- genuinely reachable and the existing hub_bff_sessions_expires_at_idx does not
-- serve it.
CREATE INDEX "hub_bff_sessions_absolute_expires_at_idx" ON "hub_bff_sessions" USING btree ("absolute_expires_at");
