---
id: 04-history-and-restore-in-configuracoes
milestone: v2.4.0
status: todo
depends_on: [02-org-scoped-history-read, 03-archive-affordance]
files_modified:
  - apps/web/src/sales-ops/cadastro-history.ts
  - apps/web/src/sales-ops/CadastroHistoryPanel.tsx
  - apps/web/src/sales-ops/api.ts
  - apps/web/src/sales-ops/hooks.ts
  - apps/web/src/lib/query-keys.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx
acceptance: "given an org whose ledger holds cadastro archive and restore events, when an admin opens Cadastros > Configurações, then a reverse-chronological 'Histórico de arquivamentos' card fed by GET /api/v1/sales-ops/history?limit=50&action=cadastro.archived,cadastro.restored names the actor by actorDisplayName (or 'Autor não identificado' over a muted-monospace account id when it is null), the event as Arquivou/Restaurou, the cadastro by its live name with the ledger's entityLabel disclosed as 'antes:' when it differs, and the instant in pt-BR; offers Restaurar only on a cadastro.archived event whose entity is still archived and still restorable; issues that restore through useSetSalesOpsCadastroStatus as a status-only PATCH { status: 'active' } to the entity's existing endpoint; invalidates the ['sales-ops'] cache prefix; and states that the restore is a new ledger entry rather than an undo."
---

# 04 - History and restore in Configurações

Web only.
Surface: the `view === 'geral'` branch of `apps/web/src/sales-ops/SalesOpsApp.tsx`, plus new files, one new read hook and one new api helper.
Touches no per-cadastro list view (slice 03's surface) and nothing under `apps/api/**`.

## 0. THE REAL CONTRACT WITH SLICES 01, 02 AND 03 - READ THIS FIRST

An earlier draft of this plan was written before `02-org-scoped-history-read.md` existed and guessed at four assumptions (A1-A4).
**All four guesses were wrong, and all four have been replaced below with the shipped contract.**
There is nothing left to reconcile: this section is now authoritative, and the tolerance the old draft built to survive an unknown sibling has been deleted along with it.

### C1 - The endpoint

```
GET /api/v1/sales-ops/history?limit=50&action=cadastro.archived,cadastro.restored
```

Mounted on `salesOpsRouter` behind `appAuthMiddleware` and `requireAdmin`, org-scoped by `c.get('orgId')` (slice 02 sections 2.1-2.2).
The segment is `history`, **not** `cadastro-history` and **not** `/admin/audit` - the latter reads through `getAdminDb()` with no `org_id` filter and would leak every tenant (the Frame's "security trap").
Held in `SALES_OPS_HISTORY_PATH` in `apps/web/src/sales-ops/api.ts`.

**The `action` filter is mandatory on this request.** Slice 02's endpoint returns *every* ledger row for the org, `commission.created` and `payout.mark_paid` included. Without the filter a busy org's `limit=50` page would be mostly commissions and the `Histórico de arquivamentos` panel could render empty. Slice 02 accepts `action` as a comma-separated set of up to 10 values (its section 2.4) specifically so this panel can ask for both cadastro actions in one keyset stream.

### C2 - The response envelope

```json
{ "entries": [ ... ], "nextCursor": "1160" }
```

`entries` is ordered by `audit_log.id` **descending (newest first)** - the panel must not re-sort.
`nextCursor` is a decimal string, or `null` on the last page. It is the **only** honest truncation signal and is what the panel's footer reads (section 1.9).

### C3 - The entry shape

```jsonc
{
  "id": "1174",                                     // audit_log.id as a DECIMAL STRING, never a number
  "ts": "2026-08-05T15:04:00.000Z",                 // full ISO instant, UTC
  "action": "cadastro.archived",                    // or "cadastro.restored"
  "entityType": "produto",                          // pt-BR: produto | pessoa | funcao | area
  "entityId": "11111111-1111-4111-8111-111111111111",
  "entityLabel": "FXL Finance",                     // ledger name snapshot, or null
  "actorUserId": "acct_…",                          // Hub account id. DATA, never a label.
  "actorDisplayName": "Cauet Pinciara"              // resolved name, or null
}
```

Three things the old draft got wrong, each now a hard rule:

1. **`action` is `cadastro.archived` / `cadastro.restored`**, not `"<entity>.<verb>"`. Slice 01 deliberately uses two actions and carries the entity on `entityType`, so the verb never encodes the noun. `normalizeHistoryVerb` matches the two literals exactly - there is no tense tolerance, because there is exactly one writer and it is in this feature.
2. **`entityType` is pt-BR and singular without diacritics**: `produto`, `pessoa`, `funcao`, `area` (slice 01's `CadastroEntityTypeSchema`). Not `product`, not `products`, not `sales_ops_products`. `normalizeHistoryEntityKind` matches those four literals exactly.
3. **The actor is TWO FLAT FIELDS, not an object.** There is no `actor: {id, name, email}` and no `email` anywhere in the payload.

These six literals (`cadastro.archived`, `cadastro.restored`, `produto`, `pessoa`, `funcao`, `area`) are a wire contract shared with slice 01. Section 3's test 8 pins them from this side; slice 01's oracle assertion 5 pins them from the other. Nothing type-checks the pair.

### C4 - The actor IS resolved server-side, and here is exactly what to render

The old draft's worry is resolved. Slice 01 snapshots the actor's display name from the **verified token** into `after_jsonb.actorLabel` at write time - the one moment it is knowable, since there is no Hub account directory and `sales_ops_people` has no account-id column - and slice 02 projects it into `actorDisplayName` (its section 4.3, step 0). So a colleague's archive is named, not just your own.

Rendering rules, which together are how this slice satisfies CLAUDE.md's "never render a raw account id" law:

- **`actorDisplayName` is a non-empty string**: render it as the primary label, via `userLabel({ id: actorUserId, name: actorDisplayName })`. `actorUserId` is **not** rendered at all.
- **`actorDisplayName` is `null`**: render the pt-BR primary label **`Autor não identificado`** in the ordinary cell style, and `actorUserId` **beneath it** as muted monospace secondary text (`font-mono text-xs text-muted-foreground`). This is the explicitly permitted operator-screen fallback in CLAUDE.md and in `apps/web/src/lib/displayNames.ts`, and `AuditLogPage.tsx` already uses the same styling.
  **The account id is never the row's headline**, even in this branch. That is the whole distinction: a raw id may appear as forensic secondary text, never as the name of a person.
- `actorUserId === 'system'` renders the pt-BR badge `Sistema` and no id. Slice 01 never writes it for a cadastro entry, so this branch is defensive only; keep it, it costs one line.

### C5 - Restore goes through SLICE 03's hook, and nothing else

The old draft built its own `useRestoreCadastro` fanning out over `saveProduct` / `saveArea` / `saveFuncao` / `savePerson` with `{id, name, status}` bodies. **That is struck.**

Slice 03 ships `useSetSalesOpsCadastroStatus` in `apps/web/src/sales-ops/hooks.ts` and `salesOpsApi.setCadastroStatus` plus the types `SetCadastroStatusPayload`, `CadastroResource` (`'products' | 'people' | 'funcoes' | 'areas'`) and `CadastroStatus` (`'active' | 'archived' | 'inactive'`) in `apps/web/src/sales-ops/api.ts`.
It issues a **status-only** PATCH and already declares `invalidates: [queryKeys.salesOps.all]`.

This slice uses it verbatim. Three reasons, in order of weight:

1. Sending a cached `name` back on a restore can silently overwrite a rename made in another tab. A status-only body cannot.
2. Two restore implementations is two doors to one fact - the shape CLAUDE.md rejects elsewhere.
3. It deletes this slice's entire mutation surface, its `funcaoIds` special case for pessoas, and the old draft's risk 4 (a partial product PATCH) along with it.

`depends_on` therefore includes slice 03. That is also correct on file grounds: both slices edit `api.ts`, `hooks.ts` and `SalesOpsApp.tsx`, so they are not parallel-safe and `waves.sh` must serialize them.

## 1. Design decision and rationale

### 1.1 Where the card lives

The history renders as a **sibling of `SettingsView`** inside the `view === 'geral'` branch, not inside `SettingsView` itself:

```tsx
{view === 'geral' ? (
  <div className="flex flex-col gap-[14px]">
    <SettingsView … />
    <CadastroHistorySection bootstrap={persistedBootstrap} />
  </div>
) : null}
```

Two hard reasons, both verified in the current file:

1. `SettingsView` is keyed on the persisted settings timestamp (`key={bootstrap.settings?.updatedAt ?? bootstrap.settings?.createdAt ?? 'new'}`, line ~1489), so **every settings save remounts it**.
   Nesting the history inside it would restart the history query and blank the table every time an unrelated setting is saved.
2. `SettingsView` returns a single `<form onSubmit={submit}>`.
   A `Restaurar` button inside that form would need `type="button"` forever to avoid submitting the settings form, and an `AlertDialog` nested in a form is a trap nobody should have to remember.

`SettingsView`'s prop signature is therefore unchanged; the whole diff to `SalesOpsApp.tsx` is the wrapper above plus one import.
Rejected alternative: a new `meus-dados`/`operacional` route for the history - the Frame says Configurações, and a fifth Cadastros nav item would contradict CLAUDE.md's fixed route list.

### 1.2 Permission gating: none is added, and that is deliberate

`getVisibleWorkspaces` in `apps/web/src/sales-ops/navigation.ts` pushes `cadastros` **only** when the role set contains `admin`, and `resolveSalesOpsRoute` redirects any other role away from a `cadastros/*` URL.
So `cadastros/geral` is unreachable without `admin`, which is exactly the role `requireAdmin` checks on `PATCH /people/:id` and `PATCH /funcoes/:id` (`apps/api/src/domains/sales-ops/routes.ts` lines 91 and 229; `apps/api/src/middleware/require-admin.ts` compares `c.get('userRole') === 'admin'`).
`PATCH /products/:id`, `/areas/:id` and `/clients/:id` carry no admin gate at all.
Therefore **no restore offered on this screen can 403**, and adding a second in-component role check would be an unreachable branch.
This paragraph is the justification; do not add `useAuthProfile()` to the panel.

### 1.3 Information architecture: flat, reverse-chronological, five columns

**Flat and reverse-chronological (newest first), never grouped by entity.**
The ledger is a hash chain: its order *is* its meaning, and `verifyChain` walks it in id order.
Grouping an archive with its later restore into one visual row would collapse two independent chain entries into one and would read as "the archive was undone", which is precisely the impression law 4 of the Frame forbids.
Rejected alternative: group by entity with the latest state on top - it reads better as a "trash can" but it is a lie about an append-only ledger, and it hides the actor of the earlier event.

Columns, in order (header labels in caps are the existing `tableHeadClass` idiom; the last column is titled `Ações` to match `FuncoesView`):

| Column | Content |
| --- | --- |
| `Quando` | `formatLedgerTimestampBr(entry.ts)` -> `05/08/2026 12:04`, `sales-ops-num` |
| `Quem` | `userLabel({ id: actorUserId, name: actorDisplayName })` as the primary label; when `actorDisplayName` is null, the primary label is `Autor não identificado` and `actorUserId` sits **beneath** it in muted monospace; `Sistema` badge when `actorUserId === 'system'`. See C4 - this column is where the CLAUDE.md identifier law is enforced. |
| `Evento` | `Badge` - `Arquivou` (`neutral`, `bg-[#eeeef1] text-[#6a6a72]`) or `Restaurou` (`bg-[#c9e7cf] text-[#1f7d43]`, the same green `FuncoesView` uses for `Ativa`) |
| `Cadastro` | primary line = the entity name; second muted line = the kind label (`Produto` / `Serviço` / `Área` / `Função` / `Pessoa` / `Cadastro`); third muted line `antes: <entityLabel>` only when the ledger snapshot differs from the live name |
| `Ações` | the `Restaurar` button, or a muted state word, or nothing (section 1.5) |

`Quando` first because the operator scans a history by recency; `Quem` second because "who did this" is the question the Frame was written to answer.

### 1.4 Naming an entity that may since have been renamed

**The live row's current name is the primary label; the ledger snapshot is disclosed underneath when it differs; the raw id is the last resort.**

Resolution order in `resolveHistoryRow`:

1. the live row found in `bootstrap` by `entityId` -> its `name` (or `displayName` for a pessoa). Its current name is what the operator will see in the picker after restoring, so it is the only label that lets them find the thing.
2. otherwise `entry.entityLabel` (the ledger snapshot, `after_jsonb ->> 'label'`, projected by slice 02 section 4.1a).
3. otherwise `entry.entityId`, rendered in **muted monospace** and flagged `entityLabelIsId: true` so the cell can style it. This is the same permitted fallback as the actor column and, unlike the actor, it is genuinely unreachable in practice: no cadastro is ever hard-deleted (`salesOpsRouter` has no DELETE verb), so the live row is always present for an in-org entry.

When 1 applies and the snapshot differs, the row additionally prints `antes: <snapshot>` in muted 12px.
That is what keeps the record honest: the history still states what the thing was called when it was archived, while the actionable label matches today's cadastro.
Rejected alternative: snapshot-only labels (a purist reading of "a ledger records the past").
Rejected because it makes the restore button unusable: after a rename the operator restores a name that exists nowhere in the app, then cannot find it.

The kind label refines `product` to `Serviço` when the live row satisfies `isServiceProduct` from `apps/web/src/sales-ops/calculations.ts` - the single sanctioned place any branch on the Produto/Serviço discriminator happens (CLAUDE.md, "Produtos & Serviços").
Never re-derive it from `openPrice` or from `kind` directly.

### 1.5 When restore is offered - and what a row shows when it is not

`restoreStateFor(row, bootstrap)` returns exactly one of four states.
Restore is offered **only on an archive event whose entity is still archived**, never on every row.

`{ state: 'available', target }` requires ALL of:

1. `row.verb === 'archive'`. A restore entry never offers a restore.
2. `row.kind` is one of the four ledger kinds `'produto' | 'pessoa' | 'funcao' | 'area'`.
3. the live row exists in `bootstrap` for that kind and `!isOptimisticId(row.entityId)` (an `optimistic:` placeholder id would fail the uuid cast on the PATCH path - see `withoutOptimisticRows`; the section is fed `persistedBootstrap`, so this is belt-and-braces).
4. the live row is currently archived: `status === 'archived'` for produto/área/função, `status === 'inactive'` for pessoa (`sales_ops_people.status` is `'active' | 'inactive'`, verified in `apps/api/src/db/schema.ts` line 440).
5. for a função, `isSystem === false`. `vendedor` and `finder` answer `409 funcao_is_system` to any write, so offering it would be a guaranteed failure. Slice 01 makes this state unreachable in the first place - `updateFuncao`'s `is_system` guard returns before any write, so no `cadastro.archived` entry can ever exist for a system função - but the guard stays, because a UI that can offer a guaranteed-409 button is one ledger backfill away from doing so.

The old draft carried a sixth condition (a pessoa needs a non-empty `funcaoIds`, since a person write is a full set replacement and the API rejects an empty set with `funcao_required`). **It is deleted**: the restore is now a status-only PATCH through slice 03's hook (C5), which omits `funcaoIds` entirely, and `planPersonFuncoes` returns `{ kind: 'unchanged' }` when the key is absent. There is nothing to validate.

`target` is a `SetCadastroStatusPayload` built by this table, which is the only place the ledger's pt-BR kind meets slice 03's endpoint vocabulary:

| `row.kind` | `resource` | restore `status` |
| --- | --- | --- |
| `produto` | `products` | `active` |
| `area` | `areas` | `active` |
| `funcao` | `funcoes` | `active` |
| `pessoa` | `people` | `active` |

A restore always writes `'active'`; only the archive direction differs per cadastro, and this slice never archives.

`{ state: 'already-active' }` when 1-3 hold but 4 does not: the cell prints the muted word `Já restaurado`.
This is the answer to "what happens if the operator restores something already restored": **the affordance is simply not there**, and the row says why.
Deliberately NOT a disabled button - a disabled button reads as "temporarily unavailable, try again", which is the wrong story.
It is also what makes the state safe under a stale cache: the button vanishes the moment the invalidated bootstrap refetch lands.

`{ state: 'missing' }` when 1-2 hold but the live row is absent: muted `Registro não encontrado`.

`{ state: 'none' }` for everything else - a restore event, or any `entityType` this build does not recognize: the cell renders nothing at all.

**Cliente does not appear in this history at all, and that is now settled feature-wide.**
`sales_ops_clients` has **no `status` column** (verified: `apps/api/src/db/schema.ts` lines 683-699 - `id, orgId, name, contact, legalName, document, address, legalRepName, legalRepDocument, createdAt, updatedAt`).
This slice and slice 03 each reached that conclusion independently; at plan-check the cliente half was struck from slice 01 too, so **no `cliente` ledger entry is ever written** and the Frame's acceptance criterion 1 was amended to the four status-bearing cadastros.
The `{ state: 'none' }` branch for an unrecognized `entityType` is nonetheless kept and tested (test 8), so that a future `cliente` entry - or any other new kind - renders read-only rather than producing a button that would send an unknown field.

### 1.6 Restore goes through slice 03's status-only writer

No new verb, no new route, and **no new mutation hook in this slice**.

`useSetSalesOpsCadastroStatus` (slice 03, `apps/web/src/sales-ops/hooks.ts`) issues:

```
PATCH /api/v1/sales-ops/<resource>/<id>
{ "status": "active" }
```

with `<resource>` from the table in section 1.5. That is the entire write surface of this slice.

Why status-only rather than the old draft's `{id, name, status}` fan-out over `saveProduct` / `saveArea` / `saveFuncao` / `savePerson`:

- **A cached name is a stale name.** The history panel renders from `persistedBootstrap`; if a colleague renamed the produto in the meantime, a restore that echoes the cached `name` back silently reverts their rename. A body that carries only `status` cannot rename anything, ever.
- Every PATCH schema is `.partial()` (`UpdatePersonSchema`, `UpdateProductSchema`, `UpdateAreaSchema`, `UpdateFuncaoSchema` - `apps/api/src/domains/sales-ops/service.ts` lines 57, 200, 216, 226), so an omitted key is left untouched server-side. Sending `name` was never necessary; the web payload types simply happened to require it.
- It removes this slice's dependency on four separate `salesOpsApi` writers and the pessoa `funcaoIds` special case.

The restore is a NEW ledger entry written by slice 01 on this same PATCH path.
Nothing in this slice deletes, edits or reorders a ledger row, and the UI says so out loud (section 1.8).

### 1.7 Cache invalidation

`queryKeys.salesOps.cadastroHistory(limit)` is `['sales-ops', 'cadastro-history', limit]` - **nested under the `salesOps` prefix on purpose**.
`queryKeys.salesOps.all` is `['sales-ops']`, TanStack invalidates by prefix match, and every existing sales-ops write already declares `invalidates: [queryKeys.salesOps.all]` - including slice 03's `useSetSalesOpsCadastroStatus`.
So one key refreshes the bootstrap AND the history, and a restore performed here, or an archive performed by slice 03 on a list view, both refresh this table **without slice 03 changing a line**.

**Slice 03's plan briefly said this slice must add its history key to that hook's `invalidates` list. It must not, and it does not need to** - the prefix match already covers it, and slice 03's note has been corrected. Adding it would be the only thing forcing slice 03 to know this panel exists, which is exactly what nesting the key under `salesOps` was chosen to avoid. Putting the key at the root (`['cadastro-history']`) is rejected for the same reason.

No optimistic write for the restore: `useOptimisticBootstrapWrite` exists for rows the client can compute in full, and here the operator is looking at a ledger the client cannot append to.
The button shows a spinner while pending and the row settles when the refetch lands, exactly like `useSaveSalesOpsProduct`.

### 1.8 Copy - pt-BR, and the append-only fact is stated on screen

Card title: `Histórico de arquivamentos`.
Card subtitle: `Registro somente-acréscimo: restaurar não apaga o arquivamento, apenas acrescenta um novo evento ao histórico.`
Confirm dialog title: `Restaurar ${kindLabel} "${entityLabel}"?`
Confirm dialog body: `${entityLabel} volta a aparecer como ativo nas listas e nos seletores. O arquivamento continua registrado aqui: restaurar não apaga o evento anterior, acrescenta um novo.`
Confirm actions: `Voltar` (cancel, matching `SalesView`'s existing confirm bar) and `Restaurar`.
Empty state title: `Nenhum arquivamento registrado`.
Empty state text: `Quando alguém arquivar um produto, uma área, uma função ou uma pessoa, o evento aparece aqui com autor, data e a opção de restaurar.`
Loading: `Carregando histórico`.
Error: `Não foi possível carregar o histórico de arquivamentos.`, or `Sua sessão do FXL Hub expirou ou não pôde ser renovada. Atualize a página para entrar novamente.` when `isAuthFailure(error)` (the same split the bootstrap panel already makes at lines ~1404-1421).
Truncation footer, only when `hasMore` (see 1.9): `Mostrando os 50 eventos mais recentes.`

### 1.9 Pagination: none, on purpose - but the truncation signal comes from `nextCursor`

The panel requests `limit=50` once, with the `action` set of C1, and renders what comes back.
The operator's job on this screen is "undo the thing I just archived", which is always near the top of a reverse-chronological list; a pager would introduce a second interaction model on a settings screen that has none, and deep forensics already has `AuditLogPage`.
This is the Frame's YAGNI line; do not add a pager, a date filter or an entity-type filter in this slice.

**`hasMore` is `response.nextCursor !== null`, never `entries.length === CADASTRO_HISTORY_LIMIT`.**
The old draft used the length comparison because it did not know the envelope. Slice 02 fetches `limit + 1` rows precisely so that `nextCursor` is exact (its section 2.5), which means the length heuristic is now strictly worse: it claims truncation on an org whose history is exactly 50 events long and complete. `nextCursor` never lies in either direction.

This is why `normalizeCadastroHistory` returns `{ rows, hasMore }` rather than a bare array - the footer needs a fact that lives beside `entries`, and threading it through the `select` keeps the panel prop-driven and the whole decision in one pure function.

### 1.10 UI-control law compliance

The panel contains **no picker at all** (no filters in v1), so the `<select>`/`<option>`/`<datalist>` ban has nothing to bite on and `Combobox` is not needed.
The panel is not rendered inside a `DialogContent`, so `useInlineLayer` does not apply - that hook exists for absolutely-positioned layers inside a dialog (`Combobox`'s panel, `InfoHint`'s disclosure).
The confirm is a Radix `AlertDialog`, which owns its own Escape handling and contains no inline layer.
**If a future change adds a filter to this panel it MUST be a `Combobox` with `comboboxTriggerClass` (the 40px compact geometry, since no `Input` sits on that row).**
No money is rendered here, so `formatMoneyBrl` is not involved; the only formatting is the timestamp.

## 2. Exact files and changes

### 2.1 NEW `apps/web/src/sales-ops/cadastro-history.ts`

Pure module, no React, no imports from `SalesOpsApp.tsx`.
Mirrors the `calculations.ts` idiom: every decision this screen makes is a pure exported function that a test can call directly.

```ts
import { isOptimisticId } from './optimistic';
import { isServiceProduct } from './calculations';
import type { CadastroResource, SetCadastroStatusPayload } from './api';
import type { SalesOpsBootstrap } from './types';

/** How many events the panel asks for and renders. See the plan, "Pagination". */
export const CADASTRO_HISTORY_LIMIT = 50;

/**
 * The two ledger actions this panel shows, sent to slice 02's endpoint as a
 * comma-separated `action` set. These MUST stay identical to slice 01's
 * CADASTRO_LIFECYCLE_ACTIONS in apps/api/src/domains/audit/service.ts - nothing
 * type-checks the pair, and a third action added there is invisible here until
 * it is added here too.
 */
export const CADASTRO_HISTORY_ACTIONS = ['cadastro.archived', 'cadastro.restored'] as const;

/** The wire shape. Slice 02 section 5 is authoritative; see this plan's C3. */
export type CadastroHistoryEntryWire = {
  id: string;
  ts: string;
  action: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  actorUserId: string;
  actorDisplayName: string | null;
};
export type CadastroHistoryResponse = {
  entries: CadastroHistoryEntryWire[];
  nextCursor: string | null;
};

/**
 * The ledger's entity vocabulary, which is slice 01's pt-BR entity_type verbatim.
 * DELIBERATELY not named CadastroKind: slice 03 exports a DIFFERENT type by that
 * name from SalesOpsApp.tsx ('produto' | 'servico' | 'area' | 'funcao' | 'pessoa'),
 * which splits produto from serviço for confirmation copy. A ledger row cannot make
 * that split - entity_type is 'produto' for both - so the two vocabularies are
 * genuinely different and must not share a name.
 */
export type HistoryEntityKind = 'produto' | 'pessoa' | 'funcao' | 'area';
export type CadastroHistoryVerb = 'archive' | 'restore';

export type CadastroHistoryRow = {
  id: string;
  ts: string;
  rawAction: string;
  kind: HistoryEntityKind | null;
  verb: CadastroHistoryVerb | null;
  entityId: string;
  snapshotLabel: string | null;
  actorUserId: string;
  actorDisplayName: string | null;
};

export type RestoreState =
  | { state: 'available'; target: SetCadastroStatusPayload }
  | { state: 'already-active' }
  | { state: 'missing' }
  | { state: 'none' };

export type ResolvedHistoryRow = CadastroHistoryRow & {
  kindLabel: string;
  eventLabel: string;          // 'Arquivou' | 'Restaurou' | the raw action, muted
  eventIsKnown: boolean;
  entityLabel: string;
  entityLabelIsId: boolean;
  previousLabel: string | null;
  /** '' when actorDisplayName named the actor; otherwise the muted-mono id. */
  actorLabel: string;
  actorLabelIsId: boolean;
  restore: RestoreState;
};

export type CadastroHistoryPage = { rows: CadastroHistoryRow[]; hasMore: boolean };
```

Exported functions, each with a one-paragraph comment in the house voice:

- `normalizeHistoryEntityKind(value: string | null | undefined): HistoryEntityKind | null` - trim, lowercase, then match **exactly** `produto` / `pessoa` / `funcao` / `area`. Everything else, `cliente` included, is `null` and renders read-only. No `sales_ops_` stripping, no plural stripping, no tense tolerance: there is exactly one writer of these values and it is slice 01, in this same feature. The old draft's tolerance was the price of planning against an unwritten sibling and is now dead weight that would only hide a genuine contract break.
- `normalizeHistoryVerb(action: string): CadastroHistoryVerb | null` - match **exactly** `cadastro.archived` -> `'archive'` and `cadastro.restored` -> `'restore'`; everything else `null`. Do not split on `.` and inspect the last segment: the action does not encode the entity, and a `commission.approve` row must resolve to `null`, not to a verb.
- `normalizeCadastroHistory(response: CadastroHistoryResponse | undefined): CadastroHistoryPage` - array-guards `entries`, maps each wire entry, drops entries with no `id` or no `ts`, and sets `hasMore` from `response.nextCursor !== null`. Does NOT sort: slice 02 returns `id DESC` and a client re-sort would silently disagree with the chain order.
- `formatLedgerTimestampBr(iso: string): string` - `new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))`, normalized to `dd/mm/aaaa hh:mm` (drop a comma if the runtime inserts one); returns `iso` unchanged when `Number.isNaN(date.getTime())`. **Comment must say why `formatIsoDateBr` is not reused**: that helper takes a date-only business date and slices the string, so it cannot express a time and would print the UTC day; a ledger entry is a real instant and must be shown in the operator's timezone.
- `restoreStateFor(row: CadastroHistoryRow, bootstrap: SalesOpsBootstrap): RestoreState` - the five conditions of section 1.5, in that order, building a `SetCadastroStatusPayload` from the resource table there.
- `resolveHistoryRow(row: CadastroHistoryRow, bootstrap: SalesOpsBootstrap): ResolvedHistoryRow` - the labelling of section 1.4, the actor rules of C4, plus `restoreStateFor`.

Kind labels: `produto` -> `Produto` (or `Serviço` when the live product satisfies `isServiceProduct` from `./calculations`, the single sanctioned place any branch on that discriminator happens), `area` -> `Área`, `funcao` -> `Função`, `pessoa` -> `Pessoa`, `null` -> `Cadastro`.

**This module must not import `apps/web/src/sales-ops/SalesOpsApp.tsx`** (that would be a cycle) and must not re-declare `CadastroResource` or `SetCadastroStatusPayload` - it imports both as types from `./api`, which slice 03 has already extended.

### 2.2 `apps/web/src/lib/query-keys.ts`

Add one line inside the existing `salesOps` block, keeping `all` first:

```ts
  salesOps: {
    all: ['sales-ops'] as const,
    bootstrap: () => ['sales-ops', 'bootstrap'] as const,
    cadastroHistory: (limit: number) => ['sales-ops', 'cadastro-history', limit] as const,
  },
```

### 2.3 `apps/web/src/sales-ops/api.ts`

This file is also edited by slice 03 (which adds `setCadastroStatus` and its three types). Slice 04 runs after it; keep both hunks.

- `import type { CadastroHistoryResponse } from './cadastro-history';` (types only, no cycle: `cadastro-history.ts` imports only *types* from `api.ts`, and a type-only cycle is erased at compile time - but keep both `import type` to be sure).
- The path constant, with a comment pointing at slice 02:

```ts
/**
 * The TENANT-scoped ledger read (slice 02). Org-scoped by `c.get('orgId')` inside
 * `salesOpsRouter`. It is deliberately NOT `/api/v1/admin/audit`, which reads through
 * `getAdminDb()` with no org filter and would hand one tenant every other tenant's
 * audit trail. The segment is `history`, not `audit`, for exactly that reason.
 */
export const SALES_OPS_HISTORY_PATH = '/api/v1/sales-ops/history';
```

- Add to `salesOpsApi`:

```ts
  /**
   * The `action` set is mandatory: this endpoint returns EVERY ledger row for the
   * org, commissions and payouts included, so without it a busy org's page would be
   * mostly rows this panel does not render. Slice 02 accepts up to 10 comma-separated
   * values for this reason.
   */
  cadastroHistory: (limit: number, actions: readonly string[], token: Token) =>
    apiFetch<CadastroHistoryResponse>(
      `${SALES_OPS_HISTORY_PATH}?limit=${limit}&action=${encodeURIComponent(actions.join(','))}`,
      { method: 'GET', token },
    ),
```

`token` stays a REQUIRED non-empty string; every caller passes `await requireToken(getToken)`.
Never `(await getToken()) ?? ''` - it is banned by `no-restricted-syntax` in `apps/web/eslint.config.js`.

**No other addition.** The old draft's `useRestoreCadastro` needed `saveProduct` / `saveArea` / `saveFuncao` / `savePerson`; the restore now goes through slice 03's `setCadastroStatus` (C5), so this slice adds exactly one api function.

### 2.4 `apps/web/src/sales-ops/hooks.ts`

Add **one** hook at the end of the file, in the existing voice.

```ts
export function useCadastroHistory() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.salesOps.cadastroHistory(CADASTRO_HISTORY_LIMIT),
    queryFn: async () =>
      salesOpsApi.cadastroHistory(
        CADASTRO_HISTORY_LIMIT,
        CADASTRO_HISTORY_ACTIONS,
        await requireToken(getToken),
      ),
    select: normalizeCadastroHistory,
  });
}
```

`select` is the hoisted, module-level `normalizeCadastroHistory` (identity-stable, same reason as `selectSalesOpsBootstrap`) - do NOT inline an arrow. It returns `{ rows, hasMore }`, so `history.data?.rows` and `history.data?.hasMore` are what the section reads.

**No write hook is added by this slice.** The old draft's `useRestoreCadastro` is struck; the restore calls slice 03's `useSetSalesOpsCadastroStatus`, which already exists in this file, already issues a status-only PATCH, and already declares `invalidates: [queryKeys.salesOps.all]`. See C5.

`CADASTRO_HISTORY_ACTIONS` is not part of the query key: it is a build-time constant, so including it would add a dimension that can never vary and would churn the key on any future edit to the list.

### 2.5 NEW `apps/web/src/sales-ops/CadastroHistoryPanel.tsx`

Two exports, following the `ProfessionalSplitPanel.tsx` precedent: a sibling module in `sales-ops/` that declares its own local style constants and never imports from `SalesOpsApp.tsx` (that would be a cycle, since `SalesOpsApp.tsx` imports this file).

Local constants copied verbatim from `SalesOpsApp.tsx` so the card is visually identical to the cadastro tables:

```ts
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass = 'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const tableCellClass = 'px-4 py-3 text-[13.5px] text-[#57575f]';
const neutralBadgeClass = 'bg-[#eeeef1] text-[#6a6a72]';
const activeBadgeClass = 'bg-[#c9e7cf] text-[#1f7d43]';
const restoreButtonClass =
  'inline-flex items-center gap-1.5 rounded-[9px] border border-[#dcdce2] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210] disabled:cursor-not-allowed disabled:opacity-60';
```

Add a short comment saying these are intentional local copies of the `SalesOpsApp.tsx` constants, for the same no-cycle reason `ProfessionalSplitPanel` re-declares nothing it can import.

**`CadastroHistoryPanel`** - pure, prop-driven, directly renderable from a test:

```tsx
export function CadastroHistoryPanel({
  bootstrap,
  entries,
  error,
  hasMore,
  isError,
  isLoading,
  onRestore,
  restoringId,
}: {
  bootstrap: SalesOpsBootstrap;
  entries: CadastroHistoryRow[];
  error: unknown;
  /** From `nextCursor !== null`, never from `entries.length`. See 1.9. */
  hasMore: boolean;
  isError: boolean;
  isLoading: boolean;
  onRestore: (target: SetCadastroStatusPayload, row: ResolvedHistoryRow) => void;
  /** The `entityId` whose restore is in flight, or null. */
  restoringId: string | null;
}) { … }
```

Structure:

- outer `<section className={`${panelClass} overflow-hidden`}>`
- header strip `<div className="border-b border-[#ececf1] px-[22px] py-4">` with `<h3 className="text-[15px] font-bold">Histórico de arquivamentos</h3>` and the append-only subtitle in `mt-1 text-[13px] text-[#8b8b92]`.
- body: loading (`Loader2 animate-spin` + `Carregando histórico`, inside `mutedPanelClass ... m-[22px] p-6`), then error (the `isAuthFailure` split), then the empty block (same muted card, title + text of 1.8), then the `Table`.
- table header row `className="bg-[#fafafb] hover:bg-[#fafafb]"` with the five `TableHead`s of 1.3 (`Quando`, `Quem`, `Evento`, `Cadastro`, `Ações`; the last two centred exactly like `FuncoesView`).
- each row is `resolveHistoryRow(row, bootstrap)`; `key={row.id}`.
- actor cell, per C4. Three mutually exclusive branches, and **the id is never the primary line in any of them**:
  - `row.actorUserId === 'system'` -> the `Sistema` badge, no id.
  - `actorDisplayName` non-empty -> `userLabel({ id: row.actorUserId, name: row.actorDisplayName })` in `text-[13.5px] text-[#201f24]`. The id is not rendered.
  - otherwise -> `<span className="text-[13.5px] text-[#201f24]">Autor não identificado</span>` **and beneath it** `<span className="font-mono text-xs text-muted-foreground">{row.actorUserId}</span>`.

  `userLabel` and `isUserLabelFallback` come from `@/lib/displayNames`; `isUserLabelFallback({ id, name })` is exactly the third-branch predicate, so use it rather than re-deriving the emptiness check.
- entity cell: name in `text-sm font-semibold text-[#201f24]` (or `font-mono text-xs text-muted-foreground` when `entityLabelIsId`), kind label under it in `text-xs text-[#8b8b92]`, and `antes: {previousLabel}` in `text-xs text-[#9b9ba3]` when present.
- action cell by `restore.state`: `available` -> the button (`RotateCcw` icon + `Restaurar`, `aria-label={`Restaurar ${row.kindLabel} ${row.entityLabel}`}`, `type="button"`, disabled and showing `Loader2 animate-spin` while `restoringId === row.entityId`); `already-active` -> `<span className="text-[13px] text-[#8b8b92]">Já restaurado</span>`; `missing` -> `Registro não encontrado` in the same muted style; `none` -> `null`.
- truncation footer when `hasMore`.

**`CadastroHistorySection`** - the container, in the same file:

```tsx
export function CadastroHistorySection({ bootstrap }: { bootstrap: SalesOpsBootstrap }) {
  const history = useCadastroHistory();
  // Slice 03's hook, used verbatim. This slice adds NO mutation of its own (C5).
  const restore = useSetSalesOpsCadastroStatus();
  const [pending, setPending] = useState<{ target: SetCadastroStatusPayload; row: ResolvedHistoryRow } | null>(null);
  …
}
```

It renders `CadastroHistoryPanel` plus the `AlertDialog` confirm (same seven-part composition as `SalesView`'s, lines ~1993-2011: `AlertDialog / Content / Header / Title / Description / Footer / Cancel + Action`).
`entries` is `history.data?.rows ?? []` and `hasMore` is `history.data?.hasMore ?? false`.
`restoringId` is `restore.isPending ? lastTargetId : null`, held in component state alongside `pending`.
`onOpenChange` clears `pending` on close; the `AlertDialogAction` calls `restore.mutate(pending.target)` and then clears `pending`.

The `AlertDialog` is a page-level sibling, not nested inside a `Dialog`, and it contains no `Combobox` and no `InfoHint`, so `useInlineLayer` does not apply (section 1.10).

### 2.6 `apps/web/src/sales-ops/SalesOpsApp.tsx`

Two edits only.

1. `import { CadastroHistorySection } from './CadastroHistoryPanel';` next to the existing `ProfessionalSplitPanel` import.
2. Replace the `view === 'geral'` branch (currently lines ~1487-1494) with the wrapper of section 1.1, passing `bootstrap={persistedBootstrap}` (the optimistic-free snapshot; a restore must never target an `optimistic:` id).
   `SettingsView` keeps its `key` and its three props exactly as they are.

Do not touch `ProductsView`, `AreasView`, `PessoasView`, `FuncoesView` or `ClientsView` - slice 03 owns those.

## 3. The named oracle test

**Path: `apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx`** (vitest, happy-dom).

Harness: copy the house style from `apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx` and `cadastros-refresh.test.tsx`:
`// @vitest-environment happy-dom` first line; `createRoot` + the `React.act` cast; `IS_REACT_ACT_ENVIRONMENT = true` in `beforeEach`; `afterEach` unmounts and `vi.restoreAllMocks()`; the `click(element)` helper dispatching a bubbling `MouseEvent`; the `@/components/ui/alert-dialog` mock from `sales-transition-actions.test.tsx` verbatim (it renders children only when `open` and wires `AlertDialogAction`'s `onClick`).
For the mutation test, add the `vi.mock('@/auth/react', …)` block from `cadastros-refresh.test.tsx` (only `useAccessToken` is needed) and `vi.mock('../api', …)` exposing `cadastroHistory` and `setCadastroStatus`. **No `saveProduct` / `saveArea` / `saveFuncao` / `savePerson`** - this slice does not call them (C5).

Fixtures: one archived produto `FXL Finance` (`status: 'archived'`, uuid `11111111-1111-4111-8111-111111111111`), one active área, one archived função, and a bootstrap builder identical to the one in `areas-view.test.tsx`.
Wire-entry fixture builder producing slice 02's exact shape (C3): `{ id, ts, action: 'cadastro.archived', entityType: 'produto', entityId, entityLabel, actorUserId, actorDisplayName }`, and a response envelope `{ entries, nextCursor: null }`.
Actor fixture `{ actorUserId: 'acct_01HZQ9WV4TESTONLY', actorDisplayName: 'Cauet Pinciara' }`.
Timestamp fixture `'2026-08-05T15:04:00.000Z'` - midday-ish UTC so the rendered pt-BR **date** is `05/08/2026` in every plausible operator timezone; the test asserts the date only, never the hour (documented in a comment).

### Test 1 - `renders actor, action, entity and time without printing a bare id as a label`

Render `CadastroHistoryPanel` with one `cadastro.archived` / `produto` entry, `entityLabel: 'FXL Finance'`, the named actor, and a bootstrap containing the archived produto.

- `expect(text).toContain('Cauet Pinciara')`
- `expect(text).toContain('Arquivou')`
- `expect(text).toContain('FXL Finance')`
- `expect(text).toContain('Produto')`
- `expect(text).toContain('05/08/2026')`
- `expect(text).not.toContain('acct_01HZQ9WV4TESTONLY')` - **the actor id is never printed when a name exists**
- `expect(text).not.toContain('11111111-1111-4111-8111-111111111111')` - **the entity uuid is never printed when a name exists**

### Test 2 - `names the actor 'Autor não identificado' and demotes the id to muted monospace when actorDisplayName is null`

Same entry with `actorDisplayName: null` and `actorUserId: 'acct_unnamed'`.

- `expect(text).toContain('Autor não identificado')` - **the primary label is a phrase, never the account id**
- the id IS present, and the element containing it satisfies
  `expect(el.className).toContain('font-mono')` and `expect(el.className).toContain('text-muted-foreground')`
- the element carrying `Autor não identificado` does **not** carry `font-mono`, so the two lines are genuinely primary and secondary rather than one muted blob
- the row's primary entity label is still `FXL Finance` (the id is never the row's headline)

This is the test that pins the CLAUDE.md UI-identifiers law in both directions. Both branches ship; neither is a degraded outcome to escalate, because slice 01 now snapshots the actor name at write time (C4) and this branch only covers a token that carried neither `name` nor `email`.

### Test 3 - `restores an archived produto through a status-only PATCH and invalidates ['sales-ops']`

Render `CadastroHistorySection` inside a `QueryClientProvider` (`retry: false` for queries and mutations), with `salesOpsApi.cadastroHistory` mocked to resolve `{ entries: [one cadastro.archived produto entry], nextCursor: null }` and `salesOpsApi.setCadastroStatus` mocked to a deferred promise.
`vi.spyOn(queryClient, 'invalidateQueries')` before rendering.

- `expect(vi.mocked(salesOpsApi.cadastroHistory).mock.calls[0]).toEqual([50, ['cadastro.archived', 'cadastro.restored'], expect.any(String)])` - **the action set is actually sent**, which is the contract with slice 02 section 6.2 assertion 6b
- click the button whose `aria-label` starts with `Restaurar Produto FXL Finance`
- the confirm dialog is on screen and its text contains `restaurar não apaga o evento anterior`
- click `Restaurar` in the dialog
- `expect(vi.mocked(salesOpsApi.setCadastroStatus)).toHaveBeenCalledTimes(1)`
- `expect(vi.mocked(salesOpsApi.setCadastroStatus).mock.calls[0]?.[0]).toEqual({ resource: 'products', id: '1111…', status: 'active' })`
  - `toEqual` on the whole object is exact, so this asserts there is **no `name` key** - the guard against a restore silently reverting someone else's rename (C5)
- resolve the deferred promise
- `expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['sales-ops'] }))`
- and, as the behavioural half of the same claim, `expect(vi.mocked(salesOpsApi.cadastroHistory)).toHaveBeenCalledTimes(2)` - the history itself refetched, which is only true because its key sits under the `['sales-ops']` prefix and slice 03's hook invalidates that prefix

### Test 3b - `restores a pessoa with status active, never archived`

One `cadastro.archived` / `pessoa` entry over a bootstrap pessoa with `status: 'inactive'`.

- `expect(vi.mocked(salesOpsApi.setCadastroStatus).mock.calls[0]?.[0]).toEqual({ resource: 'people', id: …, status: 'active' })`
- pins that the pessoa branch maps to `people` and not to `persons`/`pessoas`, and that a restore is always `'active'` regardless of which archived spelling the cadastro stores

### Test 4 - `does not offer restore for an entity that is already active`

Same `cadastro.archived` / `produto` entry, but the bootstrap's produto has `status: 'active'`.

- `expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('Restaurar'))).toBe(false)`
- `expect(text).toContain('Já restaurado')`
- and the row is still rendered in full (`expect(text).toContain('FXL Finance')`) - the event is never hidden, only its action.

### Test 5 - `never offers restore on a restore event`

A `cadastro.restored` / `produto` entry over an archived produto (the pathological combination).

- no `Restaurar` button
- `expect(text).toContain('Restaurou')`

### Test 6 - `shows the live name and discloses the name the cadastro had when it was archived`

Entry `entityLabel: 'FXL Finance'`; the live archived produto is named `FXL Finance Pro`.

- `expect(text).toContain('FXL Finance Pro')`
- `expect(text).toContain('antes: FXL Finance')`

### Test 7 - `shows the empty panel when the org has no archive events`

`entries: []`, not loading, not error.

- `expect(text).toContain('Nenhum arquivamento registrado')`
- no `<table>` in the container.

### Test 8 - pure-function guards (no DOM)

In the same file, a `describe` over `cadastro-history.ts`. **This block is the web half of the wire contract with slice 01**; its literals must match `CadastroEntityTypeSchema` and `CADASTRO_LIFECYCLE_ACTIONS` exactly.

- `normalizeHistoryEntityKind` maps `'produto'`, `'pessoa'`, `'funcao'` and `'area'` to themselves, and maps `'product'`, `'products'`, `'sales_ops_products'`, `'cliente'`, `'área'` and `''` all to `null`. The English and plural spellings are asserted `null` deliberately: they were the old draft's assumption, and pinning them as unrecognized is what stops the tolerance creeping back.
- `normalizeHistoryVerb` maps `'cadastro.archived'` to `'archive'` and `'cadastro.restored'` to `'restore'`; maps `'commission.approve'`, `'payout.mark_paid'`, `'produto.archived'` and `'cadastro.archive'` all to `null`.
- `normalizeCadastroHistory` returns `hasMore: true` for `{ entries: [...], nextCursor: '1160' }` and `hasMore: false` for `nextCursor: null`, **including when `entries.length === CADASTRO_HISTORY_LIMIT`** - the exact case the old length heuristic got wrong (section 1.9).
- `normalizeCadastroHistory` drops an entry with no `id` or no `ts`, and preserves the server's order rather than sorting.
- `restoreStateFor` returns `{ state: 'none' }` for an entry whose `entityType` is `'cliente'`, even when a matching client exists in the bootstrap. Cliente is out of the whole feature and slice 01 writes no such entry, so this pins the read-only fallback for any future unrecognized kind rather than a live case.
- `restoreStateFor` returns `{ state: 'none' }` for a system função (`isSystem: true`, `status: 'archived'`) - pins the `409 funcao_is_system` guard.
- `restoreStateFor` returns `{ state: 'available', target: { resource: 'funcoes', id, status: 'active' } }` for a non-system archived função - the positive control, so the two negatives above are about the guards and not about a branch that never fires.
- `restoreStateFor` returns `{ state: 'missing' }` when the entry's `entityId` matches no bootstrap row, and `{ state: 'none' }` when `isOptimisticId(entityId)`.

## 4. How to run

```bash
pnpm --filter @fxl-sales/web test -- cadastro-history
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

Then an E2E pass against a local API carrying slices 01-03: archive a produto from `cadastros/produtos`, open `cadastros/geral`, confirm the event names you and the produto, click `Restaurar`, confirm the produto is active again in the list AND that the history now shows TWO rows (the archive and the restore) - the archive row must still be there, now reading `Já restaurado`.
Then hit `admin/audit`'s `Verificar cadeia` (or the API's `verifyChain`) and confirm the chain is still valid, which is the Frame's acceptance criterion 5.

## 5. Risks

1. **The six wire literals are unenforced across the API/web boundary.** `cadastro.archived`, `cadastro.restored`, `produto`, `pessoa`, `funcao`, `area` are plain strings on both sides; slice 02 passes them through as free text by design. Nothing type-checks the pair, and a rename on either side degrades silently - the row still lists but renders read-only, with no error anywhere. Test 8 pins them from this side, slice 01's oracle assertion 5 from the other. Highest-probability remaining risk in this slice.
2. **A fifth cadastro action would be invisible here.** `CADASTRO_HISTORY_ACTIONS` is sent as the `action` filter, so an action slice 01 adds later is simply not requested. If `CADASTRO_LIFECYCLE_ACTIONS` grows, this constant must grow on the same commit. Noted in slice 02's risks too.
3. **The actor is named for real, but only for rows slice 01 wrote.** Slice 01 snapshots `after_jsonb.actorLabel` from the verified token, so a colleague's archive resolves. Rows written before this feature have no snapshot; the panel filters to the two cadastro actions, so it never renders one. `actorDisplayName: null` therefore means "the actor's token carried neither `name` nor `email`", not "we could not look it up", and test 2's branch covers it.
4. **Existing suites that `vi.mock('../api')` with an object literal.** `cadastros-refresh.test.tsx` and `routing.test.tsx` mount `SalesOpsApp` but never land on `cadastros/geral`, so `CadastroHistorySection` never mounts and the missing `cadastroHistory` key is never read. If `pnpm test` proves otherwise, add `cadastroHistory: vi.fn()` to that suite's mock literal. Note slice 03 already adds `setCadastroStatus: vi.fn()` to that same literal, so check whether it is present before adding anything.
5. **Timezone-dependent timestamp assertions.** Fixed by asserting the date only, with the fixture at `15:04Z`. Do not assert `12:04`.
6. **Overlap with slice 03 in three files.** Both slices edit `apps/web/src/sales-ops/api.ts`, `hooks.ts` and `SalesOpsApp.tsx`, which is why this slice `depends_on` slice 03 and why they are not parallel-safe. Within `SalesOpsApp.tsx` the hunks genuinely do not overlap (slice 03 edits the list views and the dialogs, this slice edits only the `view === 'geral'` branch and the import block), but in `api.ts` and `hooks.ts` this slice **reads** what slice 03 added, so running out of order is a compile error, not a merge conflict.
7. **`CadastroKind` is declared twice in `apps/web/src/sales-ops/`** - by slice 03 in `SalesOpsApp.tsx` and, in the old draft, by this slice in `cadastro-history.ts`, with different members. This slice's is renamed `HistoryEntityKind` (section 2.1). If the name reappears here, the two will drift and a future reader will import the wrong one.
