# Pessoas e Funções - full reference

Moved verbatim from `CLAUDE.md` on 2026-09-22 so the standing context stays short.
`CLAUDE.md` keeps the rules; this file keeps the reasoning, history and oracle names.

- A Pessoa is the single people cadastro; a Função is an org-scoped role assigned to a pessoa. They are separate entities with separate Cadastros screens.
- `vendedor` and `finder` are the only system funções (`isSystem: true`), seeded per org. They cannot be renamed or archived, the API answers `409 funcao_is_system`, and the UI therefore exposes no edit affordance for them at all.
- Every other função is org-created and dynamic (designer, desenvolvedor, tester, P.O.) and is what the proposta professional-cost rows draw from. `Prestador` is one of these, not a system função, so never special-case its slug.
- `GET /bootstrap` seeds the system funções on read (2026-11-11). A new org in the full edition had no `vendedor` or `finder` (migration 0012 seeded only the orgs that existed then, and the screen cannot create system funções), so no vendedor and no proposta could exist. The route now runs the ONE `ensureSystemFuncoes` inside `withTenant` right after `ensureLeadStagesForOrg` and before the snapshot. It is idempotent and race-safe (bare `ON CONFLICT DO NOTHING` plus a re-read), and acts per absent slug: an existing função, active or archived, is never recreated or written. A custom função named Vendedor or Finder under another slug makes the seed throw `system_funcao_seed_failed`; the bootstrap catches only that error, logs it and still answers the snapshot. `GET /funcoes` and `GET /people` do not seed: the web reads both lists only through the bootstrap. Callers are pinned by `apps/api/src/domains/sales-ops/__tests__/funcoes-seed-callers.test.ts`; behaviour by `apps/api/test/rls/bootstrap-system-funcoes-seed.test.ts`.
- A função is never deleted, only archived via `status`, exactly like an área. `salesOpsRouter` has no DELETE verb. An archived função stays visible on the people who already carry it but disappears from the assignment picker.
- The `sales_ops_people` columns `is_seller`, `is_finder` and `is_collaborator` are deprecated derived mirrors that the API still returns but the web type no longer declares. Web code goes through `hasFuncao` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.
- `isCollaboratorPerson` is GONE from `apps/web`; a tombstone comment sits where it was declared in `apps/web/src/sales-ops/SalesOpsApp.tsx`. It meant "carries at least one non-system função", character for character how the API still derives `is_collaborator` in `deriveBooleanMirrors`, neither side considering `status`. Both call sites are retired: the produto Prestador picker (a produto default cost keys on a `funcaoId` now) and the proposta wizard's Profissional picker, which partitions on the ROW's `funcaoId` instead - see the Propostas domain entry. Do not reintroduce it. "Carries at least one non-system função" is not a question this app asks any more; `person.funcaoIds.includes(rowFuncaoId)` is.
- Person writes send `funcaoIds` as a full set replacement; the API rejects an empty set with `funcao_required`. There are no assignment sub-resource endpoints.
- Hub `AppRole` values (`admin`, `seller`, `finder`) and `roleSummaryLabel` are unrelated to funções. Workspace visibility keeps deriving purely from `profile.roles`, never from a função assignment.

## Edição Leads (2026-10-05, edicao-leads)

- In the leads edition a pessoa is always a vendedor. Since vários funis (2026-11-16) she may also hold EXTRA funções; see the section below, which supersedes the "exactly `[vendedor]`" lines of this section.
- `POST /people` and `PATCH /people/:id` pass `{ edition: 'leads' }` as a trailing `PersonWriteOptions` argument to `createPerson` / `updatePerson`; the services never read the Hono context (SEAM A8).
- With that option the service first seeds both system funções with `ensureSystemFuncoes` in the same transaction (on update, only after the pessoa is found), then forces the função set to exactly `[vendedor]`.
- Any `funcaoIds` in the body (another valid id, an unknown id or an empty list) and the deprecated `isSeller` / `isFinder` / `isCollaborator` booleans are ignored, so the leads edition never answers `funcao_required` or `unknown_funcao` (SEAM A3).
- An update that carries no função key at all (the status-only Inativar / Reativar PATCH or a name-only edit) leaves the existing função rows untouched.
- `planPersonFuncoesForEdition` holds that override and runs before `planPersonFuncoes`, which itself is unchanged.
- In the full edition, or with no edition, the routes keep the exact three-argument `createPerson` and five-argument `updatePerson` calls, which is what keeps the `toHaveBeenCalledWith` oracles in `routes.test.ts` green.
- Oracles: `apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts` and `apps/api/test/rls/leads-edition.test.ts`.

### Leads edition (v4.3.0) - web Vendedores screen

- In the leads edition the Cadastros > Pessoas route renders `VendedoresView` and `VendedorDialog` from `apps/web/src/sales-ops/people/VendedoresView.tsx`; `SalesOpsApp` only chooses between them and `PessoasView` / `PersonDialog`.
- The page title is `Vendedores` and the header action `Novo vendedor`, overridden in `SalesOpsApp` so `titleForView` stays byte-identical for the full edition.
- The leads screen shows Nome, E-mail and Ações, and the dialog Nome and E-mail with the self-claim helper. Superseded on 2026-11-16 (vários funis): the dialog adds the extra funções picker and the list shows the extras under the name.
- `buildVendedorPayload` in `apps/web/src/sales-ops/people/vendedores.ts` sends the catalogue's system vendedor id when known and `[]` otherwise, never an unknown id, and never blocks a save on funções.
- In the leads edition the Vendedores screen lists inactive vendedores last, muted with an `Inativo` badge, and offers `Reativar` (a status-only `PATCH /people/:id` with `status: 'active'`, which slice 04 accepts without touching funções), because Geral and `GET /history` are gated off in that edition (SEAM A4).
- The leads inactivation copy points to this screen for a restore and never to Geral or the histórico.
- Nothing under `apps/web/src/sales-ops/people/` imports `SalesOpsApp`; its style constants are local copies, because `SalesOpsApp` imports that folder.
- Oracle: `apps/web/src/sales-ops/__tests__/vendedores-routing.test.tsx` pins both editions on the same route; `people/__tests__/vendedores.test.ts` and `people/__tests__/vendedores-view.test.tsx` pin the payload, copy and components.

## Vários funis: funções extras na edição Leads (2026-11-16)

Why: an org may now run several funis (the Construbom asked for Comercial and Financeiro), and which funis a vendedor works in is decided by the funções she holds (see `kanban-de-leads.md`, section Vários funis).
In the leads edition a função was invisible until now, so a pessoa had to be able to hold more than the system vendedor.

- `POST /people` and `PATCH /people/:id` in the leads edition ALWAYS keep the system `vendedor`; `funcaoIds` now ADDS extra funções after it instead of being ignored.
  An extra must be the org's own and non-system, and active or already held by this pessoa (an archived função she carries stays until an admin removes it).
  The vendedor id itself is absorbed; finder, an unknown id or another org's id answers `400 unknown_funcao` and nothing is written.
  An empty `funcaoIds` and the deprecated booleans mean vendedor only, so the leads edition still never answers `funcao_required`; a status-only or name-only PATCH still leaves the rows untouched.
- The rule is `resolveLeadsPersonFuncoes` in `apps/api/src/domains/sales-ops/service.ts`, reached through the `{ kind: 'leads', extraIds }` plan of `planPersonFuncoesForEdition`; the vendedor is seeded on demand through the same race-safe `resolvePersonFuncoes` path as every other caller.
  The leads-edition seller auto-provision still creates exactly a vendedor (its body carries no `funcaoIds`).
- The funções routes (`GET/POST /funcoes`, `PATCH /funcoes/:id`) lost their `requireCapability('catalog')` gate and answer in every edition; writes stay `requireAdmin`.
  `edition-gate-map.test.ts` lists them as OPEN and `org-modules-routes.integration.test.ts` expects `/funcoes` to answer `200` to a leads-edition org.
- Web: `VendedorDialog` adds `Funções extras`, the shared `FuncaoMultiPicker` (`apps/web/src/sales-ops/leads/FuncaoMultiPicker.tsx`: chips plus ONE `Combobox`, system funções never offered, inline create through the shell's `createFuncaoByName`).
  `buildVendedorPayload` sends `[vendedor, ...extras]` (only the extras when the catalogue has no vendedor yet) and `extraFuncaoIdsOf` reads the pessoa's non-system funções.
  The copy scan in `vendedores.test.ts` no longer forbids the word função in this edition.
- A vendedor-only pessoa changes nothing: she reaches the default funil exactly as before.
- Oracles: `apps/api/test/rls/leads-edition.test.ts` (extras accepted, vendedor always kept, system or unknown refused, archived extra kept only when held), `apps/api/test/rls/pipeline-access.test.ts`, `people/__tests__/vendedores.test.ts`, `people/__tests__/vendedores-view.test.tsx`.
