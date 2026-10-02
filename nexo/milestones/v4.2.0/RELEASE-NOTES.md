# FXL Sales v4.2.0 - release notes

**Release commit:** `24c75f6` on `master`, tagged `v4.2.0`.
**Previous release tag:** v4.1.0 (`42ea895`), tagged on 2026-10-01 and never promoted.
**What staging and production ran before this cut:** v4.0.0 (`a1be9d6`).
This promotion therefore carries everything in v4.1.0 AND v4.2.0 to staging and production at once.

Gate 3 was approved by the owner in chat on 2026-10-02 as a single approval for the cut, staging and production, with no staging validation pause (flow `ship-prod-ready`).

## What ships in v4.2.0

- **Importação por planilha** (run `20261002T124500Z-importacao-planilha`).
  A new admin screen, Cadastros > Importação, downloads an `.xlsx` template (blank or with an example) with one tab per cadastro plus Leads, Propostas and their child tabs.
  Upload runs a read-only preview with every error by tab, row and column; `Importar` then writes everything in one all-or-nothing transaction.
  The import is create-only, goes from the basic depth (cliente, vendedor, produto) to the full one (itens, profissionais, parcelas, recorrência, won day, payments as baixas), and refuses Ganha propostas and payments for an org connected to Finance.
  Reference: `nexo/knowledge/reference/importacao-por-planilha.md`.
- **Redesign da Prospecção** (run `20261002T122805Z-prospeccao-redesign`).
  The leads board gets per-stage totals and share bars, stage colours, day-in-stage tiers, a Quadro/Lista toggle with phase chips and totals, and a compact card that opens on click and moves on drag.

## What ships from v4.1.0 (first time in staging and production)

See `nexo/milestones/v4.1.0/RELEASE-NOTES.md`: the Sales-Finance control plane, hub-sdk 2.5.0 (Trocar conta and real seller invitations), baixas/estornos/proposta editing, the Kanban de leads, and the development tooling.

## Migrations

v4.2.0 adds NO migration.
The five v4.1.0 migrations `0022`-`0026` are still pending in staging and production and run at API container start (`node dist/db/migrate.js && exec node dist/server.js`).
They are forward-only: after `0024` has run, v4.0.0 must not be redeployed; fix forward with `/nexo-hotfix`.

## Configuration

v4.2.0 adds NO environment variable.
The v4.1.0 operator checklist still applies and was NOT verified by the agent (it has no access to the platforms):

API (staging and production):
- [ ] `FXL_HUB_TRUSTED_ORIGINS` set to the web origin.
- [ ] `FXL_HUB_REDIRECT_URI` set to the web origin's `/auth/callback` (the boot refuses the default).
- [ ] `SALES_SESSION_ENCRYPTION_IKM`, `SALES_POST_LOGIN_REDIRECT`, `SALES_POST_LOGIN_ERROR_REDIRECT` carry their values.
- [ ] `FXL_HUB_HEALTH_TOKEN` set.
- [ ] `SALES_AUTH_FAKE`, `VITE_AUTH_FAKE`, `SALES_ENV_FILE`, `SALES_LISTEN_HOST` UNSET.

Web (Vercel, `production` branch):
- [ ] `VITE_FXL_HUB_API_URL`, `VITE_FXL_HUB_ENVIRONMENT`, `VITE_FXL_HUB_AUDIENCE` set.

Hub:
- [ ] `API_PUBLIC_URL` set on `apps/auth` (seller invitations).

## New dependency

`exceljs@4.4.0` (API only, pinned exactly), with the `brace-expansion` override raised to `1.1.21`.
One moderate advisory remains through `exceljs > uuid`; no high or critical advisory.

## Post-deploy checks

- [ ] The API container on staging and production logs the five migrations applied and then the boot line.
- [ ] Sign in on production, open Cadastros > Importação, download the blank template.
- [ ] Open Operacional > Prospecção and check the new board.
