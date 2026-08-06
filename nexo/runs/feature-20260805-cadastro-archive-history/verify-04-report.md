# Verify report - slice 04, history and restore in Configurações

- Gate: 2 (Verify)
- Branch: `feat/04-history-panel` (uncommitted working tree)
- Verdict: **PASS**
- Auditor: independent verify sub-agent (did not write this code)

## Scope of the diff audited

Modified: `apps/web/src/lib/query-keys.ts`, `apps/web/src/sales-ops/SalesOpsApp.tsx`,
`apps/web/src/sales-ops/api.ts`, `apps/web/src/sales-ops/hooks.ts`.
Added: `apps/web/src/sales-ops/cadastro-history.ts`,
`apps/web/src/sales-ops/CadastroHistoryPanel.tsx`,
`apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx`.

Nothing under `apps/api/**`, `packages/**`, no `CHANGELOG.md`, no generated file.
`.vscode/` was already untracked before this session began and is not part of the slice.

## 1. Commands

Each run exactly once, run-once mode, no watcher left behind.

### `pnpm --filter @fxl-sales/web test`

```
 Test Files  48 passed (48)
      Tests  575 passed (575)
   Duration  4.85s
```

### `pnpm --filter @fxl-sales/web lint`

```
> @fxl-sales/web@1.0.0 lint /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/web
> eslint src/
```

Clean, zero output, exit 0.

### `pnpm run type-check`

```
Scope: 4 of 5 workspace projects
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

### `pnpm test`

```
packages/shared-utils test:  Test Files  3 passed (3)
packages/shared-utils test:       Tests  80 passed (80)
apps/api test:  Test Files  36 passed (36)
apps/api test:       Tests  362 passed (362)
apps/web test:  Test Files  48 passed (48)
apps/web test:       Tests  575 passed (575)
build-contract: ok
```

The legacy-auth tracked-file guard and the build contract both passed.

## 2. Non-vacuity - mutation testing

Each mutation: break source, run the slice oracle, confirm RED, restore, confirm green.
The tree was restored byte-identically after each one (`git diff --stat` unchanged).

### (a) Render the raw `actorUserId` as the primary label when `actorDisplayName` is null

Mutation: in `CadastroHistoryPanel.tsx`, replaced the two-line
`Autor não identificado` + muted-mono id cell with a single primary line printing
`{row.actorLabel}`.

Observed: **RED**.

```
 FAIL  src/sales-ops/__tests__/cadastro-history.test.tsx > cadastro history rendering
       > names the actor "Autor não identificado" and demotes the id to muted monospace
AssertionError: expected 'Histórico de arquivamentosRegistro so…' to contain 'Autor não identificado'
Received: "...QuandoQuemEventoCadastroAções05/08/2026 12:04acct_unnamedArquivouFXL FinanceProdutoRestaurar"
 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

The received string is the proof: with the mutation the bare `acct_unnamed` sits where
the person's name belongs. Restored, green.

### (b) Offer `Restaurar` for an entity that is already active

Mutation: in `cadastro-history.ts`, deleted
`if (!live.archived) return { state: 'already-active' };` from `restoreStateFor`.

Observed: **RED**.

```
 FAIL  src/sales-ops/__tests__/cadastro-history.test.tsx > cadastro history restore affordance
       > does not offer restore for an entity that is already active
AssertionError: expected [ <button …(3)>…(1)</button> ] to have a length of +0 but got 1
 Test Files  1 failed (1)
      Tests  1 failed | 15 passed (16)
```

Restored, green.

### (c) Make the restore send more than `{ status }`

Two independent probes, because the claim is enforced at two levels.

**c1 - fan out the payload** (`cadastro-history.ts`, `restoreStateFor` target gains
`name: live.name`): **RED**, 3 tests.

```
 FAIL  ... > restores an archived produto through a status-only PATCH and invalidates sales-ops
 FAIL  ... > restores a pessoa with status active, never archived
 FAIL  ... > offers restore for a non-system archived função and refuses a system one
AssertionError: expected { Object (state, target) } to deeply equal { Object (state, target) }
+     "name": "Designer",
 Test Files  1 failed (1)
      Tests  3 failed | 13 passed (16)
```

**c2 - fan out the HTTP body** (`api.ts`, `setCadastroStatus` body becomes
`{ status, name: 'fan-out' }`): **RED** against slice 03's transport oracle, which is the
guard that actually watches the wire.

```
 FAIL  src/sales-ops/__tests__/cadastro-archive.test.tsx > archives a produto with a status-only PATCH
 FAIL  ... > uses the same PATCH shape for área, função and pessoa
 FAIL  ... > never issues a DELETE and never sends a body key other than status
 FAIL  ... > restores with the same endpoint and status active
 Test Files  1 failed (1)
      Tests  4 failed | 17 passed (21)
```

Both restored; `cadastro-history.test.tsx` + `cadastro-archive.test.tsx` re-run green
(2 files, 37 tests passed).

All three required mutations went red. No assertion in this slice is decorative.

## 3. Wire contract is real

Compared web against the shipped API source directly, not against the plan.

| Fact | API (`apps/api/src/domains/audit/history-service.ts`, `.../sales-ops/routes.ts`, `.../audit/service.ts`) | Web (`cadastro-history.ts`, `api.ts`) | Match |
| --- | --- | --- | --- |
| Path | `salesOpsRouter.get('/history', requireAdmin, ...)` under `/api/v1/sales-ops` | `SALES_OPS_HISTORY_PATH = '/api/v1/sales-ops/history'` | yes |
| Entry fields | `OrgAuditHistoryEntry = { id, ts, action, entityType, entityId, entityLabel, actorUserId, actorDisplayName }` | `CadastroHistoryEntryWire` - same 8 keys, same nullability (`entityLabel`, `actorDisplayName` nullable) | yes |
| Page shape | `{ entries, nextCursor }`, `nextCursor: string \| null` | `CadastroHistoryResponse = { entries, nextCursor: string \| null }` | yes |
| `id` type | decimal **string** (`String(row.id)`, never BigInt) | `id: string`, used verbatim as the React key, never parsed | yes |
| `ts` | ISO 8601 UTC (`row.ts.toISOString()`) | `new Date(iso)` + `Intl.DateTimeFormat('pt-BR')` | yes |
| entityType literals | `CadastroEntityTypeSchema = z.enum(['produto','pessoa','funcao','area'])` | `ENTITY_KINDS = ['produto','pessoa','funcao','area']` | exact |
| action literals | `CADASTRO_LIFECYCLE_ACTIONS = ['cadastro.archived','cadastro.restored']` | `CADASTRO_HISTORY_ACTIONS = ['cadastro.archived','cadastro.restored']` | exact |
| Keyset | `nextCursor` from `limit + 1` overfetch, exclusive `lt(auditLog.id, BigInt(cursor))`, `orderBy desc(id)` | `hasMore = nextCursor !== null`; no client re-sort; the panel does not page | yes |
| `limit` bounds | clamped to `[1, HISTORY_MAX_LIMIT=200]`, default 50 | sends `50` | yes |
| `action` set | comma-separated, 1..10 non-empty parts of <=120 chars, `inArray` | sends 2 values joined by `,` | yes |

The one wire risk worth proving rather than assuming was the `encodeURIComponent` on the
joined action set - a `%2C` that reached the handler undecoded would become one 39-char
action, match nothing, and silently return an empty history. Proved it round-trips against
the real Hono router:

```
URL SENT:   http://x/history?limit=50&action=cadastro.archived%2Ccadastro.restored
SERVER SAW: {"action":"cadastro.archived,cadastro.restored"}
```

Two further checks: the endpoint is the tenant-scoped `sales-ops/history`
(`eq(auditLog.actorOrgId, c.get('orgId'))`), **not** the cross-tenant admin audit reader;
and `actorDisplayName` really can be `null` on the API side (`names.get(row.id) ?? null`,
which deliberately never falls back to the account id), so the web's null branch is a live
path and not defensive dead code.

## 4. Only cadastro lifecycle rows in the archiving card

Enforced at the request: `salesOpsApi.cadastroHistory` always sends
`action=cadastro.archived,cadastro.restored`, the API applies `inArray(auditLog.action, ...)`,
and the oracle pins the call arguments exactly:

```js
expect(vi.mocked(salesOpsApi.cadastroHistory).mock.calls[0]).toEqual([
  50, ['cadastro.archived', 'cadastro.restored'], expect.any(String),
]);
```

`normalizeHistoryVerb` additionally refuses to give any other action a verb - pinned for
`commission.approve`, `payout.mark_paid`, `produto.archived`, `cadastro.archive` - so an
unrecognized action can never acquire a restore affordance. Note (non-blocking, matches the
plan's stated design): `normalizeCadastroHistory` does not *drop* an unknown action, it
renders it read-only with the raw action string in the Evento badge. That branch is
unreachable through the panel's own request; it exists so a future third lifecycle action
degrades to read-only rather than disappearing.

## 5. Restore is not presented as an undo

Two pieces of copy, both explicit, both pt-BR:

- Card subtitle (always visible): `Registro somente-acréscimo: restaurar não apaga o
  arquivamento, apenas acrescenta um novo evento ao histórico.`
- Confirmation body: `... O arquivamento continua registrado aqui: restaurar não apaga o
  evento anterior, acrescenta um novo.`

Nothing in the UI implies the ledger was rewritten. The archive row is never removed,
struck through, or folded into its restore - the panel is flat and never groups by entity,
so an archive and its later restore stay two independent rows in chain order, and the
restore row carries its own `Restaurou` badge. The already-restored case renders the words
`Já restaurado` rather than a disabled button, which is the correct reading for something
that has already happened. Confirmed by the oracle asserting the confirmation text
`restaurar não apaga o evento anterior` appears before the write is issued.

## 6. No Restaurar for a system função, in any branch

`restoreStateFor` returns `{ state: 'none' }` when `row.kind === 'funcao' && live.isSystem`,
checked before the archived test, so a system função never reaches `available`.
`state: 'none'` renders an empty Ações cell. The only `<button>` in the panel that can open
the confirmation is gated on `row.restore.state === 'available'`, and the confirm handler
acts only on the `target` that button supplied - there is no second path to the mutation.
Pinned: an archived `isSystem: true` `vendedor` yields `{ state: 'none' }` while an archived
non-system `Designer` in the same bootstrap yields `available`.

## 7. CLAUDE.md compliance

- No `<select>` / `<option>` / `<datalist>` / raw `<input type="number">` in the new files - grep clean, and `pnpm --filter @fxl-sales/web lint` (which carries the `no-restricted-syntax` ban) passes.
- `useInlineLayer`: not required. The confirmation is an `AlertDialog` whose body is plain text plus Cancel/Action; it opens no `Combobox` panel and no `InfoHint` disclosure, so there is no inline layer to register.
- Every mutation goes through `useAppMutation` with declared invalidations: the restore adds **no** mutation of its own, it reuses slice 03's `useSetSalesOpsCadastroStatus`, which is a `useAppMutation` with `invalidates: [queryKeys.salesOps.all]`. The new `useCadastroHistory` is a `useQuery`, and its key `['sales-ops','cadastro-history',50]` sits under the `['sales-ops']` prefix, so the invalidation reaches it - asserted behaviourally by the second `cadastroHistory` call after the write settles.
- No `(await getToken()) ?? ''` anywhere; both the read hook and the write use `requireToken(getToken)`.
- All operator-facing copy is pt-BR.
- No em dash character in the diff or in any of the three new files - grep clean.
- No `CHANGELOG.md` and no generated-file edit.
- Scope confined to `apps/web/**` plus the `nexo/runs/` exec report.
- UI identifiers: the Hub account id appears only as secondary muted-monospace text under a pt-BR primary label, and the entity uuid only when neither a live name nor a ledger snapshot exists, also muted monospace. Both branches are pinned, including the negative (`expect(text()).not.toContain(ACTOR_ID)` and `not.toContain(PRODUCT_ID)` when a name exists).

## 8. Existing tests not weakened

No existing test file was modified. `git status` shows four modified source files and three
new files; every `__tests__` entry in the diff is an addition. Nothing was removed or
loosened - checked against `git diff master --stat`.

## 9. Button type inside a form

The restore trigger declares `type="button"` explicitly, and it is the panel's only
`<button>`. The panel is also structurally outside any form: `CadastroHistorySection` is
rendered as a **sibling** of `SettingsView` inside a flex wrapper, not nested in
`SettingsView`'s `<form>`. That placement is doubly right - `SettingsView` is keyed on the
persisted settings timestamp, so nesting would remount the history and blank the table on
every settings save. The confirmation's own Cancel/Action buttons come from
`AlertDialogCancel` / `AlertDialogAction`, which are Radix primitives rendering
`type="button"`.

## 10. Other observations (non-blocking, no action required)

- `persistedBootstrap` is passed to the panel rather than `bootstrap`, so a restore can never target an `optimistic:` id; `restoreStateFor` also refuses `isOptimisticId` independently. Belt and braces, correctly.
- `restoringId` disables only the row in flight; other rows stay clickable during a restore. Each write is an idempotent status-only PATCH, so a double click across rows is harmless.
- The `Já restaurado` / `Registro não encontrado` states are words, not disabled buttons, which is the right story for a terminal condition.
- `kindLabel` renders `Serviço` for a produto row whose live product is a service, routed through `isServiceProduct` - the one sanctioned discriminator branch, not a re-derivation from `openPrice`.

## Tree state

Restored exactly as found. `git diff --stat` and `git status --porcelain` are identical to
the pre-audit snapshot; the temporary Hono probe script was written to the scratchpad and
its copy inside `apps/api` was deleted. No long-running process was started, so none was
left behind.

## Verdict

**PASS.** All four commands green, all three required mutations went red and were restored,
the web binds to the field names, pt-BR entity literals, action literals and keyset fields
the shipped API actually returns, and no audit point failed.
