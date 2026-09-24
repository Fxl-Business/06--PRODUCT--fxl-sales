---
id: 07-admin-gate-and-brl
milestone: v4.1.0
status: parked
depends_on: [05-wizard-row-ids, 06-settlements-api]
files_modified: [apps/api/src/middleware/require-admin.ts, apps/api/src/domains/sales-ops/routes.ts, apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/__tests__/financial-admin-gate.test.ts, apps/api/src/domains/sales-ops/__tests__/routes.test.ts, apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts, apps/web/src/sales-ops/api.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/mutation-error-copy.ts, apps/web/src/sales-ops/MutationErrorBanner.tsx, apps/web/src/sales-ops/__tests__/settings-currency-brl.test.tsx, apps/web/src/sales-ops/__tests__/mutation-error-banner.test.tsx, apps/web/src/sales-ops/__tests__/financial-mutation-forbidden.test.tsx, apps/web/src/sales-ops/sale-save-error.ts, apps/web/src/sales-ops/__tests__/sale-save-error.test.ts, CLAUDE.md, nexo/knowledge/reference/propostas.md, nexo/knowledge/reference/auth-model.md]
goal: "PC23 admin gate on the financial proposta and settings routes (POST /sales stays open except status won), a pt-BR in-page error for a 403 on those mutations, and currency locked to BRL in API and UI"
acceptance: ["POST /sales/:id/transition, POST /sales/:id/cancel-contract, PUT /sales/:id and PUT /settings answer 403 {error:'forbidden',reason:'admin_role_required'} for roles seller, finder and undefined, and the service function is never called", "The same four routes answer 2xx for role admin and call the service with the verified org", "POST /sales with status 'won' from a non-admin answers the same 403 body before validation and createSale is never called, even when the rest of the body is invalid", "POST /sales with status 'draft' or 'open' from a seller answers 201", "POST /sales with status 'won' from an admin answers 201", "PUT /settings with currency 'USD' answers 400 validation_error and upsertSettings is never called; an omitted currency is persisted as 'BRL'", "The Configuracoes form renders no currency picker and no 'USD' or 'Dolar' text, shows 'Real (BRL)' read-only, and always submits currency 'BRL' even when the stored settings carry a legacy 'USD'", "A 403 on saving settings (and on transition or cancel-contract) keeps the current screen mounted, renders the pt-BR admin-required alert, and never renders ForbiddenPanel", "SalesView receives canManage only when the workspace is operacional AND profile.roles includes admin", "CLAUDE.md, nexo/knowledge/reference/propostas.md and nexo/knowledge/reference/auth-model.md carry the PC23 gate and the BRL lock in the same change"]
---

# 07 - Admin gate on financial routes (PC23) and currency locked to BRL

## Context

What the code does today, verified in this worktree at the base commit `82a62a3`.
Slices 04 and 06 land before this one and will have edited some of the same handlers; line numbers below are the base, so locate by the route string, never by line number.

API.
- `apps/api/src/middleware/require-admin.ts` is the ONE admin mechanism.
  It reads `c.get('userRole') !== 'admin'` and answers `403 { error: 'forbidden', reason: 'admin_role_required' }`.
- `userRole` is `userRoles[0]` (`apps/api/src/middleware/app-auth.ts:162-163`), and `getAppRolesFromHubClaims` (`app-auth.ts:59-71`) returns `['admin','seller','finder']` for workspace owner/admin, `isSuperAdmin` or product role `admin`, otherwise a filter over `seller`/`finder`.
  So `userRole === 'admin'` is exactly "has admin"; `lead-routes.ts:54` reads the same fact as `userRoles.includes('admin')`.
- `apps/api/src/domains/sales-ops/routes.ts` already gates `POST /people` (`:95`), `PATCH /people/:id` (`:107`), `POST /funcoes` (`:247`), `PATCH /funcoes/:id` (`:263`) and `GET /history` (`:425`) with `requireAdmin` as the second argument of the route call.
  Ungated today: `POST /sales` (`:302`), `POST /sales/:id/transition` (`:321`), `POST /sales/:id/cancel-contract` (`:336`), `PUT /sales/:id` (`:353`), `PUT /settings` (`:381`).
  Slice 06 adds the settlement routes with `requireAdmin` already; this slice does not touch them.
- `SettingsSchema` (`apps/api/src/domains/sales-ops/service.ts:422-438`) has `currency: z.string().default('BRL')`.
  `upsertSettings` (`service.ts:2262`) spreads the parsed data into both the insert and the `onConflictDoUpdate` set, so every save rewrites `currency` with whatever was parsed.
  `getSettings` (`service.ts:2288`) returns the raw row; there is no read-side parse, so a legacy stored value cannot break a read.
  The column is `currency text NOT NULL DEFAULT 'BRL'` (`apps/api/src/db/schema.ts:775`, migration `0007`).
  The seed (`apps/api/scripts/seed/plan.ts:767`) already writes `'BRL'`.
- Route tests build a non-admin caller by setting Hono context directly: `apps/api/src/domains/sales-ops/__tests__/routes.test.ts:93-104` sets `userRole` / `userRoles` from a mutable `currentRole` that `beforeEach` resets to `undefined` (`:209`).
  `apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts:25-34` sets NO role at all, so every test in it will turn into a 403 once the gate lands.
  The fake identity roster (`packages/auth-fake/src/index.ts`) has no seller-only identity: every roster entry yields the full-access set (documented there, lines 24-33), so route tests, not the roster, are how a non-admin is exercised.

Does a seller reach `POST /sales`? Yes, verified.
- `meus-dados/leads` is the seller's board (CLAUDE.md, Kanban de leads).
- `SalesOpsApp.tsx:2163-2181` mounts `LeadsBoardContainer` with `onRequestConversion={requestLeadConversion}` for `view === 'leads'` in BOTH workspaces (`showSellerFilter` is the only difference).
- `requestLeadConversion` (`SalesOpsApp.tsx:1441`) opens the wizard in `convert` mode and `saveLeadConversion` calls `createSale.mutateAsync` (`SalesOpsApp.tsx:1486`), which is `POST /api/v1/sales-ops/sales`.
- The wizard only ever sends `status: 'draft' | 'open'` (`createPayload(status: 'draft' | 'open')`, `SalesOpsApp.tsx:7569`, `submit` at `:7674`).
  So H4 holds: gate `POST /sales` only for `status: 'won'`, and no legitimate UI flow is affected.

Web.
- Mutation errors are silent today.
  `transitionSale.mutate(...)` (`SalesOpsApp.tsx:2106`), `cancelContract.mutate(sale.id)` (`:2103`) and `saveSettings.mutate(payload)` (`:2200`) pass no `onError`, and the hooks (`apps/web/src/sales-ops/hooks.ts:257-288`) have none either.
- `ForbiddenPanel` is rendered ONLY for a failed `bootstrapQuery` (`SalesOpsApp.tsx:2046-2078`) and by `CadastroHistoryPanel` for its own read; a mutation 403 never reaches it today.
- `SalesView` gets `canManage={workspace === 'operacional'}` (`SalesOpsApp.tsx:2102`), while cadastros uses `workspace === 'cadastros' && profile.roles.includes('admin')` (`:1332`).
  `operacional` is only visible to admins through `getVisibleWorkspaces`, so the transition, cancel and edit buttons are already unreachable for a seller; a 403 there can only happen when a role is revoked in the Hub while the operator's cached token still says admin, or on a direct API call.
- The settings form (`SettingsView`, `SalesOpsApp.tsx:3808`, not exported) renders `FieldBlock label="Moeda"` with a `Combobox` offering `Real (BRL)` and `Dólar (USD)` (`:3924-3936`).
  `activeSettings` (`:813-831`) seeds `currency: settings?.currency ?? 'BRL'`, so a legacy `USD` row would be sent back on save.
  `SaveSettingsPayload` (`apps/web/src/sales-ops/api.ts:98`) derives `currency?: string` from `SalesOpsSettings`.
- Money formatting is already hard-wired to BRL everywhere (`calculations.ts:464-465`, `SalesOpsApp.tsx:3128-3129`, `packages/shared-utils/src/money.ts:7-8`); the setting has never had an effect.

## Design

### A. API gate

1. `apps/api/src/middleware/require-admin.ts` gains two exports and `requireAdmin` is rewritten on top of them (behaviour and body byte-identical):

```ts
import type { Context, MiddlewareHandler } from 'hono';

/** The one 403 body every admin-only decision answers. */
export const ADMIN_ROLE_REQUIRED_BODY = {
  error: 'forbidden',
  reason: 'admin_role_required',
} as const;

/** The one admin predicate. `requireAdmin` and any in-handler check read this. */
export function hasAdminRole(c: Context): boolean {
  return c.get('userRole') === 'admin';
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!hasAdminRole(c)) {
    return c.json(ADMIN_ROLE_REQUIRED_BODY, 403);
  }
  return next();
};
```

Keep the existing doc comment on `requireAdmin` and add one sentence: "`hasAdminRole` is exported so a route that is open to non-admins but has an admin-only branch (`POST /sales` with `status: 'won'`) answers the same body from the same predicate."

2. `apps/api/src/domains/sales-ops/routes.ts`:
   - Import `ADMIN_ROLE_REQUIRED_BODY` and `hasAdminRole` beside `requireAdmin`.
   - Insert `requireAdmin,` as the second argument of exactly these four route calls: `salesOpsRouter.post('/sales/:id/transition', requireAdmin, async (c) => {`, `salesOpsRouter.post('/sales/:id/cancel-contract', requireAdmin, ...`, `salesOpsRouter.put('/sales/:id', requireAdmin, ...`, `salesOpsRouter.put('/settings', requireAdmin, ...`.
     Do not change anything else in those handlers (slices 04 and 06 own their bodies).
   - `POST /sales` becomes:

```ts
salesOpsRouter.post('/sales', async (c) => {
  const body: unknown = await c.req.json().catch(() => ({}));
  // PC23: creating a proposta stays open (a seller's lead conversion on
  // meus-dados/leads posts here), but creating one already `won` materialises
  // payables, which is a financial act. Decided on the RAW body, before
  // validation, so a non-admin asking for `won` never learns anything from a
  // validation error and never reaches createSale.
  if (isWonRequest(body) && !hasAdminRole(c)) {
    return c.json(ADMIN_ROLE_REQUIRED_BODY, 403);
  }
  const parsed = CreateSaleSchema.safeParse(body);
  ... unchanged from here ...
});
```

   with a module-level helper right above it:

```ts
function isWonRequest(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { status?: unknown }).status === 'won';
}
```

   - Add one comment line above the four gated routes block (next to `POST /sales/:id/transition`): `// PC23: every route that moves ledger money or org-wide financial defaults is admin-only.`

3. `apps/api/src/domains/sales-ops/service.ts`, `SettingsSchema` only: `currency: z.literal('BRL').default('BRL'),` with a one-line comment above: `// Locked to BRL: the only currency the app formats and the Finance sync precondition. Legacy stored values are tolerated on read and rewritten by the next save.`
   `SettingsInput['currency']` becomes `'BRL'`; nothing else in `service.ts` reads it.
   Do not touch `getSettings`, the Drizzle schema or any migration.

### B. Web: 403 on a financial mutation

Decision: a 403 from a MUTATION renders an in-page pt-BR alert on the current screen and never `ForbiddenPanel`.
Justification: `ForbiddenPanel` is the app gate (CLAUDE.md, Auth Model deny taxonomy), and the shell renders it INSTEAD of the view for a failed bootstrap read; routing a mutation 403 into it would unmount the operator's screen for a single refused action while every read still works, and it is the same "ask an administrator" message in a much heavier form.
The banner copy says the same thing without naming a role id, so the identifier law holds.

1. New `apps/web/src/sales-ops/mutation-error-copy.ts` (a `.ts` module for the same `react-refresh/only-export-components` reason `forbidden-copy.ts` gives):

```ts
import { isForbiddenFailure } from '@/lib/require-token';

export const MUTATION_ERROR_COPY = {
  adminRequired:
    'Somente administradores da Organização podem fazer esta alteração. Peça a quem administra a Organização no FXL Hub.',
  saleHasActiveSettlements:
    'Esta proposta tem pagamentos registrados. Estorne os pagamentos antes de mudar o status.',
  generic: 'Não foi possível concluir a ação. Tente novamente.',
  dismiss: 'Fechar aviso',
} as const;

/**
 * The pt-BR line for a failed sales-ops mutation. Keys on the STATUS for the 403
 * (the deny taxonomy rule: never on the body code), and on the body `error` code
 * only to pick a more specific 409 line.
 */
export function salesOpsMutationErrorMessage(error: unknown): string {
  if (isForbiddenFailure(error)) return MUTATION_ERROR_COPY.adminRequired;
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { error?: unknown }).error === 'sale_has_active_settlements'
  ) {
    return MUTATION_ERROR_COPY.saleHasActiveSettlements;
  }
  return MUTATION_ERROR_COPY.generic;
}
```

   Check `isForbiddenFailure`'s real signature in `apps/web/src/lib/require-token.ts` before use (it is `(error: unknown) => boolean`, keyed on `status === 403`).
   `sale_has_active_settlements` is the C5 code slice 06 emits on transition and cancel-contract, which are exactly the surfaces this banner serves.

2. New `apps/web/src/sales-ops/MutationErrorBanner.tsx`:

```tsx
import { X } from 'lucide-react';
import { MUTATION_ERROR_COPY, salesOpsMutationErrorMessage } from './mutation-error-copy';

export function MutationErrorBanner({ error, onDismiss }: { error: unknown; onDismiss: () => void }) {
  if (error === null || error === undefined) return null;
  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-[10px] border border-[#f1c9c4] bg-[#fdf2f1] px-4 py-3 text-[13.5px] font-semibold text-[#c93d32]"
      data-mutation-error
      role="alert"
    >
      <span className="min-w-0 flex-1 leading-[1.4]">{salesOpsMutationErrorMessage(error)}</span>
      <button
        aria-label={MUTATION_ERROR_COPY.dismiss}
        className="flex-none rounded-md p-0.5 text-[#c93d32] hover:bg-[#f8e0dd]"
        onClick={onDismiss}
        type="button"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
```

   The red `#c93d32` is the existing error red (`SalesOpsApp.tsx:1204`).

3. `SalesOpsApp.tsx`, `SalesOpsApp()` body, small localized edits only:
   - Import `MutationErrorBanner` from `./MutationErrorBanner`.
   - After `const saveSettings = useSaveSalesOpsSettings();` add:

```ts
  // A refused financial mutation (PC23 403, or a 409 lock) is shown on the screen
  // it happened on and nowhere else. Scoped to the view so navigating away drops
  // it without an effect. Never ForbiddenPanel: that one replaces the screen and
  // is the app gate for the bootstrap read only.
  const [mutationFailure, setMutationFailure] = useState<{ error: unknown; view: SalesOpsView } | null>(null);
  const reportMutation = {
    onError: (error: unknown) => setMutationFailure({ error, view }),
    onSuccess: () => setMutationFailure(null),
  };
```

     Place it after `view` is defined; if `view` is declared later than `saveSettings`, put these lines immediately after the `view` declaration instead.
     If TypeScript rejects `reportMutation` as the second argument of a given `mutate` because of `onSuccess`'s arity, spread it per call instead (`{ ...reportMutation }`) or type it as `{ onError: (error: Error) => void; onSuccess: () => void }`; the behaviour is what matters.
   - `onCancelContract={(sale) => cancelContract.mutate(sale.id, reportMutation)}`.
   - `onTransition={(sale, status) => transitionSale.mutate({ saleId: sale.id, status }, reportMutation)}`.
   - `onSave={(payload) => saveSettings.mutate(payload, reportMutation)}`.
   - `canManage={workspace === 'operacional' && profile.roles.includes('admin')}` (mirror of `canManageCadastros`).
   - Inside `<div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-5">`, as its FIRST child, before `{bootstrapQuery.isLoading ? <LoadingPanel /> : null}`:

```tsx
            <MutationErrorBanner
              error={mutationFailure?.view === view ? mutationFailure.error : null}
              onDismiss={() => setMutationFailure(null)}
            />
```

   - The sale wizard (`updateSale` / `createSale`) is NOT wired to this banner, because the banner sits behind the dialog.
     Slice 05 owns the wizard's error line (it must name the blocking row).
     Slice 05 (already merged) renders the wizard's save error through `describeSaleSaveError` in `apps/web/src/sales-ops/sale-save-error.ts`; change ONLY its 403 branch to return `[MUTATION_ERROR_COPY.adminRequired]` (import from `./mutation-error-copy`), so every 403 copy in sales-ops is the same line (contract H7), and update the matching expectation in `apps/web/src/sales-ops/__tests__/sale-save-error.test.ts` (`maps sale_not_editable, 403 and any other failure`).

4. Export `SettingsView` (add the `export` keyword to `function SettingsView(`), so the settings oracle renders it directly the way `sales-transition-actions.test.tsx` renders `SalesView`.

### C. Web: currency locked to BRL

Decision: keep a read-only `Moeda` field showing `Real (BRL)`, rather than removing the field.
Justification: the currency is a real, fixed property of the org's ledger and a precondition of the Finance sync (audit section 6, "moeda BRL"); showing it tells the operator what the numbers are in, and keeps the `Imposto padrão %` / `Moeda` two-column row in the `Financeiro` card balanced instead of leaving a half-empty grid row.
A read-only text is not a picker, so the UI Controls rules do not apply to it.

- `SettingsView`: replace the whole `<FieldBlock label="Moeda"> <Combobox ... /> </FieldBlock>` with:

```tsx
              <FieldBlock label="Moeda">
                <div
                  aria-readonly="true"
                  className="flex h-11 items-center rounded-[10px] border border-[#e5e5ea] bg-[#f4f4f6] px-3 text-[14px] font-semibold text-[#57575f]"
                  data-settings-currency
                >
                  Real (BRL)
                </div>
              </FieldBlock>
```

  Match the height to `formSelectClass` (44px, `h-11`); if `formSelectClass` uses different radius or border tokens, copy its radius and border colour so the read-only box lines up with the `Imposto padrão %` input beside it.
- `activeSettings`: `currency: 'BRL',` (ignore `settings?.currency`; a stored legacy value is never echoed back).
- `apps/web/src/sales-ops/api.ts`: add `| 'currency'` to the `Omit<...>` list of `SaveSettingsPayload` and add `currency?: 'BRL';` to the intersected object literal.
  `SalesOpsSettings.currency` stays `string` in `types.ts`: it describes what the API may return, and a legacy row is tolerated on read.

### D. Legacy rows

No data migration.
Every save now writes `currency = 'BRL'` (schema default plus the web always sending `'BRL'`), the value has never had an effect, and a data-only `UPDATE` in a migration would run without an org context against a FORCE RLS table, which is the class of silently-vacuous change this repo has been bitten by.
The future integration's precondition must treat currency as the constant BRL, not read the column; that sentence goes into propostas.md.

## Steps

Red, then Green, then Refactor, in this order.

1. Red, API gate.
   Create `apps/api/src/domains/sales-ops/__tests__/financial-admin-gate.test.ts`.
   Harness: copy the `routes.test.ts` pattern (`vi.hoisted` service mocks, `vi.mock('../../../db/client.js')`, `vi.mock('../service.js', importOriginal spread)`, a `createTestApp` whose middleware sets `userId`, `orgId`, `userRole = currentRole`, `userRoles = currentRole === 'admin' ? ['admin','seller','finder'] : currentRole ? [currentRole] : []`, and `hubAuth` from `../../../auth/__tests__/hub-auth-context-fixture.js`).
   Mock `createSale`, `updateSale`, `transitionSale`, `cancelContract`, `upsertSettings` with success values: `createSale` resolves `{ sale: { id: SALE_ID, code: '0001-01' }, ledger: { sale: { totalBrl: 400000 } }, payables: [] }`; `updateSale` resolves `{ ok: true, sale: { id: SALE_ID }, ledger: {} }`; `transitionSale` resolves `{ ok: true, sale: { id: SALE_ID, status: 'won' } }`; `cancelContract` resolves `{ ok: true, sale: { id: SALE_ID }, voidedReceivables: 0, voidedPayables: 0 }`; `upsertSettings` resolves `{ orgId: 'verified-org', currency: 'BRL' }`.
   If slice 04/06 changed the result shape a handler reads (for example `ledger` or extra fields), read the current handler and mock the shape it needs so the admin case returns 2xx.
   Reuse the `salePayload` literal from `routes.test.ts` (copy it; do not import from another test file).
   Define a table:

```ts
const GATED = [
  { name: 'POST /sales/:id/transition', method: 'POST', path: `/sales/${SALE_ID}/transition`, body: { status: 'won' }, mock: 'transitionSale', ok: 200 },
  { name: 'POST /sales/:id/cancel-contract', method: 'POST', path: `/sales/${SALE_ID}/cancel-contract`, body: {}, mock: 'cancelContract', ok: 200 },
  { name: 'PUT /sales/:id', method: 'PUT', path: `/sales/${SALE_ID}`, body: salePayload, mock: 'updateSale', ok: 200 },
  { name: 'PUT /settings', method: 'PUT', path: '/settings', body: { currency: 'BRL' }, mock: 'upsertSettings', ok: 200 },
] as const;
```

   Tests (titles exact):
   - `describe('PC23 financial admin gate')`:
     - `it.each(GATED.flatMap((route) => (['seller', 'finder', undefined] as const).map((role) => [route.name, role, route] as const)))('rejects %s for role %s with the requireAdmin body before the service runs', ...)`: expects 403, body `toEqual({ error: 'forbidden', reason: 'admin_role_required' })`, and `serviceMocks[route.mock]).not.toHaveBeenCalled()`.
     - `it.each(GATED.map((route) => [route.name, route] as const))('lets an admin through %s', ...)`: `currentRole = 'admin'`, expects `route.ok`, and the service mock called with `mockedDb` and `'verified-org'` as its first two arguments (`expect(mock.mock.calls[0]?.slice(0, 2)).toEqual([mockedDb, 'verified-org'])`).
   - `describe('POST /sales stays open except for status won')`:
     - `it.each(['seller', 'finder', undefined] as const)('rejects a won proposta from role %s before validation', ...)`: body `{ ...salePayload, status: 'won' }`, 403, admin body, `createSale` not called.
     - `it('answers 403 and not 400 for an invalid won body from a non-admin', ...)`: `currentRole = 'seller'`, body `{ status: 'won' }`, expects 403.
     - `it.each(['draft', 'open'] as const)('lets a seller create a %s proposta', ...)`: `currentRole = 'seller'`, 201, `createSale` called with `expect.objectContaining({ status })`.
     - `it('lets an admin create a won proposta', ...)`: 201.
   - `describe('settings currency is locked to BRL')`, `currentRole = 'admin'` in a `beforeEach`:
     - `it('rejects currency USD with 400 validation_error', ...)`: body `{ currency: 'USD' }`, 400, `error: 'validation_error'`, `upsertSettings` not called.
     - `it('persists an omitted currency as BRL', ...)`: body `{}`, 200, `upsertSettings` called with `(mockedDb, 'verified-org', expect.objectContaining({ currency: 'BRL' }))`.
     - `it('accepts currency BRL', ...)`: 200.
   Run it; the gated-route rejections, the won rejections and the USD case must fail.

2. Green, API.
   Apply Design A (require-admin.ts, routes.ts) and the `SettingsSchema` line.
   Re-run the new file until green.

3. Fix the pre-existing route tests that now meet the gate (no behaviour weakened):
   - `apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts`: in `createTestApp`'s middleware add `c.set('userRole', 'admin');` and `c.set('userRoles', ['admin', 'seller', 'finder']);` with a comment `// These tests cover the handler past PC23's requireAdmin; the gate itself is financial-admin-gate.test.ts.`
   - `apps/api/src/domains/sales-ops/__tests__/routes.test.ts`: every test that calls `PUT /sales/:id`, `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract` or `PUT /settings` and expects a non-403 status sets `currentRole = 'admin';` as its first line (at base these are `returns 409 when updating a won proposta` and `returns 404 for an unknown or non-uuid sale id`; slice 04 may have renamed or added some, so grep the file for `method: 'PUT'` and for those paths).
     Leave the POST `/sales` tests as they are: they run as `undefined` role with `status: 'open'`, which is now itself proof that creation stays open.
   Run `pnpm --filter @fxl-sales/api test` and fix any other test that hits one of the four routes without a role (search `apps/api/src` for `/transition`, `cancel-contract`, `'/settings'`).

4. Red, web banner.
   Create `apps/web/src/sales-ops/__tests__/mutation-error-banner.test.tsx` (happy-dom, `createRoot` + `act` pattern from `forbidden-panel.test.tsx`):
   - `it('maps a 403 to the admin-required copy', ...)`: `salesOpsMutationErrorMessage({ error: 'forbidden', status: 403 })` equals `MUTATION_ERROR_COPY.adminRequired`.
   - `it('keys the 403 on the status, not the body code', ...)`: `{ error: 'something_else', status: 403 }` still gives `adminRequired`.
   - `it('maps a 409 sale_has_active_settlements to the settlements copy', ...)`.
   - `it('falls back to the generic copy for any other failure', ...)`: `{ error: 'request_failed', status: 500 }` and `new Error('x')`.
   - `it('renders nothing without an error', ...)`: `<MutationErrorBanner error={null} ... />` leaves `container.innerHTML === ''`.
   - `it('renders the admin copy as an alert and never the forbidden panel', ...)`: renders with a 403, expects `[role="alert"]` text to contain `MUTATION_ERROR_COPY.adminRequired`, `container.querySelector('[data-forbidden]')` null, and the text does not contain `FORBIDDEN_COPY.title`.
   - `it('calls onDismiss from the close button', ...)`: click the button with `aria-label` `Fechar aviso`, expect the spy called once.

5. Red, settings currency.
   Create `apps/web/src/sales-ops/__tests__/settings-currency-brl.test.tsx` rendering `<SettingsView isSaving={false} onSave={onSave} settings={legacySettings} />` where `legacySettings: SalesOpsSettings` is a full literal with `currency: 'USD'` (copy the other fields from `sale-wizard-edit.test.tsx`'s settings fixture).
   Mock `@/auth/react` as `forbidden-panel.test.tsx` does if the module graph needs it.
   - `it('offers no USD currency option', ...)`: `container.textContent` contains `Real (BRL)`, does not contain `USD` and does not contain `Dólar`; `container.querySelector('[aria-label="Moeda"]')` is null (the Combobox trigger carried that label).
   - `it('shows the currency read-only', ...)`: `container.querySelector('[data-settings-currency]')?.textContent` is `Real (BRL)` and it has `aria-readonly="true"`.
   - `it('saves BRL even when the stored currency is a legacy USD', ...)`: submit the form (click the `Salvar alterações` button inside `act`), expect `onSave` called with `expect.objectContaining({ currency: 'BRL' })`.

6. Red, shell wiring.
   Create `apps/web/src/sales-ops/__tests__/financial-mutation-forbidden.test.tsx`, copying the harness of `entitlement-dead-end.test.tsx` (the `@/auth/react` mock with `roles: ['admin']`, the dialog mock, `QueryClient` with `retry: false` for queries and mutations, `MemoryRouter` with `/:workspace/:view`, real `apiFetch` through a stubbed `fetch`).
   `fetchMock.mockImplementation((url: string, init?: RequestInit) => ...)`:
   - `GET .../api/v1/sales-ops/bootstrap` answers `{ ok: true, status: 200, json: async () => bootstrap }` where `bootstrap` is the `emptyBootstrap` literal from `forbidden-panel.test.tsx` plus `settings: legacySettings` (same fixture shape as step 5; add any field slices 04/06 made required on `SalesOpsBootstrap`).
   - `GET` whose url contains `/api/v1/sales-ops/history` answers 200 `{ entries: [], nextCursor: null }`.
   - `PUT .../api/v1/sales-ops/settings` answers `{ ok: false, status: 403, json: async () => ({ error: 'forbidden', reason: 'admin_role_required' }) }`.
   - Anything else answers 404 `{ error: 'not_found' }`.
   Test `it('keeps Configurações on screen and shows the admin copy when saving settings answers 403', ...)`: render `/cadastros/geral`, flush twice, click `Salvar alterações`, flush twice; expect the text to contain `MUTATION_ERROR_COPY.adminRequired`, `Dados da empresa` still present, `[data-forbidden]` null, and the `PUT` was issued exactly once.

7. Green, web.
   Apply Design B and C (`mutation-error-copy.ts`, `MutationErrorBanner.tsx`, the `SalesOpsApp.tsx` edits, `export function SettingsView`, `api.ts`).
   Run the three new web test files until green, then the whole web suite (`pnpm --filter @fxl-sales/web test`) because `SettingsView` and `SalesView` wiring are shared; fix any test that asserted the old `Moeda` combobox (none exist at base; `combobox-adoption.test.tsx` should be checked anyway).

8. Refactor.
   No behaviour change: make sure `routes.ts` has no second admin check spelled inline, that the only `'admin_role_required'` literal in `apps/api/src` outside tests is in `require-admin.ts` (`grep -rn "admin_role_required" apps/api/src | grep -v __tests__`; `lead-routes.ts` builds its own `{error:'forbidden', reason}` for `seller_scope`, leave it), and that `SalesOpsApp.tsx`'s diff is only the lines listed in Design B.3 and C.

9. Docs (section below), then lint and type-check on changed files: `pnpm run lint` and `pnpm run type-check`.

## Oracle tests

Verify runs exactly these, and each can be proven non-vacuous by the named mutation.

API (unit, no database):
`pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/financial-admin-gate.test.ts src/domains/sales-ops/__tests__/transition-routes.test.ts src/domains/sales-ops/__tests__/routes.test.ts`
- `PC23 financial admin gate > rejects %s for role %s with the requireAdmin body before the service runs` (12 rows).
  Mutation: delete `requireAdmin,` from any one of the four route calls; the three rows of that route fail.
- `PC23 financial admin gate > lets an admin through %s` (4 rows).
  Mutation: change `hasAdminRole` to `return false`; all four fail.
- `POST /sales stays open except for status won > rejects a won proposta from role %s before validation` and `answers 403 and not 400 for an invalid won body from a non-admin`.
  Mutation: delete the `isWonRequest(body) && !hasAdminRole(c)` branch; all fail (201 and 400 respectively).
  Second mutation: move the check after `safeParse`; the invalid-body test fails with 400.
- `POST /sales stays open except for status won > lets a seller create a %s proposta`.
  Mutation: put `requireAdmin` on `POST /sales`; both rows fail with 403.
- `settings currency is locked to BRL > rejects currency USD with 400 validation_error`.
  Mutation: revert `currency` to `z.string().default('BRL')`; the test gets 200.
- `settings currency is locked to BRL > persists an omitted currency as BRL`.
  Mutation: drop `.default('BRL')`; the call no longer carries `currency: 'BRL'` (zod then rejects the missing literal with 400).

Web (happy-dom):
`pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/mutation-error-banner.test.tsx src/sales-ops/__tests__/settings-currency-brl.test.tsx src/sales-ops/__tests__/financial-mutation-forbidden.test.tsx src/sales-ops/__tests__/entitlement-dead-end.test.tsx src/sales-ops/__tests__/sales-transition-actions.test.tsx src/sales-ops/__tests__/sale-save-error.test.ts`
- `offers no USD currency option`.
  Mutation: restore the `Combobox` with the `USD` option; the text and `[aria-label="Moeda"]` assertions fail.
- `saves BRL even when the stored currency is a legacy USD`.
  Mutation: restore `currency: settings?.currency ?? 'BRL'` in `activeSettings`; `onSave` receives `USD`.
- `keys the 403 on the status, not the body code`.
  Mutation: change the 403 branch to compare `error === 'forbidden'`; this row fails.
- `renders the admin copy as an alert and never the forbidden panel`.
  Mutation: return `<ForbiddenPanel />` from the banner for a 403; the `[data-forbidden]` assertion fails.
- `keeps Configurações on screen and shows the admin copy when saving settings answers 403`.
  Mutation: remove `reportMutation` from `saveSettings.mutate(...)`; the admin copy never appears.
  Second mutation: render the banner with `mutationFailure?.error` but without the `view` scope; still passes (that property is not claimed by this oracle, only by review).
- `entitlement-dead-end.test.tsx` and `sales-transition-actions.test.tsx` are regression guards for the shell classification and `SalesView`, which this slice edits.

Full suite once per wave as usual: `pnpm test`, `pnpm run lint`, `pnpm run type-check`.
No integration test is needed: the gate is route middleware over mocked services and changes no SQL.

## Docs

CLAUDE.md, section `## Propostas domain`, insert a new block immediately before the `Testing:` line (one sentence per line, no em dash):

```markdown
Financial role gate (PC23):
- `requireAdmin` guards `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id`, `PUT /settings` and every settlement route; a new route that moves ledger money or org-wide financial defaults gets it too.
- `POST /sales` stays open because a seller's lead conversion on `meus-dados/leads` creates the proposta, but a raw body with `status: 'won'` from a non-admin answers the `requireAdmin` body before validation.
- `hasAdminRole` and `ADMIN_ROLE_REQUIRED_BODY` in `apps/api/src/middleware/require-admin.ts` are the one predicate and the one body; never spell an admin check inline.
- A 403 from a mutation renders `MutationErrorBanner` on the current screen and never `ForbiddenPanel`, which stays the app gate for reads.
- Settings `currency` is `z.literal('BRL')`; the UI shows `Real (BRL)` read-only and always sends `BRL`. Legacy stored values are tolerated on read and rewritten by the next save; there is no data migration.
```

Also in CLAUDE.md `## Auth Model`, `Access gate:` list, after the `SalesOpsApp classifies in the order entitlement, forbidden, auth, generic.` bullet, add:

```markdown
- That classification is for the bootstrap READ only. A 403 on a mutation is `MutationErrorBanner` (`salesOpsMutationErrorMessage` in `apps/web/src/sales-ops/mutation-error-copy.ts`), keyed on the status like `isForbiddenFailure`.
```

`nexo/knowledge/reference/propostas.md`, append at the end (after the integration-tests bullet):

```markdown
- PC23 (audit `nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`) found `POST /sales`, `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id` and `PUT /settings` with no role gate, so any member could create a proposta already `won` and generate payables, or change the default tax.
  The four financial routes now carry `requireAdmin`, and the settlement routes carry it from birth.
  `POST /sales` could not be gated whole: `SalesOpsApp` mounts `LeadsBoardContainer` with `onRequestConversion` on `meus-dados/leads` too, and `saveLeadConversion` posts the proposta, so a seller converting their own lead must keep reaching it.
  The wizard only ever sends `draft` or `open` (`createPayload(status: 'draft' | 'open')`), so refusing `status: 'won'` from a non-admin costs no legitimate flow.
  The refusal is decided on the RAW body before `CreateSaleSchema` runs, so a non-admin asking for `won` never gets a validation error back and never reaches `createSale`.
  Both decisions read `hasAdminRole` in `require-admin.ts`, and both answer `ADMIN_ROLE_REQUIRED_BODY`, so the gate has one predicate and one body.
  There is no seller-only identity in `packages/auth-fake` (every roster entry yields the full-access set), so the non-admin cases are exercised by setting `userRole` on the Hono context in `financial-admin-gate.test.ts`.
- A 403 from one of those mutations is a refused ACTION, not a refused APP, so it renders `MutationErrorBanner` on the current screen, scoped to the view it happened on, and never `ForbiddenPanel`, which replaces the whole screen and belongs to the bootstrap read.
  In the UI the buttons are already unreachable for a non-admin (`operacional` is admin-only and `SalesView.canManage` now also requires `profile.roles.includes('admin')`), so the banner is what an operator sees when the Hub revoked their admin role while their cached token still said admin.
  Oracles: `financial-admin-gate.test.ts`, `mutation-error-banner.test.tsx`, `financial-mutation-forbidden.test.tsx`.
- `sales_ops_settings.currency` is locked to `BRL`: `SettingsSchema` declares `z.literal('BRL').default('BRL')`, so `PUT /settings` with `USD` is a 400, and `Configurações > Financeiro` shows `Real (BRL)` as read-only text instead of a picker.
  The setting never had an effect (every formatter hard-codes BRL), and BRL is a precondition of the Finance sync.
  The field stays visible because it states what every number on the screen is in; removing it would also leave the `Imposto padrão %` row half empty.
  Legacy rows are not migrated: every save now writes `BRL`, and a data-only `UPDATE` in a migration would run with no org context against a FORCE RLS table and could match nothing without failing.
  Any future reader of the currency, the sync's precondition included, must treat it as the constant BRL and never branch on the stored column.
  Oracles: `settings currency is locked to BRL` in `financial-admin-gate.test.ts` and `settings-currency-brl.test.tsx`.
```

`nexo/knowledge/reference/auth-model.md`, append:

```markdown
- The 403 half of the deny taxonomy renders `ForbiddenPanel` only for the shell's bootstrap read and for `CadastroHistoryPanel`'s own read.
  A 403 on a MUTATION (PC23's `requireAdmin` on the financial proposta and settings routes) renders `MutationErrorBanner` on the current screen, because refusing one action must not unmount a screen whose reads all succeeded.
  `salesOpsMutationErrorMessage` keys the 403 on the status, like `isForbiddenFailure`, never on the body.
```

Also change the CLAUDE.md bullet `- Leaving \`won\` voids only ...` only if slice 06 has not already; that rule belongs to slice 06, so this slice leaves it alone.

## Security notes

- The gate reads only the verified context (`userRole` set by `appAuthMiddleware` from the Hub token); nothing in any body can make a caller admin.
- `requireAdmin` runs before the id check on the three `:id` routes, so a non-admin cannot probe sale ids through 404 versus 409.
- The won check on `POST /sales` runs before validation, so a non-admin learns nothing about the schema from a `won` request.
- Tenant scoping is unchanged: every handler still passes `c.get('orgId')`, and the new admin tests assert it.
- A revoked admin with a cached token keeps admin until the token expires (at most the token lifetime); that is the existing property of every `requireAdmin` route and is out of scope.

## Contract deviations

None.
H4 is confirmed by the code: sellers really reach `POST /sales` through lead conversion on `meus-dados/leads`, and the wizard never sends `won`.
One addition beyond C1-C8: `apps/web/src/sales-ops/mutation-error-copy.ts` exports `salesOpsMutationErrorMessage(error: unknown): string` and `MUTATION_ERROR_COPY`, and `MutationErrorBanner.tsx` exports `MutationErrorBanner({ error, onDismiss })`.
RESOLVED by plan-check (contract H7): slice 08 extends `MutationErrorBanner` with an optional `lines?: readonly string[]` prop that names the blocking rows of a `409 sale_has_active_settlements`, and does NOT add a second page-level error component; the settlement dialogs keep their own in-dialog message (`settlementErrorMessage`), whose 403 line is `MUTATION_ERROR_COPY.adminRequired`.

## Decisions for AUDIT

- D07-1: `POST /sales` refuses `status: 'won'` from a non-admin on the RAW body, before validation (403 even for an otherwise invalid body). Chosen over "parse first" so a non-admin never reaches schema feedback on a financial request.
- D07-2: the settings currency is shown read-only as `Real (BRL)` rather than removed, because it is a real fixed property of the ledger and the Finance precondition, and it keeps the form row balanced.
- D07-3: no data migration for legacy non-BRL `currency` values; they are tolerated on read and rewritten on the next save, and every future reader treats currency as the constant BRL. No DB CHECK constraint is added (it would be DDL, which slice 03 owns, and it would fail on any legacy row).
- D07-4: a 403 on a financial mutation renders an in-page pt-BR banner on the current view and never `ForbiddenPanel`; the banner also carries the C5 `sale_has_active_settlements` line for transition and cancel-contract.
- D07-5: `SalesView.canManage` additionally requires `profile.roles.includes('admin')`, mirroring `canManageCadastros`, so the UI never offers an action the API will refuse.
- D07-6: `finder` and `undefined` roles are treated exactly like `seller` (non-admin) on every gated route.

## Out of scope

- The settlement routes and their gate (slice 06), the settlement UI and its error lines (slice 08), the wizard's blocked-row message (slice 05).
- Any change to `transitionSale`, `cancelContract`, `updateSale` behaviour or their 409 codes (slices 04 and 06).
- A finer "financial operator" role; PC23's recommendation allows it, H4 chose `requireAdmin`.
- Any DDL or migration, any change to `getSettings`, the Drizzle schema, or the seed.
- Gating other cadastro writes (`/products`, `/clients`, `/areas`) that PC23 does not list.
- Any integration code (outbox, feed, events, external ids, Hub or Finance calls).
