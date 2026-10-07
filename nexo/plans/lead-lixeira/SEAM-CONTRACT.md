# SEAM CONTRACT - lead-lixeira (authoritative)

Every slice uses exactly these names.
A planner or executor that finds one of them impossible stops and reports; it never invents a parallel name.
All routes are under `/api/v1/sales-ops`, mounted through the existing `leadsRouter` (`apps/api/src/domains/sales-ops/leads/lead-routes.ts`).
`salesOpsRouter` keeps having NO `DELETE` verb: deletion is a `POST` action like `/move`.

## Database (slice 01)

- Migration `0028_lead_soft_delete` (shared phased runner, same style as `0027_lead_contact_fields`) adds to `sales_ops_leads`:
  - `deleted_at timestamptz NULL`
  - `deleted_by_user_id text NULL` (the Hub account id of the actor; never projected to any client)
  - `deleted_by_name text NULL` (actor display name snapshotted from the token: `name`, else `email`, else NULL)
  - a CHECK that `deleted_at IS NULL` exactly when `deleted_by_user_id IS NULL`.
- Drizzle columns in `apps/api/src/db/schema.ts`: `deletedAt`, `deletedByUserId`, `deletedByName`.
- A live lead is `deleted_at IS NULL`. EVERY lead read and write in `lead-service.ts` (list rows and `total`, `getLead`, `applyLeadUpdate`, `moveLead`, `readLeadView` callers, renumbering, `MAX(position)`), the import planner/executor lead reads if any, and any other reader of `sales_ops_leads` (grep the repo) filters it, through ONE exported helper `liveLeadCondition()` (returns the drizzle SQL `isNull(salesOpsLeads.deletedAt)`).
- A deleted lead keeps its `stage_id`; its `position` is irrelevant while deleted (renumbering of the column ignores deleted rows).

## API (slice 01)

- `POST /leads/:id/delete`, no body.
  - Caller: anyone who can read the lead through the existing scope gate (`resolveLeadScopePredicate` + `leadIdentityConditions`): an admin any live lead, an active vendedor his own and the unassigned pool, any other non-admin his own.
  - Takes `lockLeadBoard` after the scope gate (it changes a column), then the row `FOR UPDATE`, refuses a converted lead, sets the three columns, renumbers the lead's column densely without it, writes the audit entry, all in ONE `withTenant` transaction.
  - Never claims the lead (seller columns untouched).
  - `204` on success. `404 {error:'not_found'}` when absent, out of scope or already deleted. `409 {error:'conflict', reason:'lead_already_converted'}` for a converted lead (the existing body). `403` seller_person_unmapped as today.
  - Service function `deleteLead(db, orgId, id, scope, actor)` where `actor = { userId: string; name: string | null }`.
- `POST /leads/:id/restore`, no body, behind `requireAdmin` (403 `ADMIN_ROLE_REQUIRED_BODY` for a non-admin).
  - Takes `lockLeadBoard`, then the row `FOR UPDATE` among DELETED leads only.
  - Target etapa: the lead's own etapa when it is active; otherwise the first active `normal` etapa by board order; when none exists, `400 {reason:'no_open_stage'}` (the existing sentinel).
  - Appends at the end of the target column; `stage_changed_at` moves only when the etapa changed (the existing rule); clears the three columns; writes the audit entry.
  - `200 { lead: LeadView }`. `404` when no such deleted lead in this org.
  - Service function `restoreLead(db, orgId, id, actor)`.
- `GET /leads/deleted?cursor=&limit=`, behind `requireAdmin`.
  - `200 { items: DeletedLeadView[], nextCursor: string | null }`, newest `deleted_at` first, keyset on `(deleted_at, id)`, default limit 50, max 200.
  - `DeletedLeadView = { id: string; contactName: string; clientName: string; stageName: string; sellerName: string; estimatedValueBrl: number; deletedAt: string; deletedByName: string | null }` (`clientName` is the snapshot, `sellerName` the `seller_name_snapshot`, `stageName` the etapa's current name; `id` is used only as the restore key and is never rendered).
  - Service function `listDeletedLeads(db, orgId, query)`.
- Route ordering: `/leads/deleted` and `/leads/summary` are registered BEFORE `/leads/:id` so `:id` never swallows them.

## Audit (slice 01)

- `AuditActionSchema` gains `'lead.deleted'` and `'lead.restored'`; `entityType` is `'lead'`, `entityId` the lead id, `actorUserId`/`actorOrgId` from the context, actor name snapshotted from the token like the archive entries, `metadata` = `{ contactName, clientName, stageName, sellerName }` at the time of the act.
- Written with the SAME transaction `tx` (the hash chain rule). `CADASTRO_LIFECYCLE_ACTIONS` and `CadastroEntityTypeSchema` stay unchanged, like `import.completed`.

## API (slice 02)

- `GET /leads/summary?sellerPersonId=` for every board caller.
  - Same scope as `listLeads` (non-admin: the `leadSellerCondition` predicate and the query param ignored; admin: optional `sellerPersonId` narrowing), live leads only.
  - `200 { stages: Array<{ stageId: string; count: number; estimatedValueBrl: number }> }`, one entry per stage that has at least one visible live lead (a missing stage means zero); `estimatedValueBrl` is integer cents.
  - Service function `summarizeLeadStages(db, orgId, query, scope)`.

## Web (slices 03, 04, 05)

- `apps/web/src/sales-ops/leads/api.ts` (slice 03): `deleteLead(token: string, id: string): Promise<void>`.
- `apps/web/src/sales-ops/leads/hooks.ts` (slice 03): `useDeleteLead()` - a mutation that optimistically removes the lead from every cached board page, reverts exactly on error, and invalidates the board queries on settle.
- `apps/web/src/sales-ops/leads/delete-copy.ts` (slice 03, new): `LEAD_DELETE_COPY = { menuLabel: 'Excluir', menuTrigger: 'Ações do lead', formButton: 'Excluir lead', dialogTitle: 'Excluir lead', dialogBody: (name: string) => string, confirm: 'Excluir', cancel: 'Cancelar', pending: 'Excluindo…' }` where `dialogBody(name)` reads `O lead "<name>" sai do quadro para todos. O gestor pode restaurá-lo em Cadastros > Leads excluídos.`
- `apps/web/src/sales-ops/leads/LeadDeleteDialog.tsx` (slice 03, new): the ONE confirmation dialog (`alert-dialog`), used by the card menu, the Lista action and both forms.
- DOM hooks (slice 03): card menu trigger `data-lead-menu`, menu item `data-delete-lead`, Lista row action `data-delete-lead` (on the row's button), form button `data-delete-lead-form`, confirm button `data-confirm-delete`.
- `apps/web/src/sales-ops/leads/deleted-leads.ts` (slice 04, new): `listDeletedLeads(token, cursor?)`, `restoreLead(token, id)`, `useDeletedLeads()`, `useRestoreLead()` (on success invalidates the deleted list and the board queries), `DELETED_LEADS_COPY` (title `Leads excluídos`, columns `Lead`, `Empresa`, `Etapa`, `Vendedor`, `Excluído por`, `Excluído em`, action `Restaurar`, empty state, `Autor não identificado`).
- `apps/web/src/sales-ops/leads/DeletedLeadsView.tsx` (slice 04, new) mounted through a `DeletedLeadsContainer` like the other lead screens.
- Navigation (slice 04): cadastros view id `leads-excluidos`, label `Leads excluídos`, in BOTH editions for `admin`, appended after the existing entries of each edition's cadastros list (respect the existing ordering comments in `navigation.ts`); the route `cadastros/leads-excluidos`.
- `apps/web/src/sales-ops/leads/hooks.ts` (slice 05): `useLeadStageSummary(filters)` with query key `leadStageSummaryKey(filters)` sharing the board's memoized `filters`; every lead mutation (create, update, move, delete, restore) also invalidates it.
