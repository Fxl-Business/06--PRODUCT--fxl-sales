---
id: 01-seller-auto-provision
milestone: v4.4.0
status: done
depends_on: []
files_modified:
  - apps/api/src/domains/sales-ops/leads/lead-service.ts
  - apps/api/src/domains/sales-ops/leads/lead-routes.ts
  - apps/api/test/rls/leads-edition.test.ts
  - apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
  - nexo/knowledge/reference/kanban-de-leads.md
  - CLAUDE.md
acceptance: "In the leads edition, a non-admin caller whose verified roles include seller and who has no bound pessoa and no single unbound active pessoa with the token e-mail gets a pessoa created on the first leads request (name from the verified token name, else the e-mail local part; contact_email = token e-mail lowercased; status active; funções exactly [vendedor], seeding system funções in the same transaction; hub_account_id = the caller's account id) and the request succeeds scoped to that pessoa; the existing bind-by-account and claim-by-email paths still win first; two unbound pessoas with the same e-mail still answer 403 seller_person_unmapped; a finder-only caller, a caller without an e-mail claim, and every full-edition (FXL) caller keep today's behaviour byte-for-byte; the board shows a specific pt-BR message for any remaining 403 seller_person_unmapped."
oracle: apps/api/test/rls/leads-edition.test.ts
---

# 01 Seller auto-provision (leads edition)

Owner request after a production vendedor got `403 {"error":"forbidden","reason":"seller_person_unmapped"}` because no Vendedor with his e-mail had been registered: "acho que poderia criar o vendedor de maneira automática".

Why it is safe: the Hub already verified the account, the org and the app role `seller`; the provisioned pessoa is the caller's own, so scoping still shows only their leads.

## Rules

- Only when `salesEdition === 'leads'`, the caller is not admin, `userRoles` includes `seller`, and the token carries an e-mail.
- Order inside `resolveCallerPersonId` (or a leads-edition wrapper of it, chosen to keep the full-edition path byte-unchanged): bound by account, then claim the single unbound active pessoa by e-mail, then (new) provision, never when 2+ unbound candidates share the e-mail (still `seller_person_unmapped`).
- Provision inside the same `withTenant` transaction as the request; race-safe: if a concurrent request provisioned or bound first (unique hub_account_id index), re-read and use that row; never create two pessoas for one account.
- Name: verified token `name` trimmed (max length per the people schema), else the e-mail local part.
- Reuse the existing pessoa-creation and `ensureSystemFuncoes` code paths; no raw INSERT duplicating person rules if a service function exists.
- `LeadScope` gains what the route needs (`name`, `isSeller`, `edition`) read only from the verified context; the full edition never reaches the provisioning code.
- Web: in `LeadsBoardContainer`, an error with status 403 and reason `seller_person_unmapped` renders "Seu acesso ainda não está vinculado a um vendedor. Peça ao gestor para conferir seu cadastro em Vendedores." instead of the generic copy; other errors unchanged.
- Docs: one bullet in CLAUDE.md `## Edição Leads` and the kanban reference.

## Tests (red first)

Integration (`test/rls/leads-edition.test.ts`, local DB, clean up created rows and any audit rows):
1. Leads edition, seller, no pessoa: GET board succeeds; exactly one pessoa now exists with the token e-mail, name, vendedor função and hub_account_id; second request creates nothing new.
2. Existing unbound pessoa with the e-mail is claimed, not duplicated.
3. Two unbound pessoas with the e-mail: still `seller_person_unmapped`, nothing created.
4. Finder-only caller: still `seller_person_unmapped`, nothing created.
5. Full edition seller with no pessoa: still `seller_person_unmapped`, nothing created (FXL oracle).
6. No e-mail claim: still `seller_person_unmapped`.
7. Org with no system funções: they get seeded and the pessoa has vendedor.
Web: the container shows the specific copy for 403 seller_person_unmapped and the generic copy otherwise.

Run-once only; `pnpm run build:packages` first; never the em dash; no Co-Authored-By trailer.
