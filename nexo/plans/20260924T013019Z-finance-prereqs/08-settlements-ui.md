---
id: 08-settlements-ui
milestone: v4.1.0
status: todo
depends_on: [05-wizard-row-ids, 06-settlements-api, 07-admin-gate-and-brl]
files_modified: [apps/web/src/lib/query-keys.ts, apps/web/src/sales-ops/api.ts, apps/web/src/sales-ops/hooks.ts, apps/web/src/sales-ops/types.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/settlements/settlement-format.ts, apps/web/src/sales-ops/settlements/settlement-errors.ts, apps/web/src/sales-ops/settlements/settlement-ui.ts, apps/web/src/sales-ops/settlements/MarkPaidDialog.tsx, apps/web/src/sales-ops/settlements/ReverseSettlementDialog.tsx, apps/web/src/sales-ops/settlements/SettlementHistory.tsx, apps/web/src/sales-ops/settlements/SettlementRowActions.tsx, apps/web/src/sales-ops/MutationErrorBanner.tsx, apps/web/src/sales-ops/__tests__/mutation-error-banner.test.tsx, apps/web/src/sales-ops/settlements/__tests__/settlement-format.test.ts, apps/web/src/sales-ops/settlements/__tests__/settlements-api.test.ts, apps/web/src/sales-ops/settlements/__tests__/mark-paid-dialog.test.tsx, apps/web/src/sales-ops/settlements/__tests__/reverse-settlement-dialog.test.tsx, apps/web/src/sales-ops/settlements/__tests__/settlement-row-actions.test.tsx, apps/web/src/sales-ops/settlements/__tests__/settlement-history.test.tsx, apps/web/src/sales-ops/settlements/__tests__/sale-action-error.test.tsx, apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "Admins mark receivables and payables as paid with a São Paulo civil date, reverse a baixa with an optional reason, and read the settlement history, where parcelas and contas a pagar already appear; leaving won or cancel-contract refused by an active baixa names the blocking rows."
acceptance: ["In the sale detail (Plano de pagamento and Contas a pagar) and in operacional/comissoes, an admin sees `Marcar como pago` on every open non-void row of a won proposta and `Estornar` on every paid row that has a `paidOn`", "The `Marcar como pago` dialog defaults its date to todayInSaoPaulo() (2026-09-23 at the instant 2026-09-24T01:30:00Z), sets max to that day, refuses a future day with `A data de pagamento não pode ser no futuro.` before any request, and shows the full open amount read-only", "The record request body is exactly {targetKind, targetId, paidOn}; no amount is ever sent", "A server 422 paid_on_in_future or invalid_paid_on and every C5 settlement 409 render a pt-BR message inside the dialog, which stays open", "A paid row shows `Pago em DD/MM/AAAA` from bootstrap paidOn formatted by string, with no timezone slip, for every viewer", "`Estornar` posts {reason} (trimmed, omitted when blank) to /settlements/:id/reverse for the latest active baixa of that row, read from GET /sales/:id/settlements", "The history lists each baixa and estorno with type, civil date, amount, actor_name (fallback `Autor não identificado`), recorded time in São Paulo and reason, and never renders actor_user_id or any row id", "Record and reverse are useAppMutation hooks used with mutateAsync that invalidate queryKeys.salesOps.all, which prefix-covers the bootstrap and every sale settlement history", "meus-dados/vendas and meus-dados/comissoes render no settlement action and no history for any viewer; non-admins never see an action", "A 409 sale_has_active_settlements from POST /sales/:id/transition or POST /sales/:id/cancel-contract renders slice 07's MutationErrorBanner with one line per blocking row (bootstrap description first, C5 label as fallback, never an id); no second page-level error component exists", "The slice reuses slice 05's ApiError.rows and does not modify apps/web/src/lib/api-client.ts", "The SalesOpsSettlement web type is exactly slice 06's SettlementEntry (C6 as resolved) and declares no actorUserId", "CLAUDE.md and nexo/knowledge/reference/propostas.md carry the new settlement-UI rules in the same change"]
---

# 08-settlements-ui

## Context

Verified against the worktree at `82a62a3` (before slices 01-07 land; the executor re-reads the files after its dependencies merge, see "Preconditions").

Where receivables and payables appear today:

- `SaleDetailDialog` in `apps/web/src/sales-ops/SalesOpsApp.tsx:2745-2980` is the read-only proposta detail opened by a row click in `SalesView` (`:2559`, detail state `detailSaleId` at `:2575`, mounted at `:2736`).
  It lists `Plano de pagamento` (receivables, `:2826-2874`, columns Vencimento / Método / Valor / Status) and `Contas a pagar` (payables, `:2876-2917`, columns Beneficiário / Tipo / Vencimento / Valor / Status).
  Status badges come from local maps `receivableStatusMeta` / `payableStatusMeta` (`:2762-2771`).
- `SalesView` is mounted for `view === 'vendas'` at `:2100` with `canManage={workspace === 'operacional'}`, so the same component (and the same detail dialog) serves `operacional/vendas` (row actions) and `meus-dados/vendas` (read-only).
- `CommissionsView` at `:3038-3120` (not exported) is the only payables list.
  It is mounted at `:2117` for `view === 'comissoes'` in BOTH `operacional/comissoes` and `meus-dados/comissoes`, with no role prop at all.
- `DashboardView` (`:1534`, `:1809`, `:1852`, `:2037`, `:2348`) only counts and sums payables; no row is rendered there, so it gets no action.
- The wizard's `payablesPreview` (`:7122`, `:9198`) is a projection of a proposta being edited, not a ledger row; it gets no action.

Mutations and errors today:

- `transitionSale` and `cancelContract` are `useTransitionSalesOpsSale()` / `useCancelSalesOpsContract()` (`SalesOpsApp.tsx:1228-1229`) called with `.mutate` at `:2103-2107`; at base a failure is swallowed silently, and slice 07 wires them to `MutationErrorBanner` (see below).
- After slice 05, `ApiError` carries `rows?: ApiErrorRow[]` (`{ kind, id, label }`, exported from `apps/web/src/lib/api-client.ts`); this slice reuses it and never edits `api-client.ts`.
- After slice 07, transition, cancel-contract and settings failures render `MutationErrorBanner` (`apps/web/src/sales-ops/MutationErrorBanner.tsx`, scoped to the view, `reportMutation` handlers in `SalesOpsApp()`); this slice extends that banner and adds no second error surface (contract H7).
- `useAppMutation` (`apps/web/src/lib/app-mutation.ts`) invalidates its declared keys on success AND failure; `queryKeys.salesOps.all = ['sales-ops']` prefix-matches every sales-ops key (`apps/web/src/lib/query-keys.ts:26-37`).
- The `confirmCopy` strings (`SalesOpsApp.tsx:2531-2557`) still promise `Pagamentos já baixados não são afetados.` and `Parcelas pagas não são afetadas.`, and `hooks.ts:270-271` says cancel "leaves paid rows untouched"; after slice 06 a won proposta with an active baixa cannot leave won at all, so that copy is false.

Types and helpers:

- `SalesOpsReceivable` / `SalesOpsPayable` in `apps/web/src/sales-ops/types.ts:217-264`; `SalesOpsPayable.id` is optional and neither type has `paidOn`, `revision` or `updatedAt` (payable) yet.
- `formatMoneyBrl(cents)` and `formatIsoDateBr('YYYY-MM-DD')` (pure string split) in `apps/web/src/sales-ops/calculations.ts:458-478`.
- After slice 01, `displayDate`, `civilDayOf` and `inputDateToday` live in `apps/web/src/sales-ops/civil-day.ts` (exported; `inputDateToday` is the São Paulo day) and `formatIsoDateBr` already slices to ten characters.
- `payableTypeMeta(kind)` (`SalesOpsApp.tsx:511-517`) is private; the settlements module declares its own kind labels (precedent: `leads/board-ui.ts` re-declares what it cannot import, because `SalesOpsApp.tsx` imports it and the reverse import would be a cycle).
- Dialog precedent: `apps/web/src/sales-ops/leads/MoveLeadDialog.tsx` (real `Dialog`, `DialogFooter`, every button `type="button"`, confirm via `onClick`, classes from `leads/board-ui.ts`).
- Real-Dialog test precedent: `apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx` (happy-dom, `createRoot`, `typeInto` via the native value setter, dialog queried from `document`).
- Admin is `profile.roles.includes('admin')` (`SalesOpsApp.tsx:1332` precedent `canManageCadastros`).
- `@fxl-sales/shared-utils` is consumed from `dist` through `package.json` `exports` subpaths (`packages/shared-utils/package.json`); slice 01 adds `./sao-paulo-day`.
- Fake identities (`packages/auth-fake/src/index.ts`): `team-owner` = "Ana (dona da organizacao)", roles `['admin','seller','finder']`, org `Agencia Norte`; `seller` = "Diego (somente vendedor)", roles `['seller']`.
  The seed (`apps/api/scripts/seed/plan.ts:1042`, `:1095`) creates a won proposta `0001-...` in Norte with parcela 1 `paid`; after slice 03 every seeded paid row also carries one synthetic baixa (`actor_name = 'Seed de desenvolvimento'`), so it shows `Pago em` and offers `Estornar`, and re-seeding after a baixa works.

## Preconditions (check before step 1, no design decision involved)

1. Slices 01, 05, 06 and 07 are merged into the branch this slice starts from.
2. `packages/shared-utils/src/sao-paulo-day.ts` exports `todayInSaoPaulo`, `isIsoDay`, `isAfterTodayInSaoPaulo`, and `packages/shared-utils/package.json` has the `./sao-paulo-day` export.
   If the export entry is missing, add it in this slice (same shape as `./professional-split`) and add `packages/shared-utils/package.json` to the commit.
3. Confirm in `apps/api/src/domains/sales-ops/settlements.ts` that slice 06 shipped the C6 shapes fixed in `00-OVERVIEW.md` (GET `{ settlements: SettlementEntry[] }`, POST `201 { settlement, row }`, reason max 500, C5 payable label `<beneficiário> (<N/M>)`); they are the contract, not an assumption. A mismatch is a slice 06 defect to report, not something to adapt around.
4. Confirm `ApiError.rows` / `ApiErrorRow` exist (slice 05) and `MutationErrorBanner` / `MUTATION_ERROR_COPY` / `salesOpsMutationErrorMessage` exist (slice 07).
6. Build the shared package once so web tests resolve `dist`: `pnpm --filter @fxl-sales/shared-utils build`.

## Design

### Files and responsibilities

All new UI lives in `apps/web/src/sales-ops/settlements/`.
`.ts` files export no component; `.tsx` files export only components (keeps `react-refresh/only-export-components` quiet).

1. `settlement-format.ts` (pure, no React):
   - `export type SettlementTargetKind = 'receivable' | 'payable';`
   - `export type SettlementTarget = { kind: SettlementTargetKind; id: string; saleId: string; saleCode: string; saleStatus: SalesOpsStatus; description: string; amountBrl: number; status: 'open' | 'paid' | 'void'; paidOn: string | null };`
   - `export const PAYABLE_KIND_LABELS: Record<string, string> = { seller_commission: 'Comissão do vendedor', finder_commission: 'Comissão do finder', tax: 'Imposto', professional_cost: 'Custo profissional', other_cost: 'Outros custos' };`
   - `export function describeReceivable(row: Pick<SalesOpsReceivable, 'label' | 'dueDate'>): string` - label starting with `M` gives `Recorrência ${label.slice(1)}`; another non-empty label gives `Parcela ${label}`; no label gives `Parcela de ${formatCivilDay(row.dueDate.slice(0, 10))}`.
   - `export function describePayable(row: Pick<SalesOpsPayable, 'kind' | 'beneficiaryName'>): string` - `tax` and `other_cost` give the kind label alone; any other kind gives `${PAYABLE_KIND_LABELS[kind] ?? 'Conta a pagar'} · ${beneficiaryName}`.
   - `export function receivableSettlementTarget(row: SalesOpsReceivable, sale: SalesOpsSale): SettlementTarget` and `export function payableSettlementTarget(row: SalesOpsPayable & { id: string }, sale: SalesOpsSale): SettlementTarget`, copying `amountBrl`, `status`, `paidOn ?? null`, `sale.code`, `sale.status`, and the description above.
   - `export { displayDate as formatCivilDay } from '../civil-day';` - NOT a new helper: slice 01's `displayDate` is the one civil-day formatter (string only, never `new Date(day)`, since a `YYYY-MM-DD` parsed by `Date` is UTC midnight and prints the previous day in São Paulo); the alias only keeps this module's vocabulary.
   - `export function formatRecordedAt(iso: string): string` - `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))`, assembled as `${day}/${month}/${year} às ${hour}:${minute}` (assembled from parts so the ICU separator cannot vary the output).
   - `export function activeBaixasFor(entries: readonly SalesOpsSettlement[], target: { kind: SettlementTargetKind; id: string }): SalesOpsSettlement[]` - entries with `type === 'baixa'`, matching `receivableId` (kind receivable) or `payableId` (kind payable) to `target.id`, and with NO entry of `type === 'estorno'` whose `reversesSettlementId === baixa.id`; sorted by `paidOn` descending, then `recordedAt` descending (same "active = no estorno" rule as the C2 reducer; the reducer stays authoritative server-side for `status` / `paidOn`).
   - `export function buildTargetDescriptions(receivables: readonly SalesOpsReceivable[], payables: readonly SalesOpsPayable[]): Map<string, string>` - id to description, skipping payables without `id`.
   - `export function describeLockedRows(rows: readonly ApiErrorRow[], descriptions: Map<string, string>): string[]` - for each row, `descriptions.get(row.id)` first, otherwise `row.kind === 'receivable' ? \`Parcela ${row.label}\` : row.label` (the C5 payable label already reads `Ana Martins (1/3)`), otherwise `'Linha sem rótulo'`; never the id.
2. `settlement-errors.ts` (pure):
   - `export function settlementErrorMessage(error: unknown): string`, keyed on `(status, error code)` of an `ApiError`-shaped object:
     - `422 paid_on_in_future` -> `A data de pagamento não pode ser no futuro.`
     - `422 invalid_paid_on` -> `Informe uma data de pagamento válida.`
     - `409 already_paid` -> `Esta linha já está paga. Atualize a página para ver o pagamento.`
     - `409 row_void` -> `Esta linha foi anulada e não aceita pagamento.`
     - `409 sale_not_won` -> `Só é possível registrar pagamento em proposta ganha.`
     - `409 already_reversed` -> `Este pagamento já foi estornado.`
     - any `404` -> `Registro não encontrado. Atualize a página.`
     - any `403` (keyed on the status via `isForbiddenFailure`) -> `MUTATION_ERROR_COPY.adminRequired` from `../mutation-error-copy` (contract H7: one 403 line).
     - anything else -> `Não foi possível concluir. Tente novamente.`
   - `export function lockedRowLines(error: unknown, descriptions: Map<string, string>): string[]` - for a `409` whose `error` is `sale_has_active_settlements`, `describeLockedRows(error.rows ?? [], descriptions)`; for anything else `[]`. The headline stays slice 07's `salesOpsMutationErrorMessage` (`MUTATION_ERROR_COPY.saleHasActiveSettlements`), so there is one message and one component.
   - Keying on the body code is correct here: the "status alone" rule in CLAUDE.md is about the 401/402/403 auth classification.
3. `settlement-ui.ts` - local class constants (copy the needed ones from `leads/board-ui.ts`: `formInputClass`, `formTextareaClass`, `fieldLabelClass`, `primaryButtonClass`, `secondaryButtonClass`, `blockedNoticeClass`, `mutedStateClass`), plus `rowActionButtonClass = 'inline-flex h-8 items-center rounded-lg border border-[#dcdce2] bg-white px-2.5 text-[12.5px] font-semibold text-[#201f24] transition hover:bg-[#fafafb] disabled:opacity-60'` and `paidOnNoteClass = 'mt-1 block text-[12px] text-[#57575f]'`.
   Import them by value from `../leads/board-ui` only if the executor prefers; a re-declaration with a one-line comment naming the source is the house precedent.
4. `MarkPaidDialog.tsx`:
   - `export function MarkPaidDialog({ open, onOpenChange, target, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; target: SettlementTarget; onConfirm: (payload: RecordSettlementPayload) => Promise<unknown> })`.
   - Mount-scoped state (the parent mounts it only while open and keys it by `target.id`, precedent `MoveLeadDialog`): `const [today] = useState(() => todayInSaoPaulo())`, `const [paidOn, setPaidOn] = useState(today)`, `const [serverError, setServerError] = useState<string | null>(null)`, `const [pending, setPending] = useState(false)`.
   - `const refusal = !isIsoDay(paidOn) ? 'Informe uma data de pagamento válida.' : isAfterTodayInSaoPaulo(paidOn) ? 'A data de pagamento não pode ser no futuro.' : null;`
   - Real `Dialog` / `DialogContent className="max-w-md"`; `DialogTitle` `Marcar como pago`; `DialogDescription` `${target.description} · Proposta ${target.saleCode}`.
   - Field 1: label `Data do pagamento` (`htmlFor="settlement-paid-on"`), `<Input id="settlement-paid-on" type="date" max={today} value={paidOn} onChange=... className={formInputClass} />` (`Input` from `@/components/ui/input`; `type="date"` is allowed by CLAUDE.md UI Controls).
   - Field 2: label `Valor`, a read-only text (not an input) `formatMoneyBrl(target.amountBrl)` with `data-settlement-amount="true"`, and a muted line `O pagamento é registrado pelo valor integral em aberto.`
   - `refusal ?? serverError` renders in `<p role="alert" className={blockedNoticeClass} data-settlement-error="true">`.
   - Footer: `Cancelar` (`type="button"`, closes) and `Confirmar pagamento` (`type="button"` on every render, `data-settlement-confirm="true"`, `disabled={refusal !== null || pending}`, label `Registrando...` while pending).
   - `confirm()`: returns if `refusal !== null`; `setPending(true)`; `setServerError(null)`; `await onConfirm({ targetKind: target.kind, targetId: target.id, paidOn })`; on success `onOpenChange(false)`; on failure `setServerError(settlementErrorMessage(error))` and the dialog stays open; `finally setPending(false)` (guarded against unmount by checking a mounted ref).
   - No inline layer is used (no Combobox, no InfoHint), so no `useInlineLayer`; the native date picker is browser chrome, not a DOM layer.
5. `ReverseSettlementDialog.tsx`:
   - `export function ReverseSettlementDialog({ open, onOpenChange, target, activeBaixa, loading, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; target: SettlementTarget; activeBaixa: SalesOpsSettlement | null; loading: boolean; onConfirm: (payload: ReverseSettlementPayload) => Promise<unknown> })`.
   - Title `Estornar pagamento`; description `${target.description} · Proposta ${target.saleCode}`.
   - Body: while `loading`, muted `Carregando pagamento...`; with `activeBaixa`, text `O pagamento de ${formatCivilDay(activeBaixa.paidOn)} (${formatMoneyBrl(activeBaixa.amountBrl)}) será estornado e a linha volta a ficar em aberto.`; with neither, blocked notice `Nenhum pagamento ativo encontrado para esta linha. Atualize a página.`
   - Field: label `Motivo (opcional)` (`htmlFor="settlement-reverse-reason"`), `<textarea id="settlement-reverse-reason" maxLength={REVERSE_REASON_MAX} className={formTextareaClass}>`; `REVERSE_REASON_MAX = 500` exported from `settlement-format.ts` unless slice 06's schema says otherwise (precondition 3; then use the server's number).
   - Footer: `Cancelar` and `Estornar` (`type="button"`, `data-settlement-reverse-confirm="true"`, `disabled={!activeBaixa || loading || pending}`, `Estornando...` while pending).
   - `confirm()`: `const reason = draft.trim();` then `onConfirm(reason ? { settlementId: activeBaixa.id, reason } : { settlementId: activeBaixa.id })`; same success/failure handling as `MarkPaidDialog`.
6. `SettlementHistory.tsx`:
   - `export function SettlementHistoryList({ entries, descriptions, showTarget }: { entries: readonly SalesOpsSettlement[]; descriptions: Map<string, string>; showTarget: boolean })` - one `<li data-settlement-entry={entry.type}>` per entry in the order received (server returns newest first), rendering:
     - type badge `Baixa` (green, `bg-[#c9e7cf] text-[#1f7d43]`) or `Estorno` (grey, `bg-[#eeeef1] text-[#6a6a72]`), plus `Estornada` muted suffix on a baixa that some estorno reverses;
     - when `showTarget`, the target description from `descriptions` (fallback `Linha removida`);
     - `formatCivilDay(entry.paidOn)` labelled `Pago em` for a baixa and `Estornado em` for an estorno;
     - `formatMoneyBrl(entry.amountBrl)`;
     - `entry.actorName ?? 'Autor não identificado'` and `Registrado em ${formatRecordedAt(entry.recordedAt)}`;
     - `Motivo: ${entry.reason}` only when `entry.reason` is non-empty;
     - never `actorUserId`, never any id.
     - Empty list: muted `Nenhum pagamento registrado.`
   - `export function SettlementHistorySection({ saleId, descriptions }: { saleId: string; descriptions: Map<string, string> })` - IN-FLOW disclosure for the sale detail (precedent `Detalhe de pagamento`, so no `useInlineLayer`): a bordered card like the other detail cards, header `Histórico de pagamentos` with a `type="button"` toggle `Mostrar` / `Ocultar` (`aria-expanded`), and when expanded `useSaleSettlements(saleId, expanded)`; loading `Carregando histórico...`, error `Não foi possível carregar o histórico.`, else `<SettlementHistoryList showTarget />`.
   - `export function SettlementHistoryDialog({ open, onOpenChange, target, descriptions }: {...; target: SettlementTarget })` - real `Dialog`, title `Histórico de pagamentos`, description `${target.description} · Proposta ${target.saleCode}`, `useSaleSettlements(target.saleId, open)` filtered to entries whose `receivableId` / `payableId` equals `target.id`, `showTarget={false}`, footer button `Fechar` (`type="button"`).
7. `SettlementRowActions.tsx`:
   - `export function PaidOnNote({ status, paidOn }: { status: 'open' | 'paid' | 'void'; paidOn: string | null | undefined })` - renders `<span className={paidOnNoteClass} data-paid-on="true">Pago em {formatCivilDay(paidOn)}</span>` only when `status === 'paid' && paidOn`; otherwise `null`. Pure, no hooks, safe for every viewer.
   - `export function SettlementRowActions({ target, withHistory }: { target: SettlementTarget; withHistory: boolean })` - the admin-only container (the CALLER decides admin; this component is only mounted when `canSettle` is true):
     - calls `useRecordSalesOpsSettlement()`, `useReverseSalesOpsSettlement()`, and `useSaleSettlements(target.saleId, reverseOpen)`;
     - `canMarkPaid = target.status === 'open' && target.saleStatus === 'won'` renders `Marcar como pago` (`type="button"`, `rowActionButtonClass`, `data-settlement-action="mark-paid"`);
     - `canReverse = target.status === 'paid' && target.paidOn !== null` renders `Estornar` (`data-settlement-action="reverse"`);
     - `withHistory` renders `Histórico` (`data-settlement-action="history"`) opening `SettlementHistoryDialog`;
     - a `void` row renders nothing;
     - dialogs are mounted only while open and keyed by `target.id`; `MarkPaidDialog.onConfirm = (payload) => record.mutateAsync(payload)`; `ReverseSettlementDialog.onConfirm = (payload) => reverse.mutateAsync(payload)`, `activeBaixa = activeBaixasFor(history.data ?? [], target)[0] ?? null`, `loading = history.isLoading`;
     - every button click calls `event.stopPropagation()` so a click inside a table row never reaches a row `onClick`.
8. `apps/web/src/sales-ops/MutationErrorBanner.tsx` (slice 07's component, extended, not duplicated):
   - gains an optional prop `lines?: readonly string[]`; when non-empty it renders, under the message span, `<ul className="mt-1 list-disc pl-5 font-medium" data-mutation-error-lines>` with one `<li>` per line (React text, never an id). Nothing else in the component changes.

### Shared plumbing (small edits to existing files)

- `apps/web/src/lib/api-client.ts` is NOT touched: slice 05 already added `ApiError.rows` (`ApiErrorRow`), which this slice imports.
- `apps/web/src/lib/query-keys.ts`: under `salesOps`, add `saleSettlements: (saleId: string) => ['sales-ops', 'sale-settlements', saleId] as const,` with a comment that it is nested under `sales-ops` so every sales-ops write, and the settlement writes in particular, refresh it by prefix.
- `apps/web/src/sales-ops/types.ts`:
  - `SalesOpsReceivable` gains `revision?: number; paidOn?: string | null;` (it already has `updatedAt`).
  - `SalesOpsPayable` gains `revision?: number; updatedAt?: string | null; paidOn?: string | null;`.
  - New `export type SalesOpsSettlement = { id: string; saleId: string; targetKind: 'receivable' | 'payable'; receivableId: string | null; payableId: string | null; type: 'baixa' | 'estorno'; reversesSettlementId: string | null; reversedBySettlementId: string | null; paidOn: string; amountBrl: number; origin: 'manual' | 'finance'; actorName: string | null; recordedAt: string; reason: string | null };`, exactly slice 06's `SettlementEntry` (C6 as resolved). The API never sends `actor_user_id`, so the type declares none.
  - Locked rows use `ApiErrorRow` from `@/lib/api-client` (slice 05); no second row type.
- `apps/web/src/sales-ops/api.ts`:
  - `export type RecordSettlementPayload = { targetKind: 'receivable' | 'payable'; targetId: string; paidOn: string };`
  - `export type ReverseSettlementPayload = { settlementId: string; reason?: string };`
  - `export type SaleSettlementsResponse = { settlements: SalesOpsSettlement[] };`
  - In `salesOpsApi`:
    - `recordSettlement: ({ targetKind, targetId, paidOn }: RecordSettlementPayload, token: Token) => apiFetch<unknown>('/api/v1/sales-ops/settlements', { method: 'POST', token, body: JSON.stringify({ targetKind, targetId, paidOn }) })` - the body is built field by field, never by spreading the payload, so an amount can never ride along.
    - `reverseSettlement: ({ settlementId, reason }: ReverseSettlementPayload, token: Token) => apiFetch<unknown>(\`/api/v1/sales-ops/settlements/${encodeURIComponent(settlementId)}/reverse\`, { method: 'POST', token, body: JSON.stringify(reason ? { reason } : {}) })`.
    - `saleSettlements: (saleId: string, token: Token) => apiFetch<SaleSettlementsResponse>(\`/api/v1/sales-ops/sales/${encodeURIComponent(saleId)}/settlements\`, { method: 'GET', token })`.
- `apps/web/src/sales-ops/hooks.ts`:
  - `useRecordSalesOpsSettlement()` - `useAppMutation({ mutationFn: async (payload: RecordSettlementPayload) => salesOpsApi.recordSettlement(payload, await requireToken(getToken)), invalidates: [queryKeys.salesOps.all] })`, comment: no optimistic write because `status` and `paidOn` are the server reducer's output.
  - `useReverseSalesOpsSettlement()` - same shape with `reverseSettlement`.
  - `useSaleSettlements(saleId: string, enabled: boolean)` - `useQuery({ queryKey: queryKeys.salesOps.saleSettlements(saleId), queryFn: async () => salesOpsApi.saleSettlements(saleId, await requireToken(getToken)), enabled, select: selectSettlements })` with a hoisted module-level `function selectSettlements(data: SaleSettlementsResponse): SalesOpsSettlement[] { return Array.isArray(data.settlements) ? data.settlements : []; }` (precedent `selectSalesOpsBootstrap`).
  - Rewrite the stale comment in `useCancelSalesOpsContract` to: `// No optimistic write: mid-contract cancellation voids open ledger rows server-side, and it is refused with 409 sale_has_active_settlements when a row it would void has an active baixa.`

### `SalesOpsApp.tsx` edits (localized; keep the diff small)

1. Imports: `PaidOnNote`, `SettlementRowActions` from `./settlements/SettlementRowActions`; `SettlementHistorySection` from `./settlements/SettlementHistory`; `buildTargetDescriptions`, `receivableSettlementTarget`, `payableSettlementTarget` from `./settlements/settlement-format`; `lockedRowLines` from `./settlements/settlement-errors`.
2. In `SalesOpsApp()`: `const canSettle = profile.roles.includes('admin');`.
3. The transition and cancel-contract props keep slice 07's `reportMutation` wiring unchanged. The ONE edit is on slice 07's `<MutationErrorBanner ... />` mount: add `lines={mutationFailure?.view === view && persistedBootstrap ? lockedRowLines(mutationFailure.error, buildTargetDescriptions(persistedBootstrap.receivables, persistedBootstrap.payables)) : undefined}` (computed inline, no new hook, so no hook-order risk around the early returns; use the bootstrap variable name the component really has).
   Pass `canSettle={workspace === 'operacional' && canSettle}` to `SalesView`.
4. `<CommissionsView bootstrap={persistedBootstrap} canSettle={workspace === 'operacional' && canSettle} />`.
5. `SalesView` gains one optional prop `canSettle?: boolean` (default `false`) and passes it to `SaleDetailDialog`. No error prop.
6. `SaleDetailDialog` gains `canSettle: boolean`:
   - receivables and payables Status cells render the badge followed by `<PaidOnNote status={row.status} paidOn={row.paidOn} />` for every viewer;
   - when `canSettle`, each table gains a last header `Ações` and a cell `<SettlementRowActions target={receivableSettlementTarget(row, sale)} withHistory={false} />` (payables: only when `payable.id` is defined, otherwise an empty cell);
   - when `canSettle`, `<SettlementHistorySection saleId={sale.id} descriptions={buildTargetDescriptions(receivables, payables)} />` renders after `Contas a pagar` and before `Margem`.
7. `CommissionsView` becomes `export function CommissionsView({ bootstrap, canSettle = false }: { bootstrap: SalesOpsBootstrap; canSettle?: boolean })`:
   - `const saleById = new Map(bootstrap.sales.map((sale) => [sale.id, sale]));`
   - Status cell adds `<PaidOnNote status={payable.status} paidOn={payable.paidOn} />`;
   - when `canSettle`, a last header `Ações` and a cell rendering `<SettlementRowActions target={payableSettlementTarget(payable, sale)} withHistory />` when both `payable.id` and `saleById.get(payable.saleId)` exist.
8. `confirmCopy` (`:2531-2557`):
   - `'reopen-won'.description` -> `` `As contas a pagar em aberto geradas pela proposta ${code} serão anuladas. Se houver pagamento registrado, estorne-o antes de reabrir.` ``
   - `'cancel-contract'.description` -> `` `As parcelas futuras em aberto da proposta ${code} e as comissões vinculadas serão anuladas. Se alguma delas tiver pagamento registrado, estorne-o antes.` ``
   - Both keep the word `anuladas`, which `sales-transition-actions.test.tsx` asserts.

## Steps

Each step names its test first (Red), then the code (Green), then any refactor.

1. Red: `apps/web/src/sales-ops/settlements/__tests__/settlements-api.test.ts`, tests `POSTs the settlement body with targetKind, targetId and paidOn only`, `POSTs the reverse with the reason and omits a blank one`, `GETs the sale history from the sale-scoped path` (the `rows` transport is slice 05's oracle, not re-tested here).
   Stub `fetch` with `vi.stubGlobal` (precedent `lib/__tests__/api-client-token-guard.test.ts`); assert URL suffix, `method`, and `JSON.parse(init.body)` with `toEqual` (exact keys).
   For the reverse case call once with `{ settlementId: 's1', reason: 'Duplicado' }` and once with `{ settlementId: 's1' }` and assert bodies `{ reason: 'Duplicado' }` and `{}`.
   Green: `types.ts`, `api.ts` additions.
2. Red: `apps/web/src/sales-ops/settlements/__tests__/settlement-format.test.ts`, tests `formats a civil day by string with no timezone slip`, `formats the recorded instant as a São Paulo wall clock`, `describes installment, recurring and payable rows`, `finds the active baixas of one row, newest first, skipping reversed ones`, `names locked rows from the bootstrap before the server label, never by id`.
   Fixtures: `formatCivilDay('2026-09-01')` is `01/09/2026`; `formatRecordedAt('2026-09-24T01:10:00.000Z')` is `23/09/2026 às 22:10`; `describeReceivable({ label: 'M2/12', ... })` is `Recorrência 2/12`; `describePayable({ kind: 'seller_commission', beneficiaryName: 'Ana Martins' })` is `Comissão do vendedor · Ana Martins`; `activeBaixasFor` over baixa `b1` (2026-09-10), baixa `b2` (2026-09-12), estorno `e1` reversing `b2`, baixa `b3` on another row, returns `[b1]` for the first row.
   Green: `settlement-format.ts`.
3. Red: `apps/web/src/sales-ops/settlements/__tests__/mark-paid-dialog.test.tsx` (happy-dom, REAL `Dialog`, `vi.useFakeTimers({ toFake: ['Date'] })` and `vi.setSystemTime(new Date('2026-09-24T01:30:00.000Z'))`, `vi.useRealTimers()` in `afterEach`), tests:
   - `defaults the payment date to the São Paulo day, not the UTC day` - `#settlement-paid-on` value is `2026-09-23` and its `max` is `2026-09-23`.
   - `refuses a future payment date before calling the API` - type `2026-09-24`; the alert reads `A data de pagamento não pode ser no futuro.`, the confirm button is disabled, and clicking it leaves `onConfirm` uncalled.
   - `confirms with the chosen civil day and the target, never an amount` - type `2026-09-20`, click `Confirmar pagamento`; `onConfirm` was called once with exactly `{ targetKind: 'receivable', targetId: 'rec-2', paidOn: '2026-09-20' }` and `onOpenChange(false)` followed.
   - `shows the full open amount read-only` - `[data-settlement-amount]` text is `R$ 1.500,00` and no `input` other than the date exists in the dialog.
   - `renders the server 422 paid_on_in_future message and stays open` - `onConfirm` rejects with `{ status: 422, error: 'paid_on_in_future' }`; the alert reads the pt-BR message and `onOpenChange` was not called with `false`.
   - `keeps one activation behaviour: every footer button is type=button`.
   Green: `settlement-errors.ts` (`settlementErrorMessage`), `settlement-ui.ts`, `MarkPaidDialog.tsx`.
4. Red: `apps/web/src/sales-ops/settlements/__tests__/reverse-settlement-dialog.test.tsx` (REAL `Dialog`), tests `reverses the active baixa with the typed reason` (types `  Pagamento em duplicidade  `, asserts `onConfirm({ settlementId: 'b1', reason: 'Pagamento em duplicidade' })`), `omits a blank reason` (`onConfirm({ settlementId: 'b1' })` with no `reason` key, checked via `Object.keys`), `refuses to confirm when no active baixa exists` (button disabled, notice text), `renders already_reversed from the server and stays open`.
   Green: `ReverseSettlementDialog.tsx`.
5. Red: `apps/web/src/sales-ops/settlements/__tests__/settlement-history.test.tsx`, tests `lists baixas and estornos with civil date, amount, author and recorded time`, `never renders the raw actor account id` (fixture entry cast with an extra `actorUserId: 'user_2xYzSecretId'` key, as if an API regression leaked it, and asserts neither it nor any entry / row id appears in `textContent`), `falls back to Autor não identificado when actor_name is null`, `marks a reversed baixa as Estornada`, `shows the reason only on an estorno that has one`.
   Render `SettlementHistoryList` directly (no hooks).
   Green: `SettlementHistory.tsx` (`SettlementHistoryList`; the section and dialog come in step 6).
6. Red: `apps/web/src/sales-ops/settlements/__tests__/settlement-row-actions.test.tsx`, with `vi.mock('../../hooks', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../hooks')>()), useRecordSalesOpsSettlement: () => ({ mutateAsync: record, isPending: false }), useReverseSalesOpsSettlement: () => ({ mutateAsync: reverse, isPending: false }), useSaleSettlements: () => ({ data: history, isLoading: false, isError: false }) }))`, tests:
   - `offers Marcar como pago on an open row of a won proposta`;
   - `shows Pago em and Estornar on a paid row` (row `paidOn: '2026-09-23'`, text `Pago em 23/09/2026` from `PaidOnNote`, `Estornar` present, `Marcar como pago` absent);
   - `reverse posts the reason for the active baixa` (click `Estornar`, type a reason, confirm, assert `reverse` called with `{ settlementId: 'b1', reason: 'Duplicado' }`);
   - `submit posts the São Paulo day for the row` (fake clock as step 3, open `Marcar como pago`, confirm, assert `record` called with `{ targetKind: 'payable', targetId: 'pay-1', paidOn: '2026-09-23' }`);
   - `offers no baixa on an open row of a proposta that is not won`;
   - `offers nothing on a void row`;
   - `offers no Estornar on a paid row without paidOn`.
   Green: `SettlementRowActions.tsx` (both components), `SettlementHistorySection` and `SettlementHistoryDialog` in `SettlementHistory.tsx`, the three hooks in `hooks.ts`, and `saleSettlements` in `query-keys.ts`.
7. Red: `apps/web/src/sales-ops/settlements/__tests__/sale-action-error.test.tsx` (pure plus a `MutationErrorBanner` render, happy-dom), tests:
   - `names the blocking rows when a proposta cannot leave Ganha` - `error = { status: 409, error: 'sale_has_active_settlements', rows: [{ kind: 'receivable', id: 'rec-1', label: '1/3' }, { kind: 'payable', id: 'pay-1', label: 'Ana Martins (1/3)' }, { kind: 'receivable', id: 'rec-9', label: '3/3' }] }` with descriptions built from a bootstrap containing `rec-1` (label `1/3`) and `pay-1` (seller commission to `Ana Martins`) but not `rec-9`; render `<MutationErrorBanner error={error} lines={lockedRowLines(error, descriptions)} onDismiss={spy} />`; the alert contains `MUTATION_ERROR_COPY.saleHasActiveSettlements`, `Parcela 1/3`, `Comissão do vendedor · Ana Martins` and the fallback `Parcela 3/3`, and contains none of `rec-1`, `pay-1`, `rec-9`.
   - `adds no lines for any other failure` - a 403 and a 500 give `lockedRowLines(...) === []` and the banner renders no `[data-mutation-error-lines]`.
   Also extend slice 07's `apps/web/src/sales-ops/__tests__/mutation-error-banner.test.tsx` with `renders the given lines as a list under the message`.
   Green: `lockedRowLines` in `settlement-errors.ts`, the `lines` prop on `MutationErrorBanner`, and the banner-mount edit 3.
8. Red: `apps/web/src/sales-ops/__tests__/sales-settlement-visibility.test.tsx` (REAL `Dialog`; hooks mocked as in step 6; `vi.mock('@/components/ui/dropdown-menu', ...)` as in `sales-transition-actions.test.tsx`), tests:
   - `admin in operacional sees settlement actions in the sale detail` - `SalesView canManage canSettle`, click the won sale row, the detail shows `Marcar como pago` for the open parcela, `Pago em 20/09/2026` and `Estornar` for the paid one, and `Histórico de pagamentos`.
   - `read-only SalesView shows Pago em but no settlement action` - `canManage={false}` and no `canSettle`: the detail shows `Pago em 20/09/2026`, and no `Marcar como pago`, `Estornar` or `Histórico de pagamentos`.
   - `CommissionsView without canSettle renders no settlement action` and `CommissionsView with canSettle offers Marcar como pago and Histórico`.
   - `a click on a row action does not reopen or close the sale detail` (stopPropagation holds).
   Green: `SaleDetailDialog` and `CommissionsView` edits 6 and 7, the `SalesOpsApp()` wiring edits 2 to 4, and the `confirmCopy` edit 8.
9. Refactor: remove any duplication between `SaleDetailDialog`'s two tables only if it stays inside `SalesOpsApp.tsx`'s existing structure; do not move the tables.
   Update `hooks.ts` comment, `CLAUDE.md` and `propostas.md` (see Docs).
10. Gate: run the oracle commands, then `pnpm --filter @fxl-sales/web exec vitest run` (whole web suite: `sales-transition-actions`, `sales-view`, `routing`, `leads-routing`, `entitlement-dead-end` and `session-loss-keeps-route` must stay green), `pnpm run lint` on the changed files, `pnpm --filter @fxl-sales/web run type-check`, and `node scripts/assert-web-bundle-clean.mjs` is untouched by this slice (no dev import added).

## Oracle tests

Prerequisite for every command: `pnpm --filter @fxl-sales/shared-utils build`.

```bash
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/settlements/__tests__ src/sales-ops/__tests__/sales-settlement-visibility.test.tsx src/sales-ops/__tests__/mutation-error-banner.test.tsx src/sales-ops/__tests__/financial-mutation-forbidden.test.tsx
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sales-transition-actions.test.tsx src/sales-ops/__tests__/sales-view.test.tsx src/sales-ops/__tests__/routing.test.tsx
```

Before trusting a green run, Verify confirms the files exist and the reporter lists every named test (a missing file or a wrong path exits 0 with `passWithNoTests: true` in `apps/web/vitest.config.ts`).

Named oracles and the mutation that proves each is not vacuous:

| Oracle (file :: title) | Mutation that must turn it red |
| --- | --- |
| `mark-paid-dialog.test.tsx` :: `defaults the payment date to the São Paulo day, not the UTC day` | Replace `todayInSaoPaulo()` with `new Date().toISOString().slice(0, 10)` (yields `2026-09-24`). |
| `mark-paid-dialog.test.tsx` :: `refuses a future payment date before calling the API` | Delete the `isAfterTodayInSaoPaulo` branch of `refusal`, or compare against the UTC day. |
| `mark-paid-dialog.test.tsx` :: `confirms with the chosen civil day and the target, never an amount` | Add `amountBrl: target.amountBrl` to the payload. |
| `mark-paid-dialog.test.tsx` :: `renders the server 422 paid_on_in_future message and stays open` | Call `onOpenChange(false)` in a `finally`, or drop the `setServerError` call. |
| `settlements-api.test.ts` :: `POSTs the settlement body with targetKind, targetId and paidOn only` | Build the body as `JSON.stringify(payload)` and pass an extra key through the payload in the test's call. |
| `reverse-settlement-dialog.test.tsx` :: `reverses the active baixa with the typed reason` | Drop `.trim()` or send `reason: draft` unconditionally. |
| `reverse-settlement-dialog.test.tsx` :: `omits a blank reason` | Always send `reason`. |
| `settlement-row-actions.test.tsx` :: `shows Pago em and Estornar on a paid row` | Format `paidOn` with `new Date(paidOn).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })` (prints `22/09/2026`), or gate `Estornar` on `status === 'open'`. |
| `settlement-row-actions.test.tsx` :: `reverse posts the reason for the active baixa` | Pick `activeBaixasFor(...).at(-1)` or ignore estornos in `activeBaixasFor`. |
| `settlement-row-actions.test.tsx` :: `offers no baixa on an open row of a proposta that is not won` | Drop `target.saleStatus === 'won'` from `canMarkPaid`. |
| `settlement-history.test.tsx` :: `lists baixas and estornos with civil date, amount, author and recorded time` | Format `recordedAt` without `timeZone` (UTC wall clock prints `01:10`). |
| `settlement-history.test.tsx` :: `never renders the raw actor account id` | Render `entry.actorName ?? entry.actorUserId`. |
| `sale-action-error.test.tsx` :: `names the blocking rows when a proposta cannot leave Ganha` | Render `row.id` instead of the description, or stop passing `lines` to the banner. |
| `sales-settlement-visibility.test.tsx` :: `read-only SalesView shows Pago em but no settlement action` | Default `canSettle` to `true` in `SalesView`, or pass `canSettle={canSettle}` without the workspace check (the component test covers the prop default; the SalesOpsApp wiring is covered by the browser step). |
| `sales-settlement-visibility.test.tsx` :: `CommissionsView without canSettle renders no settlement action` | Render `SettlementRowActions` regardless of `canSettle`. |

Verify runs at least three of these mutations by hand (the default-date, the never-an-amount and the raw-id ones) and restores the file.

### Real-browser check (Verify, after the suite is green)

happy-dom cannot catch activation-behaviour, nested-dialog focus or native date-picker bugs, so Verify drives the two dialogs in a real browser.

1. `make dev-fake-setup` (local Docker only: db-up, migrate, seed; the local database guard refuses a non-local URL), then `make dev-fake` launched in its own process group; record the PGID.
2. In Chrome at `http://localhost:8006`, adopt the fake identity `team-owner` ("Ana (dona da organizacao)", org `Agencia Norte`) through the dev identity switcher (or `localStorage['fxl-sales.dev-identity'] = 'team-owner'` and reload).
3. `/operacional/vendas`, open the won proposta `0001-...`:
   - Parcela 2 `Marcar como pago`: the date shows today in São Paulo, the picker cannot go past today, typing tomorrow shows `A data de pagamento não pode ser no futuro.` and disables `Confirmar pagamento`; pick yesterday and confirm; the row turns `Paga` with `Pago em <yesterday>` without a page reload.
   - Press Enter in the date field: nothing submits and the sale detail stays open (button type discipline).
   - Press Escape inside `Marcar como pago`: only that dialog closes; the sale detail stays open.
   - `Histórico de pagamentos` > `Mostrar`: one `Baixa` entry authored `Ana ...`, recorded time in São Paulo, no raw id anywhere.
   - `Estornar` on parcela 2 with `Motivo` `Teste de estorno`: the row returns to `Aberta`; the history shows the `Estorno` with the reason and the baixa marked `Estornada`.
   - Mark parcela 2 paid again, close the detail, row menu `Reabrir` > confirm: the red `MutationErrorBanner` names `Parcela 2/N` under its message; `Fechar aviso` dismisses it.
4. `/operacional/comissoes`: `Marcar como pago` on an open commission, then `Histórico` shows it.
5. Switch to identity `seller` ("Diego (somente vendedor)"): `/meus-dados/comissoes` and `/meus-dados/vendas` (open a proposta) show `Pago em` on paid rows and no `Marcar como pago`, `Estornar`, `Histórico` or `Ações` column.
6. Screenshot both dialogs and the notice; check spacing, the 44px input height, badge alignment and that the new `Ações` column does not overflow the 760px detail dialog at 1280px wide and does not create horizontal page scroll at 390px wide.
7. Stop the dev stack with `kill -- -<PGID>` of the command Verify launched; never by name.
8. Seed coherence (fixed by slice 03): parcela 1 of `0001-...` shows `Pago em <its due day>` and `Estornar`; its history entry is authored `Seed de desenvolvimento`. Re-running `make db-seed` after recording a baixa succeeds.

## Docs

`CLAUDE.md`, section `## Propostas domain`, add this block after the `Professional split:` block and before `Payment plan builder (step 2):` (one sentence per line, no em dash):

```markdown
Settlement UI:
- Baixa, estorno and history UI live in `apps/web/src/sales-ops/settlements/`; `SalesOpsApp.tsx` only mounts `PaidOnNote`, `SettlementRowActions` and `SettlementHistorySection`, and feeds `lockedRowLines` to the existing `MutationErrorBanner`.
- Settlement actions render only for `admin` in the `operacional` workspace; `meus-dados` stays read-only for everyone and shows only `Pago em`.
- `Marcar como pago` defaults to `todayInSaoPaulo()`, sets it as `max`, refuses a future day before the request, and never sends an amount.
- `paidOn` is a civil day formatted by string (`formatCivilDay`), never through `new Date`.
- `Estornar` reverses the latest active baixa read from `GET /sales/:id/settlements`; the bootstrap carries no settlement id.
- History renders `actor_name` (fallback `Autor não identificado`) and never `actor_user_id` or any row id.
- A `409 sale_has_active_settlements` from a transition or `cancel-contract` renders `MutationErrorBanner` with one line per blocking row (`lockedRowLines`, from `ApiError.rows`); there is no second page-level error component.
```

`nexo/knowledge/reference/propostas.md`, append this paragraph block at the end of the file (one sentence per line):

```markdown
- The settlement UI lives in `apps/web/src/sales-ops/settlements/` so `SalesOpsApp.tsx` only mounts it; the precedent is `ProfessionalSplitPanel.tsx` and the leads screens.
  Actions appear where the rows already appear: `Plano de pagamento` and `Contas a pagar` in `SaleDetailDialog`, and the `operacional/comissoes` list.
  They are gated on `admin` AND the `operacional` workspace, because `SalesView` and `CommissionsView` also serve `meus-dados`, which is read-only for everyone, admins included; the server's `requireAdmin` stays the real gate and the UI only hides what would answer 403.
  `Pago em` is shown to every viewer, because it is a fact about the row and comes from the bootstrap's reducer-backed `paidOn`.
- `paidOn` and `dueDate` are civil days, so the UI formats them by splitting the string; `new Date('2026-09-23')` is UTC midnight and prints the 22nd in São Paulo.
  Only "today" is a São Paulo decision: `Marcar como pago` seeds and caps its date with `todayInSaoPaulo()`, which near UTC midnight is the previous UTC day; the oracle pins the clock at `2026-09-24T01:30:00Z` and expects `2026-09-23`.
  The recorded instant is an instant, so it alone goes through `Intl` with `timeZone: 'America/Sao_Paulo'`, assembled from `formatToParts` so the ICU separator cannot change the text.
- The record body is built field by field (`targetKind`, `targetId`, `paidOn`) and never spreads a payload, because v1 is full payment only and the server derives the amount; the UI shows the open amount read-only.
- The bootstrap deliberately carries no settlement id; `Estornar` reads the sale history and reverses the newest active baixa of that row, with "active" meaning no estorno points at it, the same rule as the reducer.
  A paid row with no `paidOn` (a legacy row with no baixa; the migration and the dev seed give every paid row one, so it should not occur) offers no `Estornar`, because there is nothing to reverse.
- A transition or `cancel-contract` refused with `409 sale_has_active_settlements` renders slice 07's `MutationErrorBanner` with its lines from `lockedRowLines`, naming each row from the bootstrap (`Parcela 1/3`, `Comissão do vendedor · Ana`) before falling back to the C5 server label, and never by id.
  It reuses the banner on purpose: one page-level error surface, one 403 copy.
- Oracles: `settlements/__tests__/mark-paid-dialog.test.tsx`, `reverse-settlement-dialog.test.tsx`, `settlement-row-actions.test.tsx`, `settlement-history.test.tsx`, `settlements-api.test.ts`, `sale-action-error.test.tsx`, `settlement-format.test.ts`, and `__tests__/sales-settlement-visibility.test.tsx`.
```

If slice 06 left the `Leaving won ... voids only open` wording anywhere in `propostas.md` or `CLAUDE.md`, do NOT edit it here; report it to the orchestrator (slice 06 owns that rule).

## Security notes

- The server gate (`requireAdmin` on every settlement route and on transition / cancel-contract, slices 06 and 07) is authoritative; hiding buttons is a convenience, and the 403 path still renders a pt-BR message.
- The amount never leaves the browser; the target is an id the server re-resolves inside `withTenant`, so a forged id from another org answers 404 by RLS and the org filter.
- No raw account id reaches the DOM: `actorUserId` is typed but never rendered (oracle `never renders the raw actor account id`), and locked rows are named by description, never by id.
- `reason` is rendered as React text (escaped), capped by `maxLength`, and trimmed; it is never interpolated into HTML or a URL.
- Path ids go through `encodeURIComponent`.
- No `localStorage` or `sessionStorage` is added; the history query key is tenant-agnostic like every other key, and tenant separation stays `queryClient.clear()` on logout and switch.

## Contract deviations

- C6 does not fix the response envelopes; this plan assumes `GET /sales/:id/settlements` answers `{ settlements: SalesOpsSettlement[] }` with camelCase Drizzle names (`targetKind`, `receivableId`, `payableId`, `reversesSettlementId`, `paidOn`, `amountBrl`, `actorName`, `recordedAt`, `reason`).
  Fix: the executor adapts only `salesOpsApi.saleSettlements` and `SalesOpsSettlement` to what slice 06 shipped (precondition 3).
- C5 (RESOLVED by plan-check): the payable label is `<beneficiário> (<N/M>)`; the UI still names rows from the bootstrap first and uses the server label only as a fallback.
- C5 transport (RESOLVED): slice 05 owns `ApiError.rows`; this slice does not touch `api-client.ts`.
- Seed (RESOLVED): slice 03 owns the dev seed coherence (one synthetic baixa per seeded paid row, replica-mode cleanup before re-seed); this slice plans no seed change.
- Error surface (RESOLVED, H7): this plan's first `SaleActionErrorNotice` is dropped in favour of extending slice 07's `MutationErrorBanner` with `lines`.

## Decisions for AUDIT

- D1. Settlement actions appear only for `admin` in the `operacional` workspace; `meus-dados/vendas` and `meus-dados/comissoes` stay read-only even for an admin (the workspace is "my data", and `MeuPainelView` sets the read-only precedent).
- D2. `Estornar` reverses the newest active baixa of the row, read from the sale history on demand; the bootstrap does not grow a settlement id (C6 says it grows nothing the UI can do without).
- D3. The UI always sends `paidOn` explicitly (the day the operator confirmed), never relying on the server default.
- D4. The estorno reason is trimmed, omitted when blank, and capped at 500 characters unless slice 06's schema says otherwise.
- D5. A `paid` row with `paidOn === null` shows only the `Paga` badge and offers no `Estornar`.
- D6. The settlement history is admin-only in the UI, matching C6's `requireAdmin` on the GET.
- D7. The blocking rows of a refused transition or cancel-contract are listed inside slice 07's `MutationErrorBanner` (no second page-level error component, contract H7); the banner copy itself stays one line for both actions.
- D8. The row-level history in `operacional/comissoes` is a `Histórico` dialog per payable; the sale detail uses one in-flow `Histórico de pagamentos` disclosure for the whole proposta.

## Out of scope

- Partial payment, interest, fines, discounts, choosing an amount, or more than one baixa per row.
- Any integration code (outbox, feed, events, external ids, Hub or Finance calls) and any `origin = 'finance'` rendering beyond showing the entry.
- The sale deep link (slice 09) and the wizard's `row_has_active_settlement` message (slice 05).
- The pre-existing `Total pago no mês` metric that sums every paid payable regardless of month (report it; do not change it here).
- Any API, schema or migration change.
