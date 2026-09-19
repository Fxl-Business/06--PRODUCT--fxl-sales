---
id: 04-web-data-layer
milestone: v4.1.0
status: done
depends_on: [03-api-leads]
files_modified:
  - apps/web/src/lib/query-keys.ts
  - apps/web/src/sales-ops/leads/types.ts
  - apps/web/src/sales-ops/leads/api.ts
  - apps/web/src/sales-ops/leads/calculations.ts
  - apps/web/src/sales-ops/leads/optimistic.ts
  - apps/web/src/sales-ops/leads/hooks.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-calculations.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-optimistic.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-move-rollback.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts
acceptance: "given a board whose column holds [L1, L2, L3] and an operator drags L2 to index 0 of that same column, when the API rejects the move, then L2 is back at index 1 of that same column with its original position value and its original stageChangedAt, and the board renders exactly the order it had before the drag."
goal: The web half's lead data plumbing - types, api client, query keys, pure board derivations, hooks and the optimistic move with exact stage-and-position rollback - with no screen.
must_not_break:
  - apps/web/src/sales-ops/navigation.ts stays BYTE-UNCHANGED by this slice.
  - apps/web/src/sales-ops/SalesOpsApp.tsx stays BYTE-UNCHANGED by this slice (no import, no screen, no view id).
  - apps/web/src/sales-ops/types.ts, api.ts, hooks.ts and optimistic.ts stay BYTE-UNCHANGED - leads get their own directory, they do not extend the sale files.
  - SalesOpsBootstrap gains no key, and nothing in this slice reads or writes queryKeys.salesOps.bootstrap().
  - The existing queryKeys entries are byte-unchanged; the only edit to query-keys.ts is an ADDED top-level `leads` group.
  - No `useMutation` import outside app-mutation.ts; every new mutation goes through `useAppMutation` with a non-empty `invalidates`.
  - No `(await getToken()) ?? ''` anywhere; every request takes a token from `requireToken(getToken)`.
rules:
  - Every exported symbol 05, 06 and 08 could possibly need is exported NOW. Those slices must not have to edit a file in this slice's files_modified list.
  - No JSX, no component, no `.tsx` source file in this slice. Test files may be `.ts` only - the hook oracle uses `createElement` + `renderToString`, exactly as apps/web/src/admin/products/__tests__/useProducts.test.ts does, so no `.tsx` is needed anywhere.
  - Pure functions live in calculations.ts / optimistic.ts and import only types. Hooks hold no logic beyond wiring.
  - `select` functions are hoisted to module scope (house rule, see selectSalesOpsBootstrap in apps/web/src/sales-ops/hooks.ts) - an inline arrow defeats TanStack's per-selector memo.
  - Integer CENTS everywhere for money; the field name says "estimated".
  - No raw id reaches a user-facing string helper in this slice (there are none here; 06 owns labels).
verifier_focus: "The rollback oracle. Confirm `restores the lead's exact previous index inside its own column when a reorder fails` fails when onError is deleted AND fails when onError is weakened to restore only `stageId` - it must assert the POSITION came back, not just the column. Second: confirm no file outside apps/web/src/sales-ops/leads/ and apps/web/src/lib/query-keys.ts was touched (`git diff --stat`), and that navigation.ts and SalesOpsApp.tsx are byte-identical to their pre-slice blobs."
---

# 04 - web data layer for leads

No screen. This slice is everything a Kanban board needs to exist except the board: the wire
types, the client, the keys, the pure board math, the hooks, and the optimistic move whose
rollback is the whole point.

---

## 0. Read these before writing a line

In this order, and actually read them - the plan below is written against them:

| file | why |
|---|---|
| `apps/web/src/sales-ops/types.ts` | the wire-type house style (`SalesOpsSaleItem`'s `productId: string \| null` + `productNameSnapshot` is the exact shape the lead product mirrors) |
| `apps/web/src/sales-ops/api.ts` | the `salesOpsApi` object style: `(payload, token)`, `apiFetch<T>(path, {method, token, body})` |
| `apps/web/src/sales-ops/hooks.ts` | `useAppMutation` + `invalidates`, the hoisted `select`, and `useOptimisticBootstrapWrite`'s four-phase shape |
| `apps/web/src/sales-ops/optimistic.ts` | the `{next, previous, rowId}` patch contract and the `reconcileOptimisticRow` seam. **Extend this pattern. Do not invent a second one.** |
| `apps/web/src/lib/require-token.ts` | `requireToken` / `assertBearerToken`; a missing token is never defaulted |
| `apps/web/src/lib/query-keys.ts` | the single repo-wide key factory, and why keys are account- and org-agnostic |
| `apps/web/src/admin/products/__tests__/useProducts.test.ts` | the EXACT harness this slice's decisive oracle copies: `createQueryClient` / `captureXMutation` via `renderToString` / `createDeferred` / `flushPromises`, and `restores the previous list cache when create fails` |
| **the shipped slice 03 code** (`apps/api/src/domains/sales-ops/leads/`) | the real wire contract |

### The one thing this plan cannot know

Slices 01–03 were planned in parallel with this one, so the wire shapes in §1 are this slice's
**stated contract**, derived from the 24 acceptance criteria and the repo's naming conventions.
By the time slice 04 executes, slice 03 is merged and its zod schemas are on disk.

**Executor: read `apps/api/src/domains/sales-ops/leads/` first and reconcile.** Where slice 03
spells a wire field differently, **the wire wins** - change the field name in
`apps/web/src/sales-ops/leads/types.ts` and note it in the exec notes. Where slice 03 did not
ship a field at all, drop it and note it.

Three reconciliations are already DONE in this plan and must not be re-litigated, because they are
structural rather than cosmetic: the stage `kind` is `'normal' | 'conversion' | 'lost'` and there is
no `stageIsReadOnly` (§3, §5); the move body is `{stageId, position, reason?, saleId?}` and
`leadsApi.moveLead` translates to it explicitly (§1, §4); and `GET /leads` is per COLUMN with a
required `stageId`, fanned out inside `useLeadsBoard` into the one flat board cache entry the rest
of this slice is written against (§1, §7).

**The exported WEB symbol names in §2–§6 are NOT negotiable**, because 05, 06 and 08 are planned
against them and cannot edit this slice's files. If a name must change, it changes in the later
slice, never here.

---

## 1. The wire contract this slice consumes

### `GET /api/v1/sales-ops/lead-stages`
`200 {stages: LeadStageWire[]}` - org-scoped, includes archived rows (the board needs an archived
stage's name to label a card still sitting in it; 05 filters for its own list).

```
LeadStageWire = {
  id: string; orgId: string; name: string;
  position: number;                      // integer, ascending, dense per org
  kind: 'normal' | 'conversion' | 'lost';
  isSystem: boolean;
  status: 'active' | 'archived';
  createdAt: string; updatedAt: string | null;
}
```

### `GET /api/v1/sales-ops/leads?stageId=<uuid>&limit=<n>&cursor=<opaque>&sellerPersonId=<uuid>`
`200 {leads: LeadWire[], nextCursor: string | null, total: number}` - keyset pagination, the same
`{rows, nextCursor}` shape already in `apps/web/src/sales-ops/cadastro-history.ts`.

**`stageId` is REQUIRED.** Slice 03 declares it as a non-optional `uuid` on
`ListLeadsQuerySchema` and states why in its §3.7: the list is per COLUMN, its cursor is the literal
pair `"<position>:<uuid>"`, and a board-wide read would need a three-part cursor for no gain. A
request without `stageId` is a `400 validation_error`. §7 below is what turns that per-column
endpoint into the ONE flat board cache entry the rest of this slice is written against - read it
before writing `api.ts`, because the fan-out lives in the hook and NOT in `listLeads`.

`total` is returned by the API and is deliberately not modelled: nothing on the board renders a
server-side count, and a field nobody reads is a field that goes stale.

`sellerPersonId` is an ADMIN-ONLY narrowing filter; a seller's own scope is applied server-side
inside `withTenant` and is never requested by the client (acceptance 15).

```
LeadWire = {
  id: string; orgId: string;
  stageId: string;
  position: number;                      // integer, ascending within the stage
  contactName: string;
  clientId: string | null;               // OPTIONAL link to sales_ops_clients
  companyName: string | null;            // free-text fallback
  estimatedValueBrl: number;             // integer CENTS
  description: string | null;
  sellerPersonId: string | null;
  sellerNameSnapshot: string | null;
  lostReason: string | null;
  stageChangedAt: string;                // ISO; moves ONLY on a stage change
  saleId: string | null;                 // non-null once converted
  saleStatus: 'draft'|'open'|'won'|'lost'|'cancelled' | null;  // mirrored, read-only
  products: LeadProductWire[];
  createdAt: string; updatedAt: string | null;
}
LeadProductWire = { id: string; productId: string | null; productNameSnapshot: string }
```

### `POST /api/v1/sales-ops/leads` · `PATCH /api/v1/sales-ops/leads/:id`
`200 {lead: LeadWire}`.

### `POST /api/v1/sales-ops/leads/:id/move`
Body `{stageId, position, reason?, saleId?}` → `200 {lead: LeadWire}`.

**Those are the WIRE names, and they are not this slice's client-side names.** Slice 03's
`MoveLeadSchema` is `.strict()`, so an unknown key is a `400` with the offending key named. The
client-side `MoveLeadPayload` keeps the UI-facing spellings `toStageId` / `toIndex` (they say
"destination" and "index in the column", which is what the operator picked), and
`leadsApi.moveLead` performs the ONE translation, explicitly, at the single place a body is built:

| client field | wire field |
|---|---|
| `toStageId` | `stageId` |
| `toIndex` | `position` |
| `reason` | `reason` (omitted when null/undefined) |
| `saleId` | `saleId` (omitted when absent) |

`leadId` never enters the body; it is the path segment.

Rejects with `400 validation_error` when the destination stage is `kind: 'lost'` and no `reason`
is present (acceptance 6), with `400 validation_error / sale_required_for_conversion` when the
destination is the `kind: 'conversion'` stage and no `saleId` is present, with
`400 validation_error / sale_not_allowed` for a `saleId` aimed at any other stage, and with
`409 {error:'conflict',reason:'lead_already_converted'}` when the lead already carries a
`sale_id` (acceptance 13).

### `POST /api/v1/sales-ops/lead-stages` · `PATCH /api/v1/sales-ops/lead-stages/:id` · `POST /api/v1/sales-ops/lead-stages/reorder`
`200 {stage: LeadStageWire}` / `200 {stages: LeadStageWire[]}`.
No DELETE verb exists and none is added; archiving is `PATCH {status:'archived'}`, mirroring
`setCadastroStatus`.

---

## 2. `apps/web/src/lib/query-keys.ts` - the ONE shared edit

Add a **new top-level group**, a sibling of `salesOps` / `payouts` / `finderLinks`. Do not touch
any existing entry.

```ts
  /**
   * Leads are deliberately a TOP-LEVEL root and NOT nested under `['sales-ops']`.
   *
   * Every sales-ops write declares `invalidates: [queryKeys.salesOps.all]`, and
   * TanStack invalidates by prefix match. Nesting the board there would make a
   * produto rename, an área archive and every other cadastro keystroke refetch a
   * paginated board of the highest-volume entity in the product - which is the
   * exact cost acceptance 16 gave leads their own paginated endpoint to avoid.
   * The separation is one-directional and intentional: a lead CONVERSION creates a
   * sale, so slice 08's conversion mutation lists BOTH `queryKeys.leads.all` and
   * `queryKeys.salesOps.all`, explicitly and type-checked, rather than relying on a
   * prefix that would also fire in the useless direction.
   *
   * Stages live under the same `['leads']` root on purpose: archiving a stage
   * removes a column, so one `invalidates: [queryKeys.leads.all]` refreshes the
   * cadastro list and the board together.
   *
   * Account- and org-agnostic, exactly like every key in this file: tenant
   * separation is `queryClient.clear()` on logout and on every completed workspace
   * switch (see apps/web/src/auth/react.tsx), never a key segment.
   */
  leads: {
    all: ['leads'] as const,
    board: (filters: LeadBoardFilters) => ['leads', 'board', filters ?? null] as const,
    stages: () => ['leads', 'stages'] as const,
  },
```

`LeadBoardFilters` is declared LOCALLY in this file, beside the existing `CommissionFilters` /
`ConversionFilters` type aliases, and is **not** imported from `sales-ops/leads/types.ts`:
`query-keys.ts` is imported by `admin/`, `finder/` and `lib/` and must not grow an edge into a
sales-ops subtree.

```ts
type LeadBoardFilters = { sellerPersonId?: string } | undefined;
```

`sales-ops/leads/types.ts` declares its own structurally identical `LeadBoardFilters` and exports
it for 05/06. The duplication is two lines and is deliberate; it mirrors `CommissionFilters`,
which duplicates `CommissionStatus`'s consumers the same way.

---

## 3. `apps/web/src/sales-ops/leads/types.ts`

Imports NOTHING except `type { SalesOpsStatus }` from `'../types'` (the five sale statuses a
converted CARD mirrors - re-declaring them would be a second door to one fact).

**Exactly three kinds, and there is no fourth.** Slice 01 is the schema owner: the column is
`kind text NOT NULL DEFAULT 'normal'` with a CHECK over `'normal' | 'conversion' | 'lost'`, and a
partial unique index on `(org_id, kind) WHERE kind <> 'normal'` making the conversion stage and
the Perdido stage each at most one per org. An earlier revision of this plan wrote
`'open' | 'conversion' | 'lost' | 'converted'`; `'open'` and `'converted'` exist in no migration,
no service and no API response, and are gone.

The one consequence worth writing down, because it is what `'converted'` was trying (badly) to
express: **read-only is a property of the CARD, not of the stage.** A card is read-only exactly
when `leadIsConverted(lead)` - i.e. `lead.saleId !== null` - and that card is the one that renders
the `sale.status` mirror and refuses to be dragged (acceptance 13). The single `kind: 'conversion'`
stage is BOTH the door that opens the proposta wizard (acceptance 11) and the column those cards
land in; acceptance 11 and acceptance 13 describe one column, not two. There is therefore **no**
`stageIsReadOnly` in this slice - see §5.

```ts
export type LeadStageKind = 'normal' | 'conversion' | 'lost';

export type SalesOpsLeadStage = { … exactly LeadStageWire … };

export type SalesOpsLeadProduct = {
  /** absent on a row the client just built; present on every persisted row. */
  id?: string;
  productId: string | null;
  productNameSnapshot: string;
};

export type SalesOpsLead = { … exactly LeadWire, with `saleStatus: SalesOpsStatus | null` … };

/** One keyset page. Same shape as CadastroHistoryResponse, for the same reason. */
export type LeadsPage = { leads: SalesOpsLead[]; nextCursor: string | null };

/** The raw TanStack infinite-query cache entry. */
export type LeadsInfiniteData = { pages: LeadsPage[]; pageParams: unknown[] };

/** What `useLeadsBoard().data` hands a screen, after the hoisted select. */
export type LeadBoardModel = { leads: SalesOpsLead[]; hasMore: boolean };

export type LeadBoardFilters = { sellerPersonId?: string } | undefined;

export type LeadStagesResponse = { stages: SalesOpsLeadStage[] };
export type LeadResponse = { lead: SalesOpsLead };
export type LeadStageResponse = { stage: SalesOpsLeadStage };
export type LeadStagesReorderResponse = { stages: SalesOpsLeadStage[] };

/** How many cards one page asks for. */
export const LEADS_PAGE_SIZE = 100;
```

Document on `estimatedValueBrl` that it is integer CENTS and that the name carries "estimated"
because acceptance 2 requires the field name itself to say the number is a guess - it never
reaches `computeSaleFinancials`, `getSalesOpsSummary` or the dashboard.

Document on `stageChangedAt` that it moves ONLY on a stage change (acceptance 7) and is
byte-unchanged by a reorder (acceptance 8), and that `daysInCurrentStage` is the only reader.

---

## 4. `apps/web/src/sales-ops/leads/api.ts`

```ts
import { apiFetch } from '@/lib/api-client';
import type { … } from './types';

type Token = string;

export const LEADS_PATH = '/api/v1/sales-ops/leads';
export const LEAD_STAGES_PATH = '/api/v1/sales-ops/lead-stages';

export type SaveLeadProductPayload = { productId: string | null; productNameSnapshot: string };

export type SaveLeadPayload = {
  id?: string;
  stageId: string;
  contactName: string;
  clientId?: string | null;
  companyName?: string | null;
  estimatedValueBrl: number;
  description?: string | null;
  sellerPersonId?: string | null;
  products: SaveLeadProductPayload[];
};

/**
 * `toIndex` is the destination index INSIDE the destination column, 0-based, as the
 * operator sees it. The server owns the resulting `position` integers; the client
 * never sends one, because two browsers reordering the same column would otherwise
 * race on an absolute value.
 * `reason` is REQUIRED by the API when the destination stage is `kind: 'lost'`
 * (acceptance 6). It is optional on this type because the same payload serves every
 * other destination; slice 06 gates it in the UI before the request is built, and
 * the API answers `400 validation_error` if it ever gets through.
 */
export type MoveLeadPayload = {
  leadId: string;
  toStageId: string;
  toIndex: number;
  reason?: string | null;
  /**
   * REQUIRED by the API iff the destination stage is `kind: 'conversion'`
   * (`400 sale_required_for_conversion` without it), and REFUSED for every other
   * destination (`400 sale_not_allowed`). Optional on this type because one payload
   * serves every destination.
   *
   * Its ONLY producer is slice 08's conversion handler, and it produces it only from a
   * `POST /sales` that already answered `201` - which is exactly why the card can move
   * to the conversion column only after the proposta really exists (acceptance 11).
   * Slice 06's `emitMove` threads it in as `onMoveLead({ ...payload, saleId })` after
   * awaiting `onRequestConversion`. Nothing else in the app may write it.
   */
  saleId?: string;
};

export type SaveLeadStagePayload = { id?: string; name: string; status?: 'active' | 'archived' };
export type SetLeadStageStatusPayload = { id: string; status: 'active' | 'archived' };
export type ReorderLeadStagesPayload = { stageIds: string[] };
export type ListLeadsParams = {
  /** REQUIRED: slice 03's list endpoint is per COLUMN. See §1 and §7's fan-out. */
  stageId: string;
  cursor?: string | null;
  sellerPersonId?: string;
  limit?: number;
};

export const leadsApi = {
  listLeads: (params: ListLeadsParams | undefined, token: Token) => { … },
  saveLead: (payload: SaveLeadPayload, token: Token) => { … },          // POST | PATCH on id
  moveLead: ({leadId, ...body}: MoveLeadPayload, token: Token) => { … },// POST :id/move
  listStages: (token: Token) => { … },
  saveStage: (payload: SaveLeadStagePayload, token: Token) => { … },    // POST | PATCH on id
  setStageStatus: ({id, status}: SetLeadStageStatusPayload, token: Token) => { … }, // PATCH {status} only
  reorderStages: (payload: ReorderLeadStagesPayload, token: Token) => { … },
};
```

Implementation rules, all load-bearing:

1. **Every function takes `token: Token` as its LAST argument and passes it straight into
   `apiFetch`'s `token` option.** `apiFetch` calls `assertBearerToken` before it builds the
   request, so a blank token throws `AuthTokenUnavailableError` instead of becoming an anonymous
   request that reads as a server outage (CLAUDE.md, "A missing access token is never
   defaulted").
2. **Never** `(await getToken()) ?? ''`. The eslint `no-restricted-syntax` rule fails the build.
3. `listLeads` builds its query string with `URLSearchParams`, omitting every absent key, and
   defaults `limit` to `LEADS_PAGE_SIZE`. Do NOT hand-concatenate - `cursor` is opaque and must
   be encoded.
4. `setStageStatus` sends `{status}` and **nothing else** - the same reason `setCadastroStatus`
   does: a stale cached `name` must never ride back as a side effect of archiving.
5. `saveLead` destructures `id` out of the body, exactly as every `salesOpsApi.saveX` does.
6. **`moveLead` builds its body EXPLICITLY, key by key, and never spreads the payload.** Slice 03's
   `MoveLeadSchema` is `.strict()`, so a spread that leaked `toStageId` or `leadId` onto the wire is
   a `400` for every move. The one permitted spelling:

   ```ts
   moveLead: ({ leadId, toStageId, toIndex, reason, saleId }: MoveLeadPayload, token: Token) =>
     apiFetch<LeadResponse>(`${LEADS_PATH}/${leadId}/move`, {
       method: 'POST',
       token,
       body: {
         stageId: toStageId,
         position: toIndex,
         ...(reason ? { reason } : {}),
         ...(saleId ? { saleId } : {}),
       },
     }),
   ```

   Both spreads are CONDITIONAL, and that is not tidiness: `.strict()` rejects an unknown key, and
   sending `reason: null` or `saleId: undefined` against a schema whose members are
   `z.string().optional()` is a shape this repo must not rely on. `reason` is dropped when it is
   `null`, `undefined` or `''`, which is also what keeps a reason typed and then re-targeted at a
   non-lost stage off the wire.
7. `listLeads` sends `stageId` ALWAYS. It is not optional and it is not defaulted; the caller is
   §7's fan-out, which has a real stage in hand.
8. No DELETE verb. Anywhere. Ever.

---

## 5. `apps/web/src/sales-ops/leads/calculations.ts`

Pure. Imports only types. This is where 05, 06 and 08 get every derivation they need, so they
never have to reach into this slice's other files.

```ts
/** Cards in one column, in board order: `position` ascending, `createdAt` as the tiebreak. */
export function leadsInStage(leads: readonly SalesOpsLead[], stageId: string): SalesOpsLead[];

/** Every column at once. Key = stageId. Each value is already `leadsInStage`-ordered. */
export function groupLeadsByStage(leads: readonly SalesOpsLead[]): Map<string, SalesOpsLead[]>;

/** The columns a board draws, in `position` order, archived ones dropped. */
export function boardStages(stages: readonly SalesOpsLeadStage[]): SalesOpsLeadStage[];

/** The single conversion stage, or null. Slice 08's door. */
export function conversionStage(stages: readonly SalesOpsLeadStage[]): SalesOpsLeadStage | null;

/** The terminal negative stage, or null. Slice 06 reads it to demand a reason. */
export function lostStage(stages: readonly SalesOpsLeadStage[]): SalesOpsLeadStage | null;

/** True when this destination demands a non-empty reason (acceptance 6). */
export function stageRequiresReason(stage: SalesOpsLeadStage | undefined): boolean;

/** Acceptance 7. Whole days, floored, never negative, computed from stageChangedAt only. */
export function daysInCurrentStage(stageChangedAt: string, now: Date): number;

/**
 * THE read-only predicate. True once the card has a proposta behind it: that card renders the
 * `sale.status` mirror, offers no move affordance and is not a drag source (acceptance 13).
 */
export function leadIsConverted(lead: SalesOpsLead): boolean;   // lead.saleId !== null
```

**There is deliberately NO `stageIsReadOnly`.** An earlier revision of this plan exported one,
defined as `stage?.kind === 'converted'`, against a stage kind that does not exist. Read-only is a
property of the CARD and not of the column, and `leadIsConverted` is the one place it is asked.
Two predicates for one fact is the drift this repo's own history (`requireHubAuth` vs
`classifyHubAccess`) says to avoid: one would be live and one unreachable, with a green suite over
the dead one. If a later slice wants "is this column the conversion column", that question is
`stage.kind === 'conversion'` and it belongs to slice 06's `stageOpensConversion`, which is a
DIFFERENT question with a different answer: the conversion stage is a legitimate DESTINATION for a
non-converted card (it hands back to the wizard), while a converted card has no destinations at all.

`stageRequiresReason` is `stage?.kind === 'lost'`. It is a one-liner on purpose: the point is that
the question is asked in exactly ONE place, so 06 and 08 cannot drift into per-call-site
`kind === 'lost'` comparisons - the same reason CLAUDE.md routes every função question through
`hasFuncao` and never through a per-call-site slug comparison.

`daysInCurrentStage` returns `Math.max(0, Math.floor((now - Date.parse(stageChangedAt)) / 86_400_000))`.
An unparseable timestamp returns `0`, never `NaN`, because a `NaN` reaches the screen as
"NaN dias".

---

## 6. `apps/web/src/sales-ops/leads/optimistic.ts` - the heart of this slice

This file **extends the pattern in `apps/web/src/sales-ops/optimistic.ts`**: a pure function that
takes the raw cache snapshot plus a payload and returns `{next, previous, …}`, with the hook
writing `next` in `onMutate`, writing `previous` back in `onError`, and reconciling the server row
in `onSuccess`. Read that file. Same contract, different snapshot type.

```ts
export type OptimisticLeadPatch = {
  /** the snapshot to write into the cache during onMutate */
  next: LeadsInfiniteData;
  /** the untouched snapshot, for onError rollback */
  previous: LeadsInfiniteData;
  /** the id of the lead that moved */
  leadId: string;
};
```

### 6.1 The pure core, over a flat list

```ts
export function moveLeadInList(
  leads: readonly SalesOpsLead[],
  payload: MoveLeadPayload,
  now: string,
): SalesOpsLead[];
```

Rules, exactly:

1. Find the lead by `payload.leadId`. **If it is not there, return `leads` unchanged (the same
   array reference).**
2. `sameStage = lead.stageId === payload.toStageId`.
3. Build the destination column as `leadsInStage(leads, payload.toStageId)` with the moving lead
   removed, then splice the moving lead in at `clamp(payload.toIndex, 0, column.length)`.
4. Build the source column as `leadsInStage(leads, lead.stageId)` with the moving lead removed.
   When `sameStage`, steps 3 and 4 are the same column and step 4 is skipped.
5. **Re-densify** `position` to `0 … n-1` over both affected columns, in the order from steps 3
   and 4. Columns that are neither source nor destination are untouched, **by object identity** -
   their rows come out of the function as the exact same objects that went in, so downstream
   `useMemo`s over those columns do not churn.
6. The moved lead's `stageId` becomes `payload.toStageId`.
7. **`stageChangedAt` is rewritten to `now` if and only if `sameStage` is false.** On a pure
   reorder it comes out byte-identical. This is acceptance 7 and 8 and it has its own oracle.
8. `lostReason` is set to `payload.reason ?? null` **only when the stage actually changed**;
   a reorder never touches it.
9. Return the full list, in the **same array order as the input** (rows replaced in place by id).
   Page membership and list order are irrelevant to rendering because every reader sorts through
   `leadsInStage`; keeping the order stable is what lets §6.2 map the result back over the pages
   without ever moving a row between pages.

`now` is an ARGUMENT, not `new Date()` inside the function. The function stays pure and the
`stageChangedAt` oracle asserts an exact string rather than fighting a clock.

### 6.2 The snapshot patch

```ts
export function optimisticLeadMove(
  previous: LeadsInfiniteData,
  payload: MoveLeadPayload,
  now: string = new Date().toISOString(),
): OptimisticLeadPatch;
```

Flatten `previous.pages[*].leads`, call `moveLeadInList`, index the result by `id`, then rebuild
`next` as `{pages: previous.pages.map(page => ({...page, leads: page.leads.map(l => byId.get(l.id) ?? l)})), pageParams: previous.pageParams}`.
Page membership and per-page order are preserved exactly; only the four fields in §6.1 change.

If `moveLeadInList` returned the input array unchanged (unknown lead), return
`{next: previous, previous, leadId: payload.leadId}` - handing back the identical object, the same
early-return discipline `withoutOptimisticRows` already uses.

`optimisticLeadMove` deliberately does **not** refuse a converted card. The board refuses it
(06, via `leadIsConverted` inside `moveTargetsFor`) and the API answers
`409 lead_already_converted` (03). A third copy of one policy is a third thing that can drift;
this function's job is the patch, not the permission.

It also deliberately does **not** write `saleId` into the optimistic snapshot, even when the
payload carries one. `saleId` arrives from the server row through `reconcileLeadRow` /
the invalidated refetch. Writing it optimistically would make the card read-only for a beat before
the server has agreed, and a failed move would then have to un-read-only it.

### 6.3 The reconcile seam

```ts
export function reconcileLeadRow(
  snapshot: LeadsInfiniteData,
  persisted: SalesOpsLead,
): LeadsInfiniteData;
```

Replace the row with `persisted.id` wherever it sits, leaving every other row and every page
boundary alone. If no page holds that id, prepend it to the FIRST page (a lead that was just
created). Mirrors `reconcileOptimisticRow`, for the same reason: the server's `position` integers
land before the invalidated refetch arrives, so the card does not visibly hop.

Also export, for 05/06/08:

```ts
export function flattenLeadPages(data: LeadsInfiniteData | undefined): SalesOpsLead[];
export function leadsHasMore(data: LeadsInfiniteData | undefined): boolean; // last page nextCursor !== null
```

---

## 7. `apps/web/src/sales-ops/leads/hooks.ts`

`hooks.ts` imports `boardStages` from `./calculations` for the fan-out below; that is the only
derivation it holds, and it holds it because the fan-out needs to know which columns exist, not
because hooks may grow logic.

```ts
/** Hoisted for TanStack's per-selector memo - see selectSalesOpsBootstrap. */
function selectLeadBoardModel(data: LeadsInfiniteData): LeadBoardModel {
  return { leads: flattenLeadPages(data), hasMore: leadsHasMore(data) };
}
function selectLeadStages(data: LeadStagesResponse): SalesOpsLeadStage[] {
  return Array.isArray(data.stages) ? data.stages : [];
}
```

### Exports

```ts
export function useLeadStages();                    // useQuery, queryKeys.leads.stages()
export function useLeadsBoard(                      // useInfiniteQuery, ONE flat board entry
  stages: readonly SalesOpsLeadStage[],
  filters?: LeadBoardFilters,
);
export function useSaveLead();
export function useMoveLead(filters?: LeadBoardFilters);  // THE optimistic one - see the `boardKey` note below
export function useSaveLeadStage();
export function useSetLeadStageStatus();
export function useReorderLeadStages();
```

### `useLeadsBoard` - one flat cache entry over a PER-COLUMN endpoint

Slice 03's `GET /leads` takes a REQUIRED `stageId` and paginates one column at a time, with the
cursor `"<position>:<uuid>"`. Everything else in this slice - `optimisticLeadMove`,
`reconcileLeadRow`, `moveLeadInList`, `boardKey`, the rollback oracle - is written against ONE
flat `LeadsInfiniteData` holding every visible card, because a move crosses two columns and a
two-cache-entry patch would have to roll back two entries atomically to satisfy acceptance 10.

**The reconciliation is a fan-out INSIDE the query function, and nowhere else.** One page of this
infinite query is one board-wide round of "ask every column for its next slice":

```ts
/** One cursor per stage id. `null` = that column is exhausted (or not started). */
type BoardCursors = Record<string, string | null>;

useInfiniteQuery({
  queryKey: queryKeys.leads.board(filters),
  queryFn: async ({ pageParam }): Promise<LeadsPage> => {
    const token = await requireToken(getToken);
    const cursors = pageParam as BoardCursors | null;
    // Only the columns that still have something to give. On the FIRST page that is
    // every stage the board draws; afterwards it is the ones whose cursor is non-null.
    const wanted = boardStages(stages).filter(
      (stage) => cursors === null || cursors[stage.id] != null,
    );
    const pages = await Promise.all(
      wanted.map(async (stage) => ({
        stageId: stage.id,
        page: await leadsApi.listLeads(
          {
            stageId: stage.id,
            cursor: cursors?.[stage.id] ?? null,
            sellerPersonId: filters?.sellerPersonId,
          },
          token,
        ),
      })),
    );
    const next: BoardCursors = {};
    for (const { stageId, page } of pages) next[stageId] = page.nextCursor;
    return {
      leads: pages.flatMap(({ page }) => page.leads),
      // The board-wide cursor is the whole map, and it is `null` - meaning "done" -
      // exactly when every column is done. Encoded as an object rather than a string
      // because it never reaches the wire: `listLeads` sends the per-column string.
      nextCursor: Object.values(next).some((cursor) => cursor !== null)
        ? (next as unknown as string)
        : null,
    };
  },
  initialPageParam: null as BoardCursors | null,
  getNextPageParam: (lastPage: LeadsPage) =>
    (lastPage.nextCursor as unknown as BoardCursors | null),
  enabled: stages.length > 0,
  select: selectLeadBoardModel,
});
```

Four things about that, each of which is a decision:

- **`LeadsPage.nextCursor` stays `string | null` on the TYPE**, because that is the wire shape and
  `api.ts` models the wire. The board-wide value is a cursor MAP carried in the same slot, cast at
  the two places above and read nowhere else. If that cast offends, widen `LeadsPage.nextCursor`
  to `string | BoardCursors | null` in `types.ts`; do NOT introduce a second page type, because
  `flattenLeadPages` / `leadsHasMore` / `reconcileLeadRow` all key on this one.
- **`enabled: stages.length > 0`.** Without the stage list there is no `stageId` to send, and
  slice 03 answers `400` to a request without one. The container calls `useLeadStages()` first and
  hands the result in; until it resolves the board query does not run and the screen shows the
  Skeleton it already shows.
- **The fan-out is `Promise.all`, not sequential.** Columns are independent and the board is one
  screen; serialising them would make the first paint wait on the slowest column times N.
- **A stage archived between two pages simply drops out of `wanted`.** `boardStages` filters
  archived columns, so its cards stop being requested; the ones already in the cache stay until the
  next invalidation, which is correct - a card sitting in a just-archived column is still a card.

`useInfiniteQuery` and not a page-numbered `useQuery`, because the endpoint is KEYSET-paginated
(`nextCursor`) and a keyset stream has no page numbers to key on. The cursor is the `pageParam`, so
it stays **out of the query key** - which is what lets `onMutate` write into one stable cache entry
instead of hunting for whichever page key happens to hold the card.

`hasMore` is therefore board-wide: `Carregar mais leads` (slice 06's footer) asks every unfinished
column for one more slice. Per-column "carregar mais" was rejected here rather than forgotten: it
would need one cache entry per column, and acceptance 10's exact revert would then span two of
them.

### `useMoveLead` - the four phases

Follows `useOptimisticBootstrapWrite` step for step:

```ts
export function useMoveLead(filters?: LeadBoardFilters) {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useAppMutation<LeadResponse, Error, MoveLeadPayload, OptimisticLeadPatch | undefined>({
    mutationFn: async (payload) => leadsApi.moveLead(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
    onMutate: async (payload) => {
      // An in-flight page fetch must not land on top of the optimistic write.
      await queryClient.cancelQueries({ queryKey: queryKeys.leads.all });
      const previous = queryClient.getQueryData<LeadsInfiniteData>(boardKey);
      if (!previous) return undefined;
      const patch = optimisticLeadMove(previous, payload);
      queryClient.setQueryData(boardKey, patch.next);
      return patch;
    },
    onError: (_error, _payload, patch) => {
      if (!patch) return;
      queryClient.setQueryData(boardKey, patch.previous);   // ← the whole slice
    },
    onSuccess: (response, _payload, patch) => {
      if (!patch) return;
      const current = queryClient.getQueryData<LeadsInfiniteData>(boardKey);
      if (!current) return;
      queryClient.setQueryData(boardKey, reconcileLeadRow(current, response.lead));
    },
  });
}
```

**`boardKey` problem, and its answer.** `useMoveLead` is called from a board that may be
filtered, so it cannot hardcode `queryKeys.leads.board(undefined)`. `useMoveLead` therefore takes
the SAME filters the board was opened with:

```ts
export function useMoveLead(filters?: LeadBoardFilters)
```

and `const boardKey = queryKeys.leads.board(filters)` is computed once per render. 06 passes the
identical `filters` object it passed to `useLeadsBoard`. Document this coupling at the top of the
hook in one sentence: *"the mutation patches the cache entry the board is reading, so both must be
given the same filters; a mismatch degrades to no optimistic write at all (the `!previous` early
return), never to a patch written into a cache entry nobody renders."* That degradation direction
is why the early return exists and why it must not be replaced by a `getQueriesData` sweep across
every board key - patching a filtered board the operator cannot see is how a card appears twice.

Rolling back by writing `patch.previous` whole is what satisfies acceptance 10 **exactly**: the
previous snapshot carries every row's previous `stageId` AND its previous `position` AND its
previous `stageChangedAt`, so the revert is total by construction rather than by a field list
somebody has to remember to extend.

### The other mutations

All plain `useAppMutation`, `invalidates: [queryKeys.leads.all]`, no optimistic write:

- `useSaveLead` - the server assigns `position`, `stageChangedAt` and the product row ids; the
  client cannot compute the persisted row. Same reasoning as `useSaveSalesOpsProduct`'s comment.
- `useSaveLeadStage`, `useSetLeadStageStatus`, `useReorderLeadStages` - low-frequency admin
  writes on a small list behind a `Atualizando` indicator; an optimistic reorder would buy
  nothing and would need a second patch family.

Write that reasoning as a comment on each, in the register `hooks.ts` already uses. A hook with
no optimistic write and no comment saying why is the thing this repo's style forbids.

---

## 8. Tests

All four files under `apps/web/src/sales-ops/leads/__tests__/`. Vitest `environment: 'node'`
(`apps/web/vitest.config.ts`), include pattern `src/**/__tests__/**/*.test.ts` - these match.
**No `.tsx` anywhere in this slice**: the hook oracle uses `createElement` + `renderToString`,
which is exactly what `apps/web/src/admin/products/__tests__/useProducts.test.ts` does in node.

### Command

```bash
pnpm --filter @fxl-sales/web test src/sales-ops/leads
```

(`test` is `vitest run` - run-once, never a watcher.)

### 8.1 `leads-calculations.test.ts`

| test title | decisive against |
|---|---|
| `orders a column by position and breaks a tie on createdAt` | replacing the sort with input order |
| `boardStages drops archived stages and orders the rest by position` | returning `stages` unfiltered |
| `conversionStage and lostStage find the stage by kind, never by name` | a `name === 'Perdido'` implementation, which acceptance 5 kills the day an admin renames the stage |
| `stageRequiresReason is true only for the lost stage` | returning `true` for every terminal stage |
| `leadIsConverted is true exactly when the lead carries a saleId` | returning `false` always, which would let 06 offer a move affordance on a converted card, or keying the predicate on the STAGE instead of the lead - assert a non-converted lead sitting in the `kind: 'conversion'` stage is NOT converted and a converted lead is, so a stage-keyed implementation goes red |
| `daysInCurrentStage counts whole days from stageChangedAt and never returns NaN` | `Date.parse` of an unparseable value leaking `NaN` onto a card |

### 8.2 `leads-optimistic.test.ts` (pure)

| test title | decisive against |
|---|---|
| `moves a lead to another column at the requested index and densifies both columns` | an implementation that sets `stageId` and leaves `position` alone |
| `stamps a new stageChangedAt only when the destination stage differs` | writing `now` on every move - the acceptance-7 "days parked" counter would reset on every drag |
| `leaves stageChangedAt byte-identical when the move is a reorder inside the same column` | **the same mutation, from the other side**; this is acceptance 8 and it is the one that catches a "just always stamp it" shortcut |
| `leaves untouched columns identical by reference` | rebuilding every row and churning every downstream useMemo |
| `clamps an out-of-range toIndex to the ends of the destination column` | a splice at index 99 silently appending, or at -1 corrupting the order |
| `returns the identical snapshot when the lead is not in the cache` | a crash on `undefined.stageId` when a card was filtered out between render and drop |
| `reconcileLeadRow replaces the row in place and leaves every page boundary alone` | a reconcile that appends a duplicate |

### 8.3 `leads-move-rollback.test.ts` - **THE ORACLE**

Harness copied from `useProducts.test.ts`: `createQueryClient()` (retry off),
`captureMoveLeadMutation(queryClient, filters)` via `createElement` + `renderToString`,
`createDeferred<LeadResponse>()`, `flushPromises()`. Mock `@/auth/react`'s `useAccessToken` to
return a real token and mock `../api`'s `leadsApi.moveLead`.

Seed `queryKeys.leads.board(undefined)` with a one-page `LeadsInfiniteData` whose stage `S1`
holds `L1(position 0)`, `L2(position 1)`, `L3(position 2)` and whose stage `S2` holds `L9`.

**Named oracle tests:**

1. **`restores the lead's exact previous index inside its own column when a reorder fails`**
   Move `L2` to `toIndex: 0` of `S1`. After `flushPromises`, assert the column reads
   `['L2','L1','L3']` with positions `[0,1,2]` (the optimistic write happened - a test that
   cannot see the write cannot prove the rollback). Reject the deferred. Then assert:
   - `leadsInStage(flattenLeadPages(cache), 'S1').map(l => l.id)` is **exactly** `['L1','L2','L3']`
   - `.map(l => l.position)` is **exactly** `[0,1,2]`
   - `L2.stageId === 'S1'` and `L2.stageChangedAt` equals the original string
   **Decisive against two distinct mutations, which is why this is the named one:**
   (a) deleting `onError` entirely - the column stays `['L2','L1','L3']`, red;
   (b) weakening `onError` to restore only the moved lead's `stageId` - the stage was never
   wrong on a reorder, so a column-only assertion would still pass, but the ORDER and the
   `position` integers are still `[L2,L1,L3]`, red.
   A cross-column test alone cannot catch (b). This one is the reason the acceptance line says
   "previous in-column position".

2. **`restores the previous stage and the previous index when a cross-column move fails`**
   Move `L2` to `S2` at `toIndex: 0`. Assert the optimistic state, reject, then assert `L2` is
   back in `S1` at index 1 with `position 1`, that `S1` reads `['L1','L2','L3']` with
   `[0,1,2]`, and that `S2` reads `['L9']` with `[0]` - the destination column is restored too.
   Decisive against a rollback that repairs only the source column.

3. **`keeps the server's row and drops nothing else when the move succeeds`**
   Resolve with a `lead` whose `position` is `1` (the server disagreed with the client's `0`).
   Assert the cache holds the SERVER's position, not the optimistic one, and that `L1`, `L3`
   and `L9` are still present exactly once each. Decisive against a reconcile that appends a
   duplicate or that keeps the optimistic row.

4. **`invalidates the leads root on failure as well as on success`**
   `vi.spyOn(queryClient, 'invalidateQueries')`; assert `{queryKey: ['leads']}` after the
   rejection. Decisive against dropping `invalidates` or moving it onto `onSuccess` - a rolled
   back board must re-sync with the server, and this is the line that makes a stale rollback
   self-heal.

5. **`never writes into the sales-ops cache entry`**
   Seed `['sales-ops','bootstrap']` with a sentinel object, run a failing move and a succeeding
   move, and assert the sentinel is `toBe`-identical afterwards. Decisive against a copy-paste
   from `useOptimisticBootstrapWrite` that still patches the bootstrap - which would be a lead
   value reaching the dashboard's snapshot (acceptance 17).

### 8.4 `leads-api-contract.test.ts`

Mock `@/lib/api-client`'s `apiFetch` and assert call shapes.

| test title | decisive against |
|---|---|
| `every leads endpoint sends the bearer token it was given` | a call that drops the `token` option and silently becomes anonymous |
| `refuses a blank bearer token before any request is built` | drive the REAL `apiFetch` (unmocked, with `fetch` stubbed) with `''` and assert `AuthTokenUnavailableError` and that the `fetch` stub was never called. Mirrors `apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx`. Decisive against reintroducing a defaulted token |
| `setStageStatus sends only the status key` | a body that carries a stale cached `name` |
| `listLeads encodes the cursor and omits absent params` | hand-concatenation, which corrupts an opaque cursor containing `&` or `+` |
| `moveLead posts to the lead's own move path and never to a transition path` | a copy-paste onto `/sales/:id/transition`, which would materialize payables from a drag (acceptance 13) |
| `the leads query keys are account- and org-agnostic` | a literal assertion that `queryKeys.leads.all` is `['leads']`, `queryKeys.leads.stages()` is `['leads','stages']` and `queryKeys.leads.board({sellerPersonId:'x'})` is `['leads','board',{sellerPersonId:'x'}]`. Decisive against a key that folds in an orgId or an accountId, which would survive `queryClient.clear()`'s purpose and is the one key mistake CLAUDE.md names explicitly |

---

## 9. Deliberately out of scope

- **Any component, any `.tsx` source file.** 05 draws the stage cadastro, 06 draws the board.
- **`navigation.ts`, `resolveSalesOpsRoute`, `buildSalesOpsPath`, `SalesOpsApp.tsx`.** 07 mounts.
- **The conversion flow.** 08 owns it. This slice exports `conversionStage()` and `useSaveLead` /
  `useMoveLead` so 08 has every seam it needs and edits nothing here.
- **The drag-and-drop dependency.** It enters in 06, pinned exactly, justified in the commit.
- **Any optimistic write for lead CREATE.** The server assigns `position`, `stageChangedAt` and
  product-row ids; the client cannot build the persisted row, and guessing a `position` is how a
  brand-new card flickers into the middle of a column.
- **A "load every page" convenience.** 06 decides whether it calls `fetchNextPage` eagerly or
  renders a `Carregar mais`; that is a screen decision.
- **Anything touching `/bootstrap`, `getSalesOpsSummary`, the dashboard or
  `computeSaleFinancials`.** Test 8.3.5 is the standing guard.
