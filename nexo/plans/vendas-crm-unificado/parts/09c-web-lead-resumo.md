# Part 09c - Lead summary page (read view, Editar, click opens the summary)

Part of slice `09-web-lead-resumo`. Depends on parts 08a-08e, 09a, 09b.

## Context

- Cards and Lista rows open the editor today: `LeadCard.tsx` `handleClick` ends with `onEdit?.(lead)` (line 233), `SortableLeadCard` forwards `onEdit` (`LeadsBoard.tsx` lines 183-226), the board passes `onEditLead` (lines 143, 302, 757, 772) and the Lista row has an `Editar` button `data-edit-lead` calling `onEditLead?.(row)` (lines 1002-1006) using `EDIT_LABEL` (`board-labels.ts` line 142). A converted card opens its proposta (`readOnly` branch, lines 229-232); that stays.
- The summary data is `GET /leads/:id/summary` (`crmApi.getLeadSummary`, part 08a). Types `LeadSummaryResponse`, `LeadTimelineItem`, `LeadFollowup` are in `crm-types.ts`.
- The route `operacional/leads/:leadId` resolves to `route.leadId` (part 09a); `SalesOpsApp.tsx` currently renders nothing for it (guard at the leads mount, line ~2365).
- Helpers reused: `formatMoneyBrl` (`../calculations`), `displayDate` (`../civil-day`), `daysInCurrentStage`, `leadIsConverted`, `leadIsUnassigned` (`./calculations`), `UNASSIGNED_LEAD_LABEL` (`./board-labels`), `leadContactLine` (`./contact-lead`), `LeadDeleteDialog`, `UndoLayer`/`useUndoNotice` (09b), `LeadForm` (08d), `leadToWriteSeed` (08c).
- `SalesOpsApp.tsx` has `SALE_DETAIL_OPENED_IN_APP` (line 2808) as the precedent for "opened in-app": a router `state` marker that decides history mechanics only.

## Design

### New pure file `summary-format.ts` (no React)
- `formatInstantSaoPaulo(iso: string): string` -> `dd/mm/aaaa HH:mm` built from `Intl.DateTimeFormat('pt-BR', { timeZone: SAO_PAULO_TIME_ZONE, day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }).formatToParts`; invalid input returns `''`.
- `TIMELINE_LABEL: Record<LeadTimelineKind, (item: LeadTimelineItem) => { title: string; detail: string | null }>`:
  - `stage_changed`: title `item.fromStageName ? `Etapa: ${from} para ${to}` : `Entrou em ${to}``, detail `item.reason ? `Motivo: ${reason}` : null`;
  - `note`: title `Nota`, detail `item.body ?? null`;
  - `followup`: title `Próximo passo: ${item.nextStep}`, detail `Para ${displayDate(item.dueOn)}` plus ` - concluído em ${formatInstantSaoPaulo(doneAt)}` when `doneAt`.
- `sortTimeline(items)`: newest first by `at` (string compare of ISO instants after `Date.parse`), stable.
- `followupDueState(dueOn: string, today: string): 'overdue' | 'today' | 'later'` (string compare of civil days). `FOLLOWUP_STATE_LABEL = { overdue: 'Atrasado', today: 'Hoje', later: 'Agendado' }`.
- `FIELD_DISPLAY_BY_KIND: Record<FieldKind, (def: FieldDefinition, value: LeadFieldValue['value']) => string>`: text/number as string; money `formatMoneyBrl(cents)`; date `displayDate`; options -> the option label for the key (fallback the key); reference -> names joined by `, `. `formatFieldValue(def, value)` returns `''` for null/empty.
- `visibleFieldRows(lead, definitions): Array<{ id: string; label: string; text: string }>`: for each `lead.fields` entry whose definition exists, is not a `cliente` reference and formats to non-empty text, in definition `position` order.

### New file `lead-summary-nav.ts`
`export const LEAD_SUMMARY_OPENED_IN_APP = { leadSummaryOpenedInApp: true } as const; export function isLeadSummaryOpenedInApp(state: unknown): boolean` (object with that truthy key).

### New `LeadSummary.tsx` (presentational, props in / callbacks out)
```ts
export type LeadSummaryProps = {
  summary: LeadSummaryResponse; definitions: FieldDefinition[]; today: string; now: Date;
  onBack: () => void; onEdit: () => void; onAdvance?: () => void; onOpenSale?: (saleId: string) => void;
  notesSlot?: React.ReactNode; renderFollowupAction?: (followup: LeadFollowup) => React.ReactNode;
};
```
Root `<div data-lead-summary={lead.id} className="flex flex-col gap-4">`:
1. Header: `Voltar` button (`data-summary-back`, `secondaryButtonClass`), `<h2>` contact name, stage chip `<span data-summary-stage>{summary.stage.name}</span>` colored by `stageColors([{ id, kind: legacyKind, type, exitKind }])` (object lookup, no inline kind test; legacy kind from `legacyKindOf` of part 08a), pipeline name muted, then buttons: `Editar` (`data-summary-edit`) and `Avançar` (`data-summary-advance`). Both are NOT rendered for a converted lead (`leadIsConverted`); a converted lead shows `<button data-summary-open-sale>Abrir proposta {saleCode}</button>` calling `onOpenSale`. `Avançar` renders only when `onAdvance` is given and is `disabled` with `title="Não há próximas etapas para este lead."` when `summary.nextStages.length === 0`.
2. `Dados` card (`data-summary-section="dados"`): rows Cliente (`clientNameSnapshot` or `Sem cliente`), Contato (`leadContactLine`), Responsável (`sellerNameSnapshot` or, when `leadIsUnassigned`, `UNASSIGNED_LEAD_LABEL`), Valor estimado (`formatMoneyBrl`), Na etapa há N dias (`daysInCurrentStage(stageChangedAt, now)`), Criado em (`displayDate(saoPauloDayOf(new Date(createdAt)))`), then one row per `visibleFieldRows`. Never an id.
3. `Próximos passos` (`data-summary-section="followups"`): open follow-ups (`doneAt === null`) sorted by `dueOn`, each: next step, `displayDate(dueOn)`, owner, a badge from `followupDueState`, and `renderFollowupAction?.(f)`; empty text `Nenhum próximo passo agendado.`
4. `notesSlot` (09d mounts the composer here).
5. `Histórico` (`data-summary-section="timeline"`): `sortTimeline(summary.timeline)` as a list `<li data-timeline-kind={item.kind}>` with title, detail, `formatInstantSaoPaulo(at)` and `actorName` (fallback `Autor não identificado`).

### New `LeadSummaryContainer.tsx` (the only new file that names hooks)
Props: `{ leadId: string; workspace: SalesOpsWorkspace; clients: SalesOpsClient[]; products: SalesOpsProduct[]; sellers: ComboboxOption[]; onCreateClient?; onOpenSale?: (saleId: string) => void }`.
- Hooks: `useLeadSummary(leadId)` (add to `crm-hooks.ts`: key `queryKeys.leads.detail(leadId)`, `crmApi.getLeadSummary`, `retry` left default), `useFieldDefinitions()`, `useSaveLead()`, `useDeleteLead()`, `useUndoNotice()`, `useAuthProfile().roles.includes('admin')`, `useNavigate()`, `useLocation()`.
- States: pending -> `<Skeleton className="h-[320px] w-full" />`; error with `status === 404` -> `<p className={mutedStateClass}>Lead não encontrado.</p>` plus a `Voltar` button; other error -> `Não foi possível carregar o lead.`
- `today = React.useMemo(() => todayInSaoPaulo(), [])`, `now = React.useMemo(() => new Date(), [])`.
- Back: `isLeadSummaryOpenedInApp(location.state) ? navigate(-1) : navigate(buildSalesOpsPath({ workspace, view: 'funil' }), { replace: true })`.
- Edit: `editOpen` state; `<LeadForm key={lead.id} initial={lead} definitions=... showSellerPicker={isAdmin} onDelete={leadIsConverted(lead) ? undefined : () => setDeleteTarget(lead)} onSubmit={saveWithUndo} .../>` mounted only after definitions settled (same rule as 08e). `saveWithUndo` is the 08e function with `requireUnchangedLead` implemented as `const fresh = await summaryQuery.refetch({ throwOnError: true }); if (JSON.stringify(fresh.data?.lead) !== JSON.stringify(expected)) throw new UndoConflictError(UNDO_CONFLICT)`; the publish goes through `undo.publish('Lead editado', ...)`. The `LeadForm` has no `pipelineId` (edit).
- Delete: `LeadDeleteDialog key={`delete:${id}`}`; `onConfirm` awaits `deleteLead.mutateAsync(lead.id)` then `navigate(buildSalesOpsPath({ workspace, view: 'funil' }), { replace: true })`.
- Renders `<LeadSummary ... />`, the form, the delete dialog and `<UndoLayer undo={undo} />`.

### Board changes (click opens the summary, never the form)
- `LeadCard.tsx`: rename prop `onEdit` -> `onOpen` (type line 66, destructure line 165, call line 233). `SortableLeadCard` and `LeadsBoard`: prop `onEditLead` -> `onOpenLead` (lines 143, 183, 199, 225, 302, 757, 772, 1003). `board-labels.ts`: `EDIT_LABEL` -> `OPEN_LABEL = 'Abrir'`; Lista button attribute `data-edit-lead` -> `data-open-lead`.
- `LeadsBoardContainer.tsx`: delete `editingLead`, `saveWithUndo`'s edit branch (the form is create-only now: `onSubmit={saveLead.mutateAsync}`), `requestDeleteFromForm`, and the `onEditLead` prop; add `onOpenLead={workspace ? (lead) => navigate(buildLeadSummaryPath(workspace, lead.id), { state: LEAD_SUMMARY_OPENED_IN_APP }) : undefined}`. Imports: `buildLeadSummaryPath` from `../navigation`, `LEAD_SUMMARY_OPENED_IN_APP` from `./lead-summary-nav`. The edit undo and `leadToWriteSeed` import leave this file.
- `SalesOpsApp.tsx`: next to the leads mount (line ~2365) add
  ```tsx
  {view === 'leads' && resolution.route.leadId ? (
    <LeadSummaryContainer leadId={resolution.route.leadId} workspace={workspace}
      clients={persistedBootstrap.clients} products={persistedBootstrap.products} sellers={leadSellerOptions}
      onCreateClient={async (name) => { const client = await createClientByName(name); return client ? { value: client.id, label: client.name } : null; }}
      onOpenSale={openSaleFromBoard} />
  ) : null}
  ```
  and the import near line 156. The board-write-surface fences are untouched (no conversion code is added here; 09d passes `onRequestConversion`).
- `board-write-surface.test.ts` `OWNED_FILES`: add `LeadSummary.tsx`, `LeadSummaryContainer.tsx`, `summary-format.ts`, `lead-summary-nav.ts`. They obey the bans (no `/transition`, no `@/lib/api-client`, no `useMutation`, no inline stage kind comparison, no string `'converted'`).

## Steps (TDD)
1. Write `summary-format.test.ts`, `lead-summary.test.tsx`, `lead-summary-container.test.tsx` (Tests) and update the renamed-prop tests; run: red.
2. Create `summary-format.ts`, `lead-summary-nav.ts`, `LeadSummary.tsx`, add `useLeadSummary`, create `LeadSummaryContainer.tsx`.
3. Apply the board renames and the container/SalesOpsApp edits; update `OWNED_FILES`.
4. Run the leads folder and `src/sales-ops/__tests__`.

## Tests
- `summary-format.test.ts` (node): `formatInstantSaoPaulo('2026-10-21T01:30:00.000Z')` is `20/10/2026 22:30`; each `TIMELINE_LABEL`; `sortTimeline` newest first; `followupDueState` (`2026-10-19`/`2026-10-20`/`2026-10-21` vs today `2026-10-20`); `formatFieldValue` per kind (money `150000` -> `R$ 1.500,00`, option label, reference names); `visibleFieldRows` skips the cliente reference and empty values.
- `lead-summary.test.tsx` (happy-dom): shows stage, pipeline, dados rows, open follow-ups with the state badge, newest-first timeline; `Avançar` renders only with `onAdvance`, is disabled with no `nextStages`; a converted lead shows `Abrir proposta` and neither `Editar` nor `Avançar`; no raw uuid in `textContent`.
- `lead-summary-container.test.tsx` (mock `../crm-hooks` and `../hooks`, real Dialog): `Editar` opens the LeadForm seeded with the lead; saving calls `mutateAsync` with the lead id and offers `Lead editado` undo whose click sends `leadToWriteSeed(previous, addedFieldIds)`; a 404 shows `Lead não encontrado.` with no id; `Voltar` pops history when opened in-app and replaces with the funil otherwise (MemoryRouter with/without state); deleting from the form confirms, posts and navigates to `/operacional/funil`.
- Clicking a card opens the summary, not the form (named oracle): in `leads-contact-board.test.tsx` and `lead-delete.test.tsx` (`a plain click on the card body opens the summary`) assert `onOpenLead` is called with the lead and that no `[role="dialog"]` / `#lead-contact-name` exists; in a container test (`leads-contact-container.test.tsx`, new case `a card click navigates to the lead summary`) assert the router location becomes `/operacional/leads/<id>` with the in-app state.
- Renames in existing tests (mechanical, same assertions): `onEditLead` -> `onOpenLead`, `onEdit` -> `onOpen`, `data-edit-lead` -> `data-open-lead`, button text `Editar` -> `Abrir` in `leads-board-keyboard`, `leads-contact-board`, `leads-list-view` (test title `carries Mover and Abrir actions; Abrir calls onOpenLead`), `leads-board-dropzones`, `leads-board-scroll`, `leads-board-search`, `lead-board-totals`, `lead-unassigned-marker`, `lead-delete`, `lead-conversion`, `leads-full-edition`.
- `lead-undo.test.tsx`: remove the edit-undo cases that open the editor from the Lista (`restores prior fields by inverse PATCH`, `refuses a stale inverse edit...`); the same two behaviours are asserted in `lead-summary-container.test.tsx` (above). No behaviour is dropped.
- `board-write-surface.test.ts`: still green with the extended `OWNED_FILES`.

## Affected tests search
Greps run: `onEditLead|onEdit\b|data-edit-lead|Editar` over `apps/web/src/sales-ops/leads/__tests__` and `__tests__`; hits listed above are the only ones in leads scope (others such as `pessoas-funcoes-view` use unrelated `onEdit`).

## Commands
- Oracle part: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-summary.test.tsx src/sales-ops/leads/__tests__/lead-summary-container.test.tsx src/sales-ops/leads/__tests__/summary-format.test.ts`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks
- The summary query shares `['leads']` root, so every lead write refreshes it; fine.
- Removing edit from the board drops `Lead editado` undo there; it is re-homed on the summary.
