# v4.3.0 - Edição Leads (Construbom)

Tag: `v4.3.0` at `c0d61d0`
Cut: 2026-10-05
Flow: `/nexo-ship-prod-ready` (Gate 3 approved by the owner in chat as one approval for cut, staging and production)
Chain: `master == staging == production == c0d61d0`
Release-verify: PASS at `1ff1c83`; `c0d61d0` differs only in `nexo/state.json` and the release-verify result file.

## Accomplishments

- Sales becomes a configurable core: a product edition is resolved per request from the Hub module `sales.edition.leads` (run `20261005T221616Z-edicao-leads`, 11 slices, mutation 22/22).
- Organizations without the module (FXL) resolve to `full` and behave exactly as before, pinned by literal navigation and route-gate oracles.
- The leads edition is a Kanban only: gestor sees Prospecção, Vendedores and Etapas; vendedor sees Minha prospecção; leads carry Nome, Data de aniversário, Número, Email, Descrição and Vendedor; the board starts with no etapa; every proposta, comissão, baixa, catálogo and importação route answers `403 edition_capability`.
- Migration `0027_lead_contact_fields` adds three nullable columns to `sales_ops_leads` and runs at API container start.
- Test isolation fix: the dev seed no longer breaks the Finance integration tests.

## Key decisions

- Activation is a Hub module read from `entitlements.modules`; the free grant is done by SQL in the Hub (playbook `nexo/playbooks/ativar-edicao-leads.md`) until the Hub has an audited admin action.
- Fail-open accepted: if the module disappears, the org sees the full product; persisting the edition per org is on the ROADMAP.
- Audit at release: production dependencies 0 high/critical; new dev-only advisories (2 critical in `tinypool` via vitest) to be handled by a dependency refresh.

References: `nexo/milestones/v4.3.0/RELEASE-NOTES.md`, `nexo/knowledge/decisions/2026-10-05-sales-editions-from-hub-module.md`, `CLAUDE.md` `## Edição Leads`.
