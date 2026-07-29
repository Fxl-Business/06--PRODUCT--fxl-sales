# Verify report - slice 05-areas-web

## Setup

Branch feat/05-areas-web was already checked out in a sibling worktree (agent-ad2f2ebb228b797a7), so this agent checked out its commit SHA 056369fff4e1ede91d1d9a95f8560ad254e9855e detached in its own isolated worktree.
`pnpm install --prefer-offline` completed cleanly with no new downloads needed beyond cache reuse.

## 1. Surface check

`git log --oneline master..HEAD` shows a single commit: 056369f feat(sales-ops): add areas cadastro view and product area selection.
`git diff master...HEAD --stat` touches exactly 13 files: CLAUDE.md, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/api.ts, apps/web/src/sales-ops/hooks.ts, apps/web/src/sales-ops/navigation.ts, apps/web/src/sales-ops/types.ts, and the six test files listed in the plan's files_modified list, plus the new areas-view.test.tsx.
`git diff master...HEAD --name-only | grep -v "^apps/web\|^CLAUDE.md"` returned no output, confirming zero apps/api changes and no files outside the declared web + CLAUDE.md surface.

## 2. Diff content vs plan

types.ts adds SalesOpsArea exactly as specified, adds areaId: string | null to SalesOpsProduct right after codeSuffix, keeps type: string on SalesOpsProduct, and adds areas: SalesOpsArea[] to SalesOpsBootstrap.
api.ts imports SalesOpsArea, adds SaveAreaPayload with the same Omit shape as SaveClientPayload, and adds saveArea to salesOpsApi mirroring the saveClient POST/PATCH split exactly.
hooks.ts imports SaveAreaPayload, adds the areas coercion line to the bootstrap select, and adds useSaveSalesOpsArea identical in shape to useSaveSalesOpsClient.
navigation.ts imports Layers alphabetically, extends SalesOpsView with 'areas' after 'produtos', and inserts the areas nav item into cadastros directly after produtos, giving the exact order produtos, areas, clientes, vendedores, finders, geral.
SalesOpsApp.tsx matches the plan section by section: emptyBootstrap gains areas: [], productTypeOptions constant is deleted entirely, ModalState gains the area variant, titleForView gains the areas entry, saveArea hook is wired, runHeaderAction and the headerAction ternary both gain the areas branch producing 'Nova área', ProductsView and the areas render branch are wired into the switch, ProductDialog and AreaDialog are mounted with the exact props and onSave/onClose wiring from the plan.
AreasView and AreaDialog/AreaDialogBody are inserted verbatim per the plan (same table columns, same badge classes, same empty-panel copy, same form fields and disabled logic).
ProductForm and productForm() replace type with areaId as specified.
ProductDialogBody adds activeAreas/currentArea/selectableAreas exactly as specified, adds the `if (!form.areaId) return;` guard in submit(), replaces the payload's type field with areaId and drops type entirely, replaces the Tipo select with the required Área select carrying aria-label="Área do produto", and changes the submit button to `disabled={saving || !form.areaId}`.
ProductsView adds the areas prop, renames the Tipo header to Área, and looks up the area name by product.areaId falling back to '-'.
CLAUDE.md's Sales Ops Routing sentence is updated to `cadastros/produtos|areas|clientes|vendedores|finders|geral`, matching the plan's exact replacement instruction, with the rest of the line untouched.

## 3. Backend contract cross-check (master apps/api/src/domains/sales-ops)

AreaSchema on master is `{ name: z.string().trim().min(1).max(120), status: z.enum(['active','archived']).default('active') }`, matching the web SaveAreaPayload shape (name required, status optional, id/orgId/createdAt/updatedAt excluded).
routes.ts on master exposes POST /api/v1/sales-ops/areas and PATCH /api/v1/sales-ops/areas/:id returning `{ area }`, matching api.ts's saveArea implementation and endpoint paths exactly.
ProductSchema on master requires `areaId: uuid` with no default/optional wrapper, and the POST/PATCH product routes 400 with `unknown_area` when the area does not resolve; the web's required Área select and submit-blocking guard align with this server-side requirement.
getSalesOpsSnapshot on master returns `areas` (via Drizzle camelCase columns) alongside clients/products/people/etc., matching SalesOpsBootstrap's added areas field and the plan's assumption that areas serializes like clients.

## 4. Static and test commands

`pnpm run lint` (repo root, pnpm -r lint): apps/api and apps/web both pass with zero eslint errors.
`pnpm run type-check` (repo root): packages/shared-types, packages/shared-utils, apps/api, apps/web all pass tsc --noEmit with zero errors.
`CI=true pnpm test` (repo root, run-once, full workspace): packages/shared-utils 17/17 tests pass, apps/api 187/187 tests pass across 21 files (including areas-contract.test.ts and the sales-ops routes/service suites), apps/web 91/91 tests pass across 15 files, including all 7 new tests in areas-view.test.tsx (lists áreas with badges/counts, empty panel, create trimmed name/status, rejects empty name, edits keeping id, requires área before saving a product and omits type from the payload, and shows área name instead of legacy type with a dash for null areaId).
The tracked-file guard `node scripts/no-legacy-auth.mjs` that pnpm test chains at the end ran with no reported failure.

## 5. UX sanity from the code

navigation.ts places the areas nav item only inside the `cadastros` array; it is not present in tatico, operacional, or meus-dados arrays, so the Áreas surface renders under Cadastros only and visibility falls out of the existing role-based workspace logic untouched.
SalesOpsApp's runHeaderAction sets `{ kind: 'area' }` when view === 'areas', and the headerAction ternary yields 'Nova área' for that view; the AreaDialog mount opens whenever modal?.kind === 'area', so the header action wires directly to the create dialog.
In ProductDialogBody, `activeAreas` filters to status === 'active', and `selectableAreas` only prepends `currentArea` when it exists and is not active; for a new product (no `modal.product`) `currentArea` is undefined so archived areas never appear in the picker, while editing a product whose stored areaId points at an archived area keeps that area as the selected option (via `currentArea` prepended to the list) so it still renders instead of silently vanishing.

## 6. Security lens

No dangerouslySetInnerHTML, innerHTML, or eval usage introduced anywhere in the diff.
AreasView and ProductsView render `area.name` (never `area.id` or `product.areaId`) to the user; the only appearances of orgId/id in the diff are in type definitions, Omit type parameters, and test fixtures, never in JSX output, so no raw account/workspace/area ids are rendered to end users.
No request body field is trusted for orgId/userId/accountId/workspaceId; area and product payloads only carry name/status/areaId and are sent through the existing token-authenticated apiFetch helper.

## Verdict

PASS. All checks are green: web-only diff surface, code matches the plan section by section, the web SaveAreaPayload/ProductSchema wiring matches the API contract already on master, lint/type-check/tests are all green with the new areas-view.test.tsx suite passing in full, the UX flow (Cadastros-only view, Nova área header action, archived-area exclusion/preservation) is correctly implemented, and no security concerns were found in the diff.
