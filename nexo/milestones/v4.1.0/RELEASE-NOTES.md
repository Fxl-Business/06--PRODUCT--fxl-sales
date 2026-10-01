# FXL Sales v4.1.0 - release notes

**Previous release:** v4.0.0 (`a1be9d6`), the commit staging and production both run today.
**Range:** `v4.0.0..v4.1.0`, 241 commits (177 excluding merges, counted at the release commit), none of them pushed before this cut.

## What ships

This release carries every run merged to `master` since v4.0.0, not only the last two.

- **Sales-Finance control plane** (run `20260928T220106Z-sales-finance-control-plane`).
  Sales becomes a producer and a consumer through the Hub control plane, with an outbox, a cursor feed and a puller.
  Nothing is emitted for an Organization until an Integration Activation is live for it in the Hub.
- **hub-sdk 2.5.0: Trocar conta and real seller invitations** (run `20260928T184208Z-hub-sdk-25-switch-account-invites`).
  "Trocar conta" appears in the account menu, on the 402 panel and on `/no-role`.
  Creating a seller now sends a real Hub invitation, and the admin page can send, resend and revoke it.
- **Baixas, estornos and proposta editing** (runs `20260924T013019Z-finance-prereqs` and `20260925T191541Z-finance-prereqs-07-10`).
- **Kanban de leads** (run `20260918T000000Z-kanban-pipeline-leads`).
- **Development tooling:** the development identity mode (`make dev-fake`), dev servers bound to localhost only, the `make run` selector, and the local database guard.

## Migrations

Five migrations are pending in staging and in production: `0022`, `0023`, `0024`, `0025` and `0026`.

| Migration | What it does | Data touched |
| --- | --- | --- |
| `0022_sales_ops_leads` | Creates the three lead tables with FORCE RLS. | Seeds the default four-stage pipeline for every existing org. |
| `0023_lead_seller_identity` | Adds the account column that links a Hub token to a pessoa. | None. |
| `0024_sales_ops_settlements` | Creates `sales_ops_settlements` (immutable baixa/estorno facts, with a trigger that refuses UPDATE and DELETE), adds `revision`/`updated_at` to receivables and payables, and `removed_at` to sale items and professionals. | Writes one synthetic baixa for every row already marked paid (`actor_name = 'Migração'`). |
| `0025_integration_transport` | Creates the four integration transport tables (outbox, publisher high-water, inbox, cursor) with RLS. | Inserts the single publisher high-water bookkeeping row. |
| `0026_seller_invitation_state` | Adds three nullable text columns to `sellers`. | None. |

**How the migrations run.**
`apps/api/Dockerfile` runs `node dist/db/migrate.js && exec node dist/server.js`.
The migrations therefore apply when the container starts, and the API only begins serving after they succeed, because of the `&&`.
The owner chose on 2026-10-01 to keep this behaviour for v4.1.0.
This is NOT a separate pre-deploy step: a Coolify pre-deploy command would only be a second, redundant run, which the runner tolerates because it journals each migration and skips the ones already applied.
If a migration fails, the container exits before serving, and the previous container stays up only if the platform keeps it during a failed rollout.
The runner bounds its own lock waits and retries on lock contention (ADR `2026-09-25-migrations-yield-locks-to-live-traffic`), so `0024` does not deadlock live traffic.

## Operator checklist

Per platform: the API runs on Coolify (staging) and on the production host; the web runs on Vercel.

API (staging and production):
- [ ] `FXL_HUB_TRUSTED_ORIGINS` is set explicitly to the web origin. Empty means every BFF POST answers `403 origin_not_trusted`.
- [ ] `FXL_HUB_REDIRECT_URI` is set explicitly to the web origin's `/auth/callback`. Its default lands on the Hub's own origin, and the boot refuses that origin.
- [ ] The variables renamed in v4.0.0 carry their VALUES, created alongside and not renamed in place: `SALES_SESSION_ENCRYPTION_IKM` (byte-for-byte the old `HUB_SESSION_ENCRYPTION_KEY` if that was non-blank, or every user is silently logged out), `SALES_POST_LOGIN_REDIRECT` and `SALES_POST_LOGIN_ERROR_REDIRECT`.
- [ ] `FXL_HUB_HEALTH_TOKEN` is set (required outside development).
- [ ] No new variable is REQUIRED in staging or production. v4.1.0 does add four development-only names, which must stay UNSET there: `SALES_AUTH_FAKE` and `VITE_AUTH_FAKE` (the boot refuses `SALES_AUTH_FAKE` under `NODE_ENV=production`), `SALES_ENV_FILE` (set only by `make back-stg`) and `SALES_LISTEN_HOST` (dev servers bind to localhost).

Web (Vercel, the `production` branch):
- [ ] `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_ENVIRONMENT` and `VITE_FXL_HUB_AUDIENCE` are set. They are validated at render, so a missing one builds green and then white-screens every user.

Hub:
- [ ] `API_PUBLIC_URL` is set on the Hub's `apps/auth` service in each environment. Without it every seller invitation fails with `discovery_missing_api_url`; the seller is still saved and the admin sees an operator message.

## The Sales-Finance contract only emits after Hub setup

`isProducerFlowLive(orgId)` is false for every Organization until the Hub has, per environment:
1. the Event Types,
2. the Integration Contract,
3. the Sales `application_endpoint`,
4. one Integration Activation per Organization.

Until then Sales emits nothing and behaves exactly as before for that Organization.

## Not exercised by any test

- The ticket and introspection handshake against a real Hub and a real Finance app. The in-repo end-to-end test uses the fake authority and a simulated Finance feed.
- A real invitation email from the Hub, and `switchAccount` against the real `/authorize`.

## Rollback

The code is revertable, but the migrations are forward-only, and v4.0.0 does NOT safely run on a database that `0024` has migrated:
- v4.0.0 does not filter `removed_at`, so sale items and professionals removed by a v4.1.0 edit reappear.
- v4.0.0 edits a proposta by deleting and recreating its rows, which the settlements foreign keys (`ON DELETE RESTRICT`) refuse for any proposta that ever had a baixa.

So a problem after `0024` has run is fixed FORWARD with `/nexo-hotfix`, never by redeploying v4.0.0.
Do not drop the new tables or columns by hand.
