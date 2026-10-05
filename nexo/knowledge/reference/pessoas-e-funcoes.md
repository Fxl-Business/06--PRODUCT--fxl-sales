# Pessoas e Funções - full reference

Moved verbatim from `CLAUDE.md` on 2026-09-22 so the standing context stays short.
`CLAUDE.md` keeps the rules; this file keeps the reasoning, history and oracle names.

- A Pessoa is the single people cadastro; a Função is an org-scoped role assigned to a pessoa. They are separate entities with separate Cadastros screens.
- `vendedor` and `finder` are the only system funções (`isSystem: true`), seeded per org. They cannot be renamed or archived, the API answers `409 funcao_is_system`, and the UI therefore exposes no edit affordance for them at all.
- Every other função is org-created and dynamic (designer, desenvolvedor, tester, P.O.) and is what the proposta professional-cost rows draw from. `Prestador` is one of these, not a system função, so never special-case its slug.
- A função is never deleted, only archived via `status`, exactly like an área. `salesOpsRouter` has no DELETE verb. An archived função stays visible on the people who already carry it but disappears from the assignment picker.
- The `sales_ops_people` columns `is_seller`, `is_finder` and `is_collaborator` are deprecated derived mirrors that the API still returns but the web type no longer declares. Web code goes through `hasFuncao` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.
- `isCollaboratorPerson` is GONE from `apps/web`; a tombstone comment sits where it was declared in `apps/web/src/sales-ops/SalesOpsApp.tsx`. It meant "carries at least one non-system função", character for character how the API still derives `is_collaborator` in `deriveBooleanMirrors`, neither side considering `status`. Both call sites are retired: the produto Prestador picker (a produto default cost keys on a `funcaoId` now) and the proposta wizard's Profissional picker, which partitions on the ROW's `funcaoId` instead - see the Propostas domain entry. Do not reintroduce it. "Carries at least one non-system função" is not a question this app asks any more; `person.funcaoIds.includes(rowFuncaoId)` is.
- Person writes send `funcaoIds` as a full set replacement; the API rejects an empty set with `funcao_required`. There are no assignment sub-resource endpoints.
- Hub `AppRole` values (`admin`, `seller`, `finder`) and `roleSummaryLabel` are unrelated to funções. Workspace visibility keeps deriving purely from `profile.roles`, never from a função assignment.

## Edição Leads (2026-10-05, edicao-leads)

- In the leads edition a pessoa is always exactly a vendedor.
- `POST /people` and `PATCH /people/:id` pass `{ edition: 'leads' }` as a trailing `PersonWriteOptions` argument to `createPerson` / `updatePerson`; the services never read the Hono context (SEAM A8).
- With that option the service first seeds both system funções with `ensureSystemFuncoes` in the same transaction (on update, only after the pessoa is found), then forces the função set to exactly `[vendedor]`.
- Any `funcaoIds` in the body (another valid id, an unknown id or an empty list) and the deprecated `isSeller` / `isFinder` / `isCollaborator` booleans are ignored, so the leads edition never answers `funcao_required` or `unknown_funcao` (SEAM A3).
- An update that carries no função key at all (the status-only Inativar / Reativar PATCH or a name-only edit) leaves the existing função rows untouched.
- `planPersonFuncoesForEdition` holds that override and runs before `planPersonFuncoes`, which itself is unchanged.
- In the full edition, or with no edition, the routes keep the exact three-argument `createPerson` and five-argument `updatePerson` calls, which is what keeps the `toHaveBeenCalledWith` oracles in `routes.test.ts` green.
- Oracles: `apps/api/src/domains/sales-ops/__tests__/people-routes-edition.test.ts` and `apps/api/test/rls/leads-edition.test.ts`.
