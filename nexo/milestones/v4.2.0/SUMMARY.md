# v4.2.0 - importação por planilha e redesign da Prospecção

Tag: `v4.2.0` at `24c75f6`
Cut: 2026-10-02
Flow: `/nexo-ship-prod-ready` (Gate 3 approved by the owner in chat as one approval for cut, staging and production)
Chain: `master == staging == production == 24c75f6`
Promotion: staging and production moved from v4.0.0 (`a1be9d6`) straight to v4.2.0, so this push also delivered v4.1.0 for the first time (migrations `0022`-`0026` run at API container start).

## Accomplishments

- Importação por planilha: admin screen Cadastros > Importação, one `.xlsx` template generated from a single column definition, read-only preview with per-row errors, create-only all-or-nothing commit through the existing domain services, from the basic depth to won propostas with payment history (run `20261002T124500Z-importacao-planilha`, 11 slices, mutation 45/50 then the 5 survivors pinned).
- Redesign da Prospecção: per-stage totals and share bars, stage colours, day-in-stage tiers, Quadro/Lista toggle, compact click-to-edit card (run `20261002T122805Z-prospeccao-redesign`, 4 slices).
- Fresh orgs: the import seeds the default etapas and the Vendedor/Finder funções inside its transaction (D11/D11b); the app-wide gap is an open question in the import run's AUDIT.

## Key decisions

- A connected Finance org refuses imported Ganha propostas and payments (`producer_flow_live`), so history is never emitted as new facts.
- `exceljs@4.4.0` pinned exactly; `brace-expansion` override raised to `1.1.21` (0 high advisories).
- Release-verify built the real artifacts: the API Docker image from a clean `git archive` (with `exceljs` resolvable inside) and the web exactly as `vercel.json` builds it.

References: `nexo/milestones/v4.2.0/RELEASE-NOTES.md`, `nexo/knowledge/reference/importacao-por-planilha.md`, `nexo/knowledge/reference/kanban-de-leads.md`.
