---
id: 03-restore-permission
milestone: v4.8.0
status: todo
depends_on: [02-board]
files_modified:
  - apps/api/src/domains/sales-ops/leads/lead-routes.ts
  - apps/api/src/domains/sales-ops/leads/lead-trash-service.ts
  - apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
  - apps/api/test/rls/leads-lixeira.test.ts
acceptance: "An admin can still restore any deleted lead in their org. A seller can restore only a lead deleted by their own verified user ID in that org. The deleted-leads list remains admin-only. Unauthorized, live, unknown and cross-tenant lead IDs return 404 without disclosure. Restore retains the existing stage fallback, dense position, and audit entry behavior."
oracle: "apps/api/src/domains/sales-ops/leads/__tests__/lead-routes.test.ts and apps/api/test/rls/leads-lixeira.test.ts"
---

# 03 - Allow a seller to reverse their own lead deletion

## Why this is needed

The board permits a seller to delete a lead in their scope using `POST /leads/:id/delete`, but `POST /leads/:id/restore` currently has `requireAdmin`.
The next slice's Desfazer would otherwise offer that seller an action the server always refuses.
This slice changes only the permission seam, with no toast or board UI.
It follows `02-board` to give the run a deterministic serial order.

## Locked oracle first

Extend `lead-routes.test.ts` to prove the route passes verified actor and privilege to the service, lets a seller reach restore, keeps `/deleted` admin-only, and preserves 404 for refused IDs.
Extend the existing real DB `leads-lixeira.test.ts` instead of adding a parallel RLS suite.
Prove seller A can restore a row seller A deleted, seller B cannot restore it, seller A cannot restore an admin-deleted row, admin can restore either, and neither actor can restore a row from another org or a live row.
Retain the existing checks for position, archived stage fallback and the `lead.restored` ledger entry.
The RLS test must use the app DB role and verified org context as the existing file does.

## Implementation

1. Remove `requireAdmin` from `POST /:id/restore` only.
   Keep `GET /deleted` admin-only.
   Pass a server-derived privilege flag and `leadActor(c)` to `restoreLead`, never a client supplied account ID.
2. In `restoreLead`, keep the org filter and deleted predicate.
   Add a predicate that permits all org rows for admin and, for non-admin, permits only `sales_ops_leads.deleted_by_user_id = actor.userId`.
   Apply it to the locked read and restoring update so authorization stays inside the transaction.
   Return the existing `not_found` result for a disallowed row.
3. Preserve lock order (`lockLeadBoard`, row `FOR UPDATE`, renumber, audit last), own active stage or first open stage fallback, appended position, and audit action.
   The restored lead's exact former position is not guaranteed by the existing service and is not part of this permission change.
4. Update every existing `restoreLead` service call in `leads-lixeira.test.ts` to the new explicit privilege signature.
   Keep the route and service tests synchronized.

## Verification

Run once, never watch:

```sh
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/lead-routes.test.ts
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/leads-lixeira.test.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api lint
```

The RLS command needs a running local Postgres test database and the existing `TEST_DATABASE_URL`, `ADMIN_DATABASE_URL` and `TEST_MIGRATE_DATABASE_URL` setup in `apps/api/.env`.
The integration Vitest global setup checks the test role and runs migrations before the file.
No push or deploy.
