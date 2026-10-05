---
feature: edicao-leads
milestone: v4.3.0
run: 20261005T221616Z-edicao-leads
---

# Feature: Edição Leads (Construbom)

## WHAT / WHY (Frame)

Request, verbatim from the human (pt-BR):
"O sales precisa ser o CORE, ter uma base Sólida porém configurável. [...] para a FXL (que é a empresa que hoje usa o sistema) não vai mudar NADA, não quero quebrar nada.
Mas vamos precisar implementar uma versão extremamente simples para a "Construbom" [...] imagino eu direto pelo Hub na hora de dar acesso ao sistema.
[...] o vendedor vai ter o Kanban que temos hoje, mas os campos vão ser até menos que o normal, apenas: "Nome - Data de Aniversário - Número - Descrição - Email - Vendedor".
E ai ele vai usar o Kanban, e nem vai ter a parte de "Proposta" nem nenhuma das etapas "pre-definidas" que já existem, apenas as configuráveis."

Decisions the human approved in the brainstorm (Gate 1 is then skipped by explicit autopilot, "Siga em autopilot"):

1. FXL changes NOTHING. An org whose token carries no edition module resolves to edition `full`, which is byte-for-byte today's behavior, proven by oracle tests.
2. Activation is a Hub module in `entitlements.modules`: `sales.edition.leads`. Sales only READS it. The grant itself is done tomorrow by a R$ 0 SKU plus SQL in the Hub (a playbook is written here); an audited Hub "grant module" admin action goes on the Hub roadmap.
3. Approach A: one pure resolver `resolveSalesEdition(modules)` plus `editionCapabilities(edition)` in `packages/shared-utils`; the API resolves it once per request in `applyHubAuthContext` and guards whole route groups with `requireCapability`; the web reads the same token and filters navigation.
4. Users: the gestor (Hub workspace owner/admin, so app role `admin`) sees Operacional > Prospecção, Cadastros > Pessoas and Cadastros > Etapas do funil. A vendedor (product role `seller`) sees only Meus dados > Minha prospecção. Seller scoping is unchanged.
5. Etapas: in the leads edition the board starts EMPTY. No system etapa exists (no Proposta, no Perdido); the gestor creates every column.
6. Lead fields in the leads edition: Nome (required), Data de aniversário, Número (telefone/WhatsApp, free text), Descrição, Email, Vendedor. All optional except Nome. No empresa, produtos or valor. The new fields are additive nullable columns on `sales_ops_leads`.

The authoritative interface for every shared name is `SEAM-CONTRACT.md` in this folder.

## HOW decisions taken by the orchestrator (recorded for the Report)

- D1. Unknown or absent modules resolve to `full`. The edition is DERIVED per request from the verified token; it is never stored in the Sales database and never read from a body.
- D2. Fail-open direction is accepted and documented: if the Hub stops sending the module, the org sees the full product. Data stays valid either way because the leads edition only ever writes lead rows, pessoas and etapas.
- D3. The full-edition lead write schema stays byte-identical (it still rejects the new keys via `.strict()`); the new contact fields are accepted only by the leads-edition schema. Lead READ projections gain the three new keys (null for FXL), which is additive.
- D4. In the leads edition a Pessoa is always a vendedor: the server assigns the system `vendedor` função itself (seeding the system funções inside the same transaction when the org has none), and the web shows no função picker. Seller invitations stay in the Hub (the FXL operator adds the vendedor as a Hub member with product role `seller`; the existing email self-claim binds the pessoa on first access).
- D5. `GET /bootstrap` and `GET /settings` stay open in the leads edition (the shell needs them); everything proposta-, comissão-, baixa-, catálogo-, importação- and legacy-finder-shaped answers `403 {"error":"forbidden","code":"edition_capability"}`.
- D6. The DB migration is additive (three nullable columns) and is applied by the normal deploy step; it is listed in AUDIT as a deploy fact, not parked.

## Scope limits (YAGNI)

- No per-org toggle table, no configurable field builder, no third edition.
- No change to the Hub repo (only a playbook file in this repo).
- No lead import for the leads edition (import is gated off).
- Legacy trees `/admin/*`, `/finder/*`, `/seller/*` are not touched.
- No conversion, no lost reason, no proposta anywhere in the leads edition.

## Acceptance criteria (feature level)

- AC1. With `modules: []`, every existing test passes unchanged, and new oracles pin the full-edition navigation and route gates exactly as today.
- AC2. With `modules: ['sales.edition.leads']`: admin sees exactly operacional/leads, cadastros/pessoas, cadastros/etapas; seller sees exactly meus-dados/leads; any other URL redirects to the role default.
- AC3. In the leads edition every gated API route answers 403 `edition_capability`; leads, stages, people, bootstrap and settings reads work.
- AC4. A leads-edition org with zero etapas shows an empty-state on the board (gestor: create etapas; vendedor: ask the gestor) and creating a lead is refused until one exists (superseded by SEAM-CONTRACT A1: the existing `400 {"error":"validation_error","reason":"no_open_stage","itemIndex":-1}`, no new `no_stage` code).
- AC5. The leads-edition lead dialog shows exactly Nome*, Data de aniversário, Número, Email, Descrição, Vendedor; card and list show contact data, never empresa/valor/R$ totals.
- AC6. `make dev-fake` offers a leads-edition gestor and vendedor on their own fixture org with no etapas, and the whole flow works in a real browser.
- AC7. A playbook explains the exact Hub activation (SKU + SQL) for Construbom.

## Slices

| id | slug | goal | depends_on |
| --- | --- | --- | --- |
| 01 | edition-contract | pure resolver + capabilities in shared-utils | - |
| 02 | api-edition-gate | API context `salesEdition` + `requireCapability` on route groups | 01 |
| 03 | lead-contact-columns | migration 0027 + Drizzle columns | - |
| 04 | api-leads-edition | edition-aware lead schemas/projection, people-as-vendedor, no_open_stage reuse | 02, 03 |
| 05 | web-edition-navigation | profile.edition + navigation filtered by edition | 01 |
| 06 | web-leads-contact-ui | lead dialog/card/list/board empty-state in the leads edition | 04, 05 |
| 07 | web-pessoas-vendedores | Pessoas screen as Vendedores in the leads edition | 04, 05 |
| 08 | dev-identity-and-playbook | fake roster leads identities + seed + Hub activation playbook | 01, 03 |
