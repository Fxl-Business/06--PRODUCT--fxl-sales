# Leads are deleted into a restorable trash, and board totals come from the server

**Date:** 2026-10-07
**Surfaced by:** run `20261007T203517Z-lead-lixeira`

## Context

The gestor and the vendedores of the Construbom needed to delete a lead from the card and from the form, with a log of who deleted what.
The system archives and never hard deletes, and `salesOpsRouter` has no DELETE verb.
After importing 114 leads the column also read `100`, because every total on the board was computed from the loaded cards and the board loads 100 per column page.

## Decision

A lead is soft deleted by `POST /leads/:id/delete`, which sets `deleted_at`, `deleted_by_user_id` and `deleted_by_name`.
Every lead read and write filters `liveLeadCondition()`, and the delete takes `lockLeadBoard` and renumbers the column.
A vendedor deletes what he can read (own leads and the pool), the gestor deletes any lead, and a converted lead cannot be deleted.
`lead.deleted` and `lead.restored` are written to `audit_log` in the same transaction by `lead-trash-service.ts`.
Restore and the trash list are `requireAdmin` and live in `Cadastros > Leads excluídos`.
The `...` menu on the card, the Lista row and the edit forms open one `LeadDeleteDialog`.
Column badge, totals, Lista chips and both Funil shapes read `GET /leads/summary`, taking per stage the maximum of the summary and the loaded cards.
`apiFetch` accepts a `204` with no body.

## Consequences

- Migration `0028_lead_soft_delete` runs at API container start; the production API must be on this release for the trash to work.
- A deleted lead is invisible everywhere except the trash, including to an admin's get and PATCH.
- Every future lead query must filter `liveLeadCondition()`.
- A vendedor cannot undo his own mistake; he asks the gestor, who restores.
- The board shows 115 in a column of 115 and `Carregar mais leads (100 de 115)`.
- The finder link revoke no longer fails in the browser after succeeding on the server.

## Alternatives considered

- A hard delete: loses the lead and its log context, against the archive-never-delete rule.
- A `DELETE` verb: the router has none and must not gain one.
- A `status` value: leads have no status column, and an extra etapa would move the card instead of removing it.
- Letting the vendedor restore: a deleted lead leaves his scope, and restore is an administrative decision.
- Audit writes inside `lead-service.ts`: breaks its no-audit contract test.
- Raising the page size or counting loaded cards: moves the bug to the next import.
