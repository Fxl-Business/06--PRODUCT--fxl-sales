# Part 09d - Avançar dialog, notes, follow-ups on the summary

Part of slice `09-web-lead-resumo`. Depends on part 09c.

## Context

- Contract (`contracts/SEAM-CONTRACT-PHASE2.md`, `POST /leads/:id/advance`): body `{ toStageId, nextStep?, dueOn?, note?, reason? }`; `409 transition_not_allowed`; `400 validation_error` with `reason: 'followup_required'` when the destination is NOT an exit stage and `nextStep` or `dueOn` is missing; `400 ... reason: 'reason_required'` when the destination `requires_reason`; a destination of type `orcamento` with behaviour `opens_orcamentos` answers `409 sale_required_for_conversion` because the proposta wizard owns that conversion.
- The summary response lists ONLY the allowed destinations: `nextStages: Array<{ id, name, type, exitKind, requiresReason }>` (type `LeadNextStage`, part 08a). It carries no `behavior`; the behaviour comes from `GET /pipelines` (`usePipelines`, part 08a) by stage id through `stageOpensOrcamentos`.
- The conversion door already exists for the drag: `onRequestConversion(request) -> Promise<saleId | null>` (`LeadConversionRequest` in `LeadsBoard.tsx` line 44) supplied by `SalesOpsApp` as `requestLeadConversion` (wiring pinned in `board-write-surface.test.ts` `WIRING_PINS`); after it resolves a `saleId` the board calls `onMoveLead` with `saleId` (`POST /leads/:id/move`, `MoveLeadPayload.saleId`). The summary does the same with `useMoveLead()` and never calls a transition endpoint.
- Mutation hooks go through `useAppMutation` (`apps/web/src/lib/app-mutation.ts`); direct `useMutation` is lint-banned.
- Dialog rules: real `Dialog`, pickers are `Combobox` (they register their own inline layer), `<Input type="date">` allowed, numeric raw inputs banned; a refused submit keeps the dialog open with an inline error; `MoveLeadDialog.tsx` is the model for mount-scoped state (no reset effect).

## Design

### Hooks added to `crm-hooks.ts`
`useAdvanceLead()`, `useAddLeadNote()`, `useAddLeadFollowup()`, `useMarkFollowupDone()`: each `useAppMutation` with `mutationFn: async (payload) => crmApi.<fn>(payload, await requireToken(getToken))` and `invalidates: [queryKeys.leads.all]` (refreshes the summary, the board and the follow-ups list). No optimistic write. `useMarkFollowupDone` variable is the follow-up id.

### Pure `advance.ts`
```ts
export const ADVANCE_COPY = { title: 'Avançar lead', stageLabel: 'Etapa de destino', nextStepLabel: 'Próximo passo', dueOnLabel: 'Data do próximo passo',
  noteLabel: 'Nota (opcional)', reasonLabel: 'Motivo', confirm: 'Avançar', conversionHint: 'Esta etapa abre a proposta. Você preenche a proposta na próxima tela.',
  nextStepRequired: 'Informe o próximo passo.', dueOnRequired: 'Informe a data do próximo passo.', dueOnPast: 'A data não pode ser anterior a hoje.',
  reasonRequired: 'Informe o motivo.', notAllowed: 'Esse avanço não é permitido neste funil.', conversionNeeded: 'Esta etapa exige a proposta. Use o fluxo da proposta.',
  failed: 'Não foi possível avançar o lead. Tente novamente.' } as const;
export type AdvanceDraft = { toStageId: string | null; nextStep: string; dueOn: string; note: string; reason: string };
export const FOLLOWUP_REQUIRED_BY_TYPE: Record<PipelineStageType, boolean> = { normal: true, orcamento: true, saida: false };
export function advanceNeeds(dest: LeadNextStage | undefined, opensConversion: boolean): { followup: boolean; reason: boolean; conversion: boolean }
//   conversion = opensConversion; followup = !conversion && FOLLOWUP_REQUIRED_BY_TYPE[dest.type]; reason = dest.requiresReason; all false for undefined
export function validateAdvance(dest, opensConversion, draft, today): string | null
//   order: no destination -> ADVANCE_COPY.stageLabel-based message 'Escolha a etapa de destino.'; reason (if needed) blank -> reasonRequired;
//   followup needed: nextStep blank -> nextStepRequired; dueOn blank or !isIsoDay -> dueOnRequired; dueOn < today -> dueOnPast
export function buildAdvancePayload(leadId: string, draft: AdvanceDraft, needs): AdvanceLeadPayload
//   toStageId always; nextStep/dueOn only when needs.followup; reason only when needs.reason; note when non-blank (trimmed); strings trimmed
export function advanceErrorCopy(error: unknown): string
//   structural on {status, error, reason}: 409 transition_not_allowed -> notAllowed; 409 sale_required_for_conversion -> conversionNeeded;
//   400 followup_required -> nextStepRequired; 400 reason_required -> reasonRequired; else failed
```

### `AdvanceDialog.tsx`
Props: `{ open; onOpenChange; leadName: string; nextStages: LeadNextStage[]; opensConversionIds: ReadonlySet<string>; today: string; onSubmit: (payload: Omit<AdvanceLeadPayload,'leadId'>) => Promise<unknown>; onConvert: (stage: LeadNextStage) => Promise<unknown> }`.
Mount-scoped state: `draft` (destination defaults to `null`: the operator chooses), `submitted`, `submitting`, `error`. Layout: title `Avançar lead`, description `Escolha a próxima etapa de ${leadName}.` (no id); `Combobox` (`aria-label="Etapa de destino"`, `formSelectClass`, options = ONLY `nextStages`, never anything else); then, from `advanceNeeds`: when `conversion` the hint `conversionHint` and nothing else; otherwise when `followup` the `Próximo passo` `Input` (`id="advance-next-step"`, maxLength 200) and `Data do próximo passo` `<Input type="date" id="advance-due-on" min={today}>`; when `reason` a `textarea` `id="advance-reason"`; always the optional `textarea` `id="advance-note"` unless `conversion`. Footer `Cancelar` and `Avançar` (`data-advance-confirm`, `type="button"`, disabled while `validateAdvance` is non-null or submitting). Confirm: for conversion `await onConvert(stage)`; else `await onSubmit(buildAdvancePayload(...))`; success -> `onOpenChange(false)`; rejection -> inline `<p role="alert" data-advance-error>` with `advanceErrorCopy(error)` and the dialog stays open with typed values. The blocked message (`data-advance-blocked`) shows after the first interaction or submit, like the other lead dialogs.

### `SummaryComposers.tsx`
- `NoteComposer({ onAdd, pending })`: label `Nova nota`, `textarea id="summary-note"`, button `Adicionar nota` (`data-note-add`) disabled when blank; `await onAdd(body.trim())`, clears on success, inline `role="alert"` error `Não foi possível salvar a nota.` on rejection (text kept).
- `FollowupComposer({ today, onAdd, pending })`: `Input id="summary-followup-step"`, `<Input type="date" id="summary-followup-due" min={today}>`, button `Agendar próximo passo` (`data-followup-add`), disabled until both are valid and not before today; same success/error handling.
- Both are plain forms of buttons with `type="button"` and `self-stretch` is not needed (no inline field row).

### Container wiring (`LeadSummaryContainer.tsx`)
- new props `onRequestConversion?: (request: LeadConversionRequest) => Promise<string | null>`; hooks `useAdvanceLead`, `useAddLeadNote`, `useAddLeadFollowup`, `useMarkFollowupDone`, `useMoveLead(undefined)`, `usePipelines`.
- `opensConversionIds`: `new Set(pipeline.stages.filter(stageOpensOrcamentos).map((s) => s.id))` for the pipeline of the summary (`pickPipeline(pipelines, summary.pipeline.id)`).
- `onAdvance` shown to `LeadSummary` iff the lead is not converted; click sets `advanceOpen`.
- `onSubmit` -> `advance.mutateAsync({ leadId, ...payload })`.
- `onConvert(stage)` -> `if (!onRequestConversion) throw new Error('conversion_unavailable')`; `const saleId = await onRequestConversion({ lead, toStageId: stage.id, toIndex: 0 })`; `null` (operator cancelled) resolves without a write and keeps the dialog open (the dialog closes only after a non-null id); with an id `await moveLead.mutateAsync({ leadId, toStageId: stage.id, toIndex: 0, saleId })`.
- `notesSlot = <><NoteComposer .../><FollowupComposer .../></>`; `renderFollowupAction = (f) => <button data-followup-done={f.id} onClick={() => markDone.mutate(f.id)}>Concluir</button>` (`secondaryButtonClass`).
- `SalesOpsApp.tsx`: pass `onRequestConversion={requestLeadConversion}` to `<LeadSummaryContainer>` (the mount added in 09c). The pinned wiring regex only requires that `onRequestConversion={requestLeadConversion}` exists; a second occurrence is fine.
- `board-write-surface.test.ts` `OWNED_FILES`: add `advance.ts`, `AdvanceDialog.tsx`, `SummaryComposers.tsx`.

## Steps (TDD)
1. Write `advance.test.ts`, `advance-dialog.test.tsx`, extend `lead-summary-container.test.tsx`; red.
2. Add the four hooks; create `advance.ts`, `AdvanceDialog.tsx`, `SummaryComposers.tsx`; wire the container and `SalesOpsApp.tsx`.
3. Update `OWNED_FILES`; run the folder.

## Tests
- `advance.test.ts` (node): `advanceNeeds` for normal (followup true), orcamento with conversion (conversion true, followup false), saida ganho (all false), saida perdido with `requiresReason` (reason true, followup false); `validateAdvance`: missing next step, missing/invalid date, a past date (`2026-10-19` with today `2026-10-20`), missing reason, exit with nothing typed -> `null`, conversion -> `null`; `buildAdvancePayload` omits `nextStep`/`dueOn` for an exit and carries trimmed `note`; `advanceErrorCopy` maps the five cases and the fallback.
- `advance-dialog.test.tsx` (real Dialog + Combobox): the destination picker lists EXACTLY the given `nextStages` (3 given -> 3 options, a stage not given is absent); picking a normal stage reveals next step and date and `Avançar` stays disabled until both are valid; picking an exit hides them and enables `Avançar` at once; picking a perdido exit with `requiresReason` shows the reason box and blocks until typed; picking a conversion stage shows the hint, hides the fields and calls `onConvert` (not `onSubmit`) on confirm; a rejected `onSubmit` with `{status:409,error:'transition_not_allowed'}` keeps the dialog open with `ADVANCE_COPY.notAllowed` and the typed values; Escape on the open destination picker closes only the picker, a following Escape closes the dialog; the date input has `min` equal to today; the payload sent for a normal stage is `{ toStageId, nextStep, dueOn }`.
- `lead-summary-container.test.tsx` additions: `Avançar` posts through `advance.mutateAsync` with the lead id; the dialog only offers the summary's `nextStages`; a conversion destination calls `onRequestConversion` with `{ lead, toStageId, toIndex: 0 }` and, when it resolves `sale-1`, `moveLead.mutateAsync` receives `saleId: 'sale-1'`; when it resolves `null` nothing is written and the dialog stays open; adding a note calls `addLeadNote` and clears the textarea; scheduling a follow-up calls `addLeadFollowup` with `{ leadId, nextStep, dueOn }`; `Concluir` calls `markFollowupDone(id)`.
- `crm-api-contract.test.ts` already covers the wire bodies (part 08a).

## Affected tests search
`board-write-surface.test.ts` (OWNED_FILES list only); no other existing test touches the new files.

## Commands
- Oracle part: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/advance.test.ts src/sales-ops/leads/__tests__/advance-dialog.test.tsx src/sales-ops/leads/__tests__/lead-summary-container.test.tsx src/sales-ops/leads/__tests__/board-write-surface.test.ts`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads`
- lint and type-check for `@fxl-sales/web`

## Risks
- `toIndex: 0` puts a converted lead at the top of the destination column; the server owns the final position.
- The follow-up `type` table treats `orcamento` as requiring a follow-up when it does NOT open the conversion (behaviour `none`); that mirrors the contract wording ("NOT an exit stage").
