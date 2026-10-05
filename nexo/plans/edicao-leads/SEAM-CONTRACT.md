# SEAM CONTRACT - edicao-leads

This file is AUTHORITATIVE.
Every slice uses these exact names, paths and shapes.
A planner that needs a name not listed here invents it inside its own slice only and never exports it across slices.

## 1. Shared edition module (slice 01)

File: `packages/shared-utils/src/sales-edition.ts`, exported as the subpath `@fxl-sales/shared-utils/sales-edition` (add it to `package.json` `exports` like `./sao-paulo-day`).
Pure: imports nothing, reads no env, no clock.

```ts
export const SALES_EDITION_LEADS_MODULE = 'sales.edition.leads';

export type SalesEdition = 'full' | 'leads';

export type SalesCapability =
  | 'proposals'      // propostas, wizard, conversion, settlements, summary/dashboard
  | 'commissions'    // comissões, payouts, legacy commissions routes
  | 'catalog'        // produtos, áreas, clientes, funções cadastros
  | 'import'         // importação por planilha
  | 'finders'        // finder workspace and legacy finder/links routes
  | 'history'        // Geral settings + histórico de arquivamentos
  | 'leadFullFields';// empresa, produtos, valor estimado on leads

export type LeadFieldSet = 'full' | 'contact';

/** Absent, empty or unknown modules => 'full'. Only the exact module string flips it. */
export function resolveSalesEdition(modules: readonly unknown[] | null | undefined): SalesEdition;

/** 'full' => every capability; 'leads' => none of them. Frozen sets. */
export function editionCapabilities(edition: SalesEdition): ReadonlySet<SalesCapability>;

export function hasCapability(edition: SalesEdition, capability: SalesCapability): boolean;

/** 'full' for the full edition, 'contact' for the leads edition. */
export function leadFieldSet(edition: SalesEdition): LeadFieldSet;
```

## 2. API (slices 02 and 04)

- `applyHubAuthContext` in `apps/api/src/middleware/app-auth.ts` additionally does `c.set('salesEdition', resolveSalesEdition(auth.entitlements?.modules))`. This is the ONE place the edition is resolved; both the Hub adapter and the development adapter flow through it.
- The Hono `Variables` type gains `salesEdition: SalesEdition` wherever `userRoles` is declared.
- New file `apps/api/src/middleware/require-capability.ts`:
  - `export const EDITION_CAPABILITY_BODY = { error: 'forbidden', code: 'edition_capability' } as const;`
  - `export function requireCapability(capability: SalesCapability): MiddlewareHandler` answers `403` with exactly that body when `!hasCapability(c.get('salesEdition') ?? 'full', capability)`.
  - A missing `salesEdition` (should never happen behind `appAuthMiddleware`) is treated as `'full'`, so it can never break FXL.
- Gate map (slice 02 owns it; route paths are as mounted today):

| capability | routes |
| --- | --- |
| `proposals` | `/api/v1/sales-ops/summary`, `/api/v1/sales-ops/sales` and every `/sales/*`, `/api/v1/sales-ops/settlements*` |
| `catalog` | `/api/v1/sales-ops/products*`, `/clients*`, `/areas*`, `/funcoes*` (writes AND reads) |
| `import` | `/api/v1/sales-ops/import/*` |
| `history` | `PUT /api/v1/sales-ops/settings`, `GET /api/v1/sales-ops/history` |
| `commissions` | `/api/v1/commissions/*`, `/api/v1/admin/commissions/*`, `/api/v1/payouts/*`, `/api/v1/admin/payouts/*` |
| `finders` | `/api/v1/finder/*`, `/api/v1/links/*` |

  Open in both editions: `/bootstrap`, `GET /settings`, `/people*`, lead-stage routes, `/leads*`, `/auth/*`, health, public `/r/:code`, conversions HMAC routes, admin sellers/invitations, audit admin.
- Lead contact fields (slice 04), API names (camelCase in JSON, snake_case in SQL):

| JSON | column (slice 03) | type | rule |
| --- | --- | --- | --- |
| `contactPhone` | `contact_phone` | text null | trim, max 40, empty => null |
| `contactEmail` | `contact_email` | text null | trim, lowercased, valid email, max 254, empty => null |
| `contactBirthDate` | `contact_birth_date` | date null (Drizzle `date(..., { mode: 'string' })`) | `isIsoDay`, not after `todayInSaoPaulo()`, empty => null |

- Leads-edition write schemas (slice 04), in `apps/api/src/domains/sales-ops/leads/lead-schemas.ts`:
  - `ContactLeadFieldsSchema` = `{ contactName (required, 1-140), contactPhone?, contactEmail?, contactBirthDate?, description? (max 4000), sellerPersonId? }`, `.strict()`.
  - `CreateContactLeadSchema` = `ContactLeadFieldsSchema`; `UpdateContactLeadSchema` = `.partial().strict()`.
  - A leads-edition write stores `client_id = null`, `client_name_snapshot = ''`, `estimated_value_brl = 0`, no product rows.
  - The route picks the schema by `leadFieldSet(c.get('salesEdition'))`. The full schema (`CreateLeadSchema` / `UpdateLeadSchema`) is byte-unchanged and still `.strict()`, so FXL cannot send the new keys.
- Lead read projection (every lead returned by list/get/create/update/move) gains `contactPhone: string | null`, `contactEmail: string | null`, `contactBirthDate: string | null` (ISO day). Additive for FXL.
- Creating a lead with no active `normal` etapa answers `409 {"error":"no_stage"}` (keep the existing code if one already exists for this case; slice 04 must check and reuse it).
- People in the leads edition (slice 04): `POST /people` and `PATCH /people/:id` with `salesEdition === 'leads'` ignore any `funcaoIds` in the body and set the função set to exactly `[vendedor]`, calling `ensureSystemFuncoes(tx, orgId)` first in the same transaction. Full edition unchanged.

## 3. Database (slice 03)

- Migration `apps/api/drizzle/0027_lead_contact_fields.sql`, additive only: `ALTER TABLE sales_ops_leads ADD COLUMN contact_phone text, ADD COLUMN contact_email text, ADD COLUMN contact_birth_date date;` plus the matching Drizzle journal/snapshot entry, written with the repo's existing migration tooling and conventions (phased runner rules apply).
- Drizzle fields on `salesOpsLeads`: `contactPhone`, `contactEmail`, `contactBirthDate`.

## 4. Web (slices 05, 06, 07)

- `apps/web/src/auth/react.tsx` `profileFromToken` reads `claims.entitlements.modules` and exposes `edition: SalesEdition` on the profile (always present; `'full'` when absent). Import from `@fxl-sales/shared-utils/sales-edition`, never the package root.
- Hook: `useSalesEdition(): SalesEdition` exported from `apps/web/src/auth/react.tsx` (reads the profile).
- Navigation (`apps/web/src/sales-ops/navigation.ts`): every exported function that today takes `roles` gains a trailing optional parameter `edition: SalesEdition = 'full'`: `getVisibleWorkspaces`, `getSalesOpsNavigation`, `getDefaultSalesOpsRoute`, `resolveSalesOpsRoute`, `workspaceForView`. With `'full'` the output is byte-identical to today.
  - Leads edition: admin => workspaces `['operacional', 'cadastros']` with `operacional: [leads]` and `cadastros: [pessoas, etapas]`; seller => `['meus-dados']` with `[leads]`; finder-only => no workspace (lands on `/no-role`); `tatico` is never visible.
  - Labels in the leads edition: `operacional` workspace description `'Prospecção'`; the cadastros `pessoas` item label `'Vendedores'`. Full edition labels unchanged.
- Leads UI field set: components read `leadFieldSet(useSalesEdition())`; `'full'` renders exactly today's UI.
- Web types: `SalesOpsLead` (or the existing lead type name in `apps/web/src/sales-ops/leads/`) gains the three nullable fields; the leads-edition create/update payload type is `ContactLeadPayload` with the same keys as `ContactLeadFieldsSchema`.
- Birthday is shown with the civil-day helpers (`displayDate` from `apps/web/src/sales-ops/civil-day.ts`), never through `new Date`. Input is `<input type="date">` with `max={todayInSaoPaulo()}`.

## 5. Dev identity (slice 08)

- Fixture org: `FIXTURE_LEADS_EDITION_ORGANIZATION_ID = 'org_fake_leads'`, name `'Leads Simples (fake)'`, exported from `packages/auth-fake/src/index.ts`.
- Identities appended to the roster: `leads-owner` (workspace role `owner`, `modules: ['sales.edition.leads']`) and `leads-seller` (role `member`, productRoles `['seller']`, same module), both active on `org_fake_leads`.
- `apps/api/scripts/seed-dev.ts` seeds that org with ZERO etapas, the system funções, and one vendedor pessoa whose `contact_email` matches `leads-seller`'s email.
- Playbook: `nexo/playbooks/ativar-edicao-leads.md` (pt-BR): Hub SKU creation through the admin UI (`grants: {"module":"sales.edition.leads"}`, price 0), the access grant, and the SQL for `subscriptions` + `subscription_items` with placeholders, plus verification and rollback.

## 6. Amendments after planning (authoritative, override the sections above)

- A1 (no etapa). There is NO new `409 no_stage`. Creating a lead with no active `normal` etapa keeps the existing answer `400 {"error":"validation_error","reason":"no_open_stage","itemIndex":-1}` (`LeadInputError('no_open_stage')`). The web keys on status 400 plus `reason === 'no_open_stage'`.
- A2 (nulls). `ContactLeadFieldsSchema` accepts `null` (and empty string, normalized to `null`) for `contactPhone`, `contactEmail`, `contactBirthDate`, `description` and `sellerPersonId`, so a PATCH can clear a field.
- A3 (people). In the leads edition the server override to exactly `[vendedor]` runs BEFORE `planPersonFuncoes`, so an empty `funcaoIds` never answers `funcao_required`; a status-only PATCH (`{status}`) is accepted and leaves funções untouched.
- A4 (reactivation). The leads-edition Vendedores screen lists inactive vendedores too (muted, with an `Inativo` badge) and offers `Reativar` (status-only PATCH to `active`), because Geral and `GET /history` are gated off in that edition.
- A5 (test mocks). Every `vi.mock('@/auth/react')` that renders `SalesOpsApp` or `LeadsBoardContainer` gains `useSalesEdition: () => 'full'`; slice 05 adds it to every existing mock, later slices only to their own new tests.
- A6 (packages). Any slice whose tests import `@fxl-sales/shared-utils/sales-edition` runs `pnpm run build:packages` before its app tests.
- A7 (integration DB). Slice 03 merges before any other slice runs `test:integration`, because the shared local test DB rejects a journal that lacks an applied migration.
- A8 (edition reading). Services take the edition as an explicit argument from the route (`c.get('salesEdition') ?? 'full'`); no service reads the Hono context.
