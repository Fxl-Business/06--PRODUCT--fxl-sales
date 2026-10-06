---
id: 06-web-leads-contact-ui
milestone: v4.3.0
status: done
depends_on: [04-api-leads-edition, 05-web-edition-navigation]
files_modified:
  - apps/web/src/lib/api-client.ts
  - apps/web/src/lib/__tests__/api-client-reason.test.ts
  - nexo/knowledge/reference/kanban-de-leads.md
  - apps/web/src/sales-ops/leads/types.ts
  - apps/web/src/sales-ops/leads/api.ts
  - apps/web/src/sales-ops/leads/hooks.ts
  - apps/web/src/sales-ops/leads/contact-lead.ts
  - apps/web/src/sales-ops/leads/ContactLeadDialog.tsx
  - apps/web/src/sales-ops/leads/LeadCard.tsx
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx
  - apps/web/src/sales-ops/leads/__tests__/contact-lead.test.ts
  - apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - apps/web/src/sales-ops/leads/__tests__/board-labels.test.ts
  - apps/web/src/sales-ops/leads/__tests__/board-move.test.ts
  - apps/web/src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-conversion-prefill.test.ts
  - apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-optimistic.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-move-rollback.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-board-fanout.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-calculations.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-columns.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/move-dialog-inline-layer.test.tsx
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-deep-link.test.tsx
  - apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx
acceptance: "With useSalesEdition() === 'leads' the lead dialog renders exactly Nome, Data de aniversário (date input, max = todayInSaoPaulo()), Número (telefone/WhatsApp), Email, Descrição and Vendedor responsável, blocks a blank Nome and a future birthday, and sends a six-key ContactLeadPayload; the Quadro card and the Lista rows show phone/email and the birthday (dd/mm/aaaa via displayDate) and never empresa, produtos, valor or any R$ total, % do total or proportion bar; with zero active etapas the board shows the admin empty-state with a button to /cadastros/etapas or the seller copy, and Novo lead is disabled; a create answered 400 with reason 'no_open_stage' (SEAM A1) renders the inline no-etapa notice and any other failure the generic save notice; the board never receives onRequestConversion or onOpenSale in the leads edition. With 'full' every leads component renders byte-identical markup to today."
goal: "Give the leads edition a contact-only lead dialog, contact-only card and list, a zero-etapas empty-state and an inline no-etapa error (400 reason no_open_stage), while the full edition (FXL) renders exactly today's UI."
must_not_break:
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts (OWNED_FILES only grows)
  - apps/web/src/sales-ops/leads/__tests__/lead-dialog.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-columns.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/move-dialog-inline-layer.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/board-ui.test.ts
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-deep-link.test.tsx
  - "pnpm --filter @fxl-sales/web lint / type-check / test / build"
oracle: apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx
oracles:
  - apps/web/src/sales-ops/leads/__tests__/contact-lead.test.ts
  - apps/web/src/sales-ops/leads/__tests__/contact-lead-dialog.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
rules:
  - "Never touch apps/web/src/sales-ops/SalesOpsApp.tsx. The WIRING_PINS of board-write-surface.test.ts pin `onRequestConversion={requestLeadConversion}` there; the leads-edition guard lives in LeadsBoardContainer.tsx."
  - "LeadDialog.tsx is NOT edited. The contact dialog is a separate component, so the full dialog is byte-identical by construction."
  - "No native <select>, <option>, <datalist>, no raw <input type=\"number\">. The birthday uses `<Input type=\"date\">` from @/components/ui/input."
  - "No string 'converted', no `kind === 'normal'|'lost'|'conversion'` in any leads file. Stage questions go through stageIsNormal / stageOpensConversion / boardStages only."
  - "The birthday is never passed through `new Date`. Display is `displayDate`, the comparison with today is an ISO string comparison, today is `todayInSaoPaulo()` from the `@fxl-sales/shared-utils/sao-paulo-day` subpath."
  - "Import the edition helpers only from `@fxl-sales/shared-utils/sales-edition`, never the package root."
  - "Never render a raw id. Phone and email are user-typed contact data and may be rendered."
  - "pt-BR copy, no em dash anywhere (code, comments, copy, this slice's notes)."
  - "No new dependency. Tests use createRoot + act + happy-dom like the existing leads tests."
verifier_focus: "That a full-edition render of LeadsBoard and LeadCard is innerHTML-identical with fieldSet omitted and fieldSet='full'; that LeadDialog.tsx and SalesOpsApp.tsx have an empty diff; that the contact payload has exactly six keys; that the container hands LeadsBoard `onRequestConversion: undefined` in the leads edition; that zero etapas no longer leaves the container on the Skeleton forever."
---

# Slice 06 - web leads contact UI (edição leads)

## Objective

In the leads edition (`leadFieldSet(useSalesEdition()) === 'contact'`) the lead board becomes a contact board.
The dialog asks only for Nome, Data de aniversário, Número, Email, Descrição and Vendedor responsável.
The card and the list show contact data instead of empresa, produtos and valor, and every R$ figure disappears from the board.
An org with zero active etapas sees an empty-state instead of an empty scroller, and `Novo lead` is disabled.
The full edition (FXL) renders exactly today's UI, proven by markup-equality oracles.

## Code facts (verified while planning, on master 554362b)

- `LeadsBoardContainer.tsx` is the only leads file that calls hooks; `LeadsBoard`, `LeadCard`, `LeadDialog`, `MoveLeadDialog` are pure props-in components.
  This slice keeps that split: the container reads the edition once and passes `fieldSet` down as a prop.
  That satisfies SEAM-CONTRACT section 4 ("components read `leadFieldSet(useSalesEdition())`") through one read site, and keeps every presentational oracle free of auth mocks.
- `useLeadsBoard(stages, filters)` has `enabled: stages.length > 0`.
  With zero stage rows the infinite query never runs, `boardQuery.isPending` stays `true` forever, and today's container renders the Skeleton forever.
  In the leads edition a fresh org has zero etapas (SEAM decision 5), so this must be fixed in the container, not in the hook.
- `LeadsBoardContainer` today calls `saveLead.mutate(payload)` and `LeadDialog.save()` closes the dialog before the request answers, so a rejected save is invisible.
  The contact path uses `mutateAsync` and renders the rejection inline; the full path keeps `mutate` byte-identical.
- `board-write-surface.test.ts` scans `OWNED_FILES` for `/transition`, `transitionSale`, `@/lib/api-client`, `@/lib/app-mutation`, inline kind comparisons and the literal `'converted'`.
  Its `WIRING_PINS` require `onRequestConversion={requestLeadConversion}` to stay verbatim in `SalesOpsApp.tsx`.
- `leadsApi.saveLead({ id, ...body })` spreads the payload into the body; POST without `id`, PATCH `/leads/:id` with it.
- `displayDate(value)` in `apps/web/src/sales-ops/civil-day.ts` slices the first ten characters and formats `dd/mm/aaaa`; it accepts both `1990-02-28` and `1990-02-28T00:00:00.000Z`.
- `isIsoDay` and `todayInSaoPaulo` are exported by `packages/shared-utils/src/sao-paulo-day.ts` (subpath `@fxl-sales/shared-utils/sao-paulo-day`).
- On master 554362b the `vi.mock('@/auth/react', ...)` factories in `lead-conversion.test.tsx`, `leads-routing.test.tsx`, `sale-deep-link.test.tsx` and `import-routing.test.tsx` export `useAuthProfile`, `useAccessToken`, `useLogout`, `useOrganizations`, and no `useSalesEdition`.
  Vitest throws on a missing export of a factory mock when the export is read, so any test that mounts `LeadsBoardContainer` needs `useSalesEdition` in its factory.
  SEAM A5: slice 05 (merged before this slice) added `useSalesEdition: () => 'full'` to every one of those factories and pinned it with `auth-mock-edition-export.test.ts`.
- Twelve leads test files build `SalesOpsLead` fixtures typed as `SalesOpsLead` (listed in `files_modified`); adding three required fields makes `tsc` flag each builder.

## Seam requirements on slice 04 (checked first, not decided here)

- `ContactLeadFieldsSchema` accepts `null` for `contactPhone`, `contactEmail`, `contactBirthDate`, `description` and `sellerPersonId` (nullish, plus `''` read as `null`).
  The web sends `null` for an empty optional field so that a PATCH can clear it.
- Every lead read returns `contactPhone`, `contactEmail`, `contactBirthDate` (ISO day or `null`).
- A create with no active normal etapa answers the EXISTING `400 {"error":"validation_error","reason":"no_open_stage","itemIndex":-1}` (SEAM A1; there is no `409 no_stage`).
  The web keys on status `400` plus `reason === 'no_open_stage'`.
  Today `apiFetch` drops the body's `reason`, so this slice adds an optional `reason` to `ApiError` (step 0b).

Step 0 of Execute: open `apps/api/src/domains/sales-ops/leads/lead-schemas.ts` on the integrated master and confirm the first point (SEAM A2; slice 04 normalizes `''` and accepts `null` for all five optional keys).
If `ContactLeadFieldsSchema` rejects `null`, STOP and record a blocker in `AUDIT.md` naming slice 04; do not change the web payload to work around it.

## Exact changes

### 0b. `apps/web/src/lib/api-client.ts` (additive, SEAM A1)

- Add to `type ApiError`, after `code?: string;`, the member `reason?: string;` with a doc comment: the API's validation sub-reason (`reason` in a 400 `validation_error` body, for example `no_open_stage`); display-copy selection only, auth classification still keys on `status`.
- In `apiFetch`'s error branch, after the `retryAfterSeconds` lines: `if (typeof body.reason === 'string') err.reason = body.reason;` (set only when present, so no existing error object gains an `undefined` key).
- `apiFetchBlob` and `apiUpload` are unchanged.
- New test `apps/web/src/lib/__tests__/api-client-reason.test.ts` (node environment, `fetch` stubbed with `vi.stubGlobal` like `api-client-token-guard.test.ts`): a `400` body `{"error":"validation_error","reason":"no_open_stage","itemIndex":-1}` rejects with `{ status: 400, error: 'validation_error', reason: 'no_open_stage' }` (`toMatchObject`); a `400` body without `reason` rejects with an object for which `'reason' in err` is `false`.

### 1. `apps/web/src/sales-ops/leads/types.ts`

Add three REQUIRED fields to `SalesOpsLead`, after `description`:

```ts
  /** Leads edition contact data. Always on the wire, null for FXL rows. Free text, max 40. */
  contactPhone: string | null;
  /** Lowercased by the API. User contact data, never an identifier. */
  contactEmail: string | null;
  /** ISO civil day `YYYY-MM-DD`. Display only through `displayDate`, never `new Date`. */
  contactBirthDate: string | null;
```

Then run `pnpm --filter @fxl-sales/web type-check` and add `contactPhone: null, contactEmail: null, contactBirthDate: null` to every lead fixture builder it flags (expected: the twelve leads test files in `files_modified`, plus `move-dialog-inline-layer.test.tsx`'s `LEAD` constant).
Fixtures built with `as SalesOpsLead` (`leads-list-view.test.tsx`) also get the three keys, so no fixture silently carries `undefined`.

### 2. `apps/web/src/sales-ops/leads/api.ts`

Add, next to `SaveLeadPayload`:

```ts
/**
 * The leads-edition write body, mirroring `ContactLeadFieldsSchema` key for key.
 * Every optional key is always SENT (null when empty) so a PATCH can clear it.
 * There is no clientName, no products and no estimatedValueBrl: the API stores
 * client_id null, an empty snapshot and 0 itself.
 */
export type ContactLeadPayload = {
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  contactBirthDate: string | null;
  description: string | null;
  sellerPersonId: string | null;
};

export type SaveContactLeadPayload = ContactLeadPayload & { id?: string };
```

Change only the parameter type of `saveLead` to `({ id, ...body }: SaveLeadPayload | SaveContactLeadPayload, token: Token)`.
The function body is unchanged.

### 3. `apps/web/src/sales-ops/leads/hooks.ts`

Change only the third type argument of `useSaveLead`'s `useAppMutation` to `SaveLeadPayload | SaveContactLeadPayload` and import the type.
Invalidation (`queryKeys.leads.all`) is unchanged.

### 4. New `apps/web/src/sales-ops/leads/contact-lead.ts` (pure, React-free)

Imports: `isIsoDay` from `@fxl-sales/shared-utils/sao-paulo-day`, `displayDate` from `../civil-day`, types from `./api` and `./types`.
Exports exactly:

```ts
export const CONTACT_LEAD_COPY = {
  dialogDescription: 'Dados de contato do lead.',
  nameLabel: 'Nome',
  birthDateLabel: 'Data de aniversário',
  phoneLabel: 'Número (telefone/WhatsApp)',
  emailLabel: 'Email',
  descriptionLabel: 'Descrição',
  sellerLabel: 'Vendedor responsável',
  sellerPlaceholder: 'Selecione o vendedor',
  nameRequired: 'Informe o nome.',
  birthDateInvalid: 'Informe uma data de aniversário válida.',
  birthDateFuture: 'A data de aniversário não pode ser no futuro.',
  emailInvalid: 'Informe um email válido.',
  noContact: 'Sem contato',
  birthdayPrefix: 'Aniversário',
  noStageError: 'Nenhuma etapa ativa no funil. O lead não foi salvo.',
  saveFailed: 'Não foi possível salvar o lead. Tente novamente.',
  emptyStagesAdmin: 'Nenhuma etapa configurada. Crie as etapas do funil em Cadastros.',
  emptyStagesAdminAction: 'Ir para Etapas do funil',
  emptyStagesSeller: 'Nenhuma etapa configurada. Fale com o gestor.',
} as const;

export const CONTACT_LIST_HEADERS = {
  lead: 'Lead',
  phase: 'Fase',
  birthday: 'Aniversário',
  seller: 'Vendedor',
  inStage: 'Na fase',
  actions: 'Ações',
} as const;

/** Form state: every field a string except the picker. */
export type ContactLeadDraft = {
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  contactBirthDate: string;
  description: string;
  sellerPersonId: string | null;
};

export function contactDraftFromSeed(initial: SaveContactLeadPayload | null): ContactLeadDraft;
// null-safe: every null becomes '' (sellerPersonId stays null).

export function validateContactLeadDraft(draft: ContactLeadDraft, today: string): string | null;
// Order, first hit wins:
//   contactName.trim() === ''                         -> CONTACT_LEAD_COPY.nameRequired
//   birth !== '' && !isIsoDay(birth)                  -> birthDateInvalid
//   birth !== '' && birth > today  (string compare)   -> birthDateFuture
//   email !== '' && !EMAIL_PATTERN.test(email)        -> emailInvalid
//   otherwise null
// where birth = draft.contactBirthDate.trim(), email = draft.contactEmail.trim(),
// and EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/ (module-private const).

export function buildContactLeadPayload(draft: ContactLeadDraft, id?: string): SaveContactLeadPayload;
// { ...(id ? { id } : {}), contactName: trimmed, contactPhone, contactEmail,
//   contactBirthDate, description: trimmed or null when blank, sellerPersonId }
// Each string field is trimmed; a blank one becomes null. No lowercasing (the API owns it).
// Key order exactly as listed so JSON bodies are stable.

export function leadToContactSeed(lead: SalesOpsLead): SaveContactLeadPayload;
// { id, contactName, contactPhone, contactEmail, contactBirthDate, description, sellerPersonId }

export function leadContactLine(lead: SalesOpsLead): string;
// [contactPhone, contactEmail] trimmed, blanks dropped, joined with ' · ';
// CONTACT_LEAD_COPY.noContact when both are blank.

export function leadBirthdayLabel(lead: SalesOpsLead): string | null;
// null when contactBirthDate is null or blank, else displayDate(contactBirthDate).

export function contactLeadSaveErrorCopy(error: unknown): string;
// noStageError when `typeof error === 'object' && error !== null`
//   && (error as { status?: unknown }).status === 400
//   && (error as { reason?: unknown }).reason === 'no_open_stage'; saveFailed otherwise.
// SEAM A1: status 400 plus reason no_open_stage. Structural check only: this file must
// not import @/lib/api-client (board-write-surface OWNED_FILES rule).
```

### 5. New `apps/web/src/sales-ops/leads/ContactLeadDialog.tsx`

Props:

```ts
export type ContactLeadDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null means create. */
  initial: SaveContactLeadPayload | null;
  /** Pessoas with the vendedor função, resolved by the caller (same list LeadDialog gets). */
  sellers: ComboboxOption[];
  onSubmit: (payload: SaveContactLeadPayload) => void;
  pending?: boolean;
  /** Injected for tests; defaults to todayInSaoPaulo() read once at mount. */
  today?: string;
};
```

Behaviour, mirroring `LeadDialog`'s structure and classes from `./board-ui`:
- MOUNT-SCOPED state, no reset effect: `const [draft, setDraft] = React.useState(() => contactDraftFromSeed(initial));` and `const [todayDay] = React.useState(() => today ?? todayInSaoPaulo());`.
- `const blocked = validateContactLeadDraft(draft, todayDay);`.
- Title `initial?.id ? 'Editar lead' : 'Novo lead'`; `DialogDescription` is `CONTACT_LEAD_COPY.dialogDescription`.
- `DialogContent className="max-w-xl"`, body `div.flex.max-h-[60vh].flex-col.gap-4.overflow-y-auto`, each field a `div.flex.flex-col.gap-1.5`.
- Fields, in this exact order, with these ids and labels:
  1. `<label htmlFor="lead-contact-name">Nome</label>` with `<span aria-hidden="true"> *</span>` inside the label; `<Input id="lead-contact-name" className={formInputClass} maxLength={140} required>`.
  2. `<label htmlFor="lead-birth-date">Data de aniversário</label>`; `<Input id="lead-birth-date" type="date" className={formInputClass} max={todayDay}>`.
  3. `<label htmlFor="lead-phone">Número (telefone/WhatsApp)</label>`; `<Input id="lead-phone" type="tel" inputMode="tel" autoComplete="tel" className={formInputClass} maxLength={40}>`.
  4. `<label htmlFor="lead-email">Email</label>`; `<Input id="lead-email" type="email" autoComplete="email" className={formInputClass} maxLength={254}>`.
  5. `<label htmlFor="lead-description">Descrição</label>`; `<textarea id="lead-description" className={formTextareaClass} maxLength={4000}>`.
  6. `<span id="lead-seller-label">Vendedor responsável</span>`; `<Combobox aria-labelledby="lead-seller-label" className={formSelectClass} options={sellers} placeholder="Selecione o vendedor">` with no `onCreate` (a pessoa is invalid without a função). `Combobox` already calls `useInlineLayer`; nothing else here opens a layer.
- Each input updates its draft key through `setDraft((d) => ({ ...d, key: value }))`.
- Blocked notice: `<p className={blockedNoticeClass} data-lead-blocked="true">{blocked}</p>` when `blocked !== null`.
- Footer exactly like `LeadDialog`: `Cancelar` (`type="button"`, closes) and `Salvar` (`type="button"`, `data-lead-save="true"`, `disabled={blocked !== null || pending}`, `onClick={save}`).
- `save()`: return when blocked; `onSubmit(buildContactLeadPayload(draft, initial?.id)); onOpenChange(false);`.

### 6. `apps/web/src/sales-ops/leads/LeadCard.tsx`

- New optional prop `fieldSet?: LeadFieldSet` (type from `@fxl-sales/shared-utils/sales-edition`), default `'full'`.
- `const contact = fieldSet === 'contact';`.
- The top block becomes a branch.
  `!contact` keeps the current JSX character for character (name, `leadCompanyLabel`, R$ value span).
  `contact` renders:

```tsx
<div className="flex min-w-0 flex-col gap-0.5">
  <span className="text-[14px] font-semibold text-[#201f24]">{lead.contactName}</span>
  <span className="truncate text-[12.5px] text-[#8b8b92]" data-lead-contact>
    {leadContactLine(lead)}
  </span>
  {birthday !== null ? (
    <span className="text-[12px] text-[#8b8b92]" data-lead-birthday>
      {`${CONTACT_LEAD_COPY.birthdayPrefix} ${birthday}`}
    </span>
  ) : null}
</div>
```

  where `const birthday = contact ? leadBirthdayLabel(lead) : null;`.
- The product chips block renders only when `!contact && productLabels.length > 0`.
- Lost-reason note, sale block, seller footer, days badge, pointer guard (`ACTIVATION_DISTANCE = 6`), `handlePointerDown`/`handleClick` are unchanged.

### 7. `apps/web/src/sales-ops/leads/LeadsBoard.tsx`

New optional props on `LeadsBoardProps`, documented in the same comment style:

```ts
  /** 'contact' in the leads edition. Default 'full' renders today's board. */
  fieldSet?: LeadFieldSet;
  /** Leads edition empty-state: true shows the gestor copy and action, false the vendedor copy. */
  canManageStages?: boolean;
  /** Leads edition empty-state action. Absent means no button. */
  onOpenStagesCadastro?: () => void;
```

Inside the component:
- `const contact = fieldSet === 'contact';` and `const noStages = contact && columns.length === 0;`.
- `SortableCardProps` gains `fieldSet?: LeadFieldSet`; `SortableLeadCard` forwards it to `LeadCard`.
  Both card render sites in the columns and the `DragOverlay` card pass `fieldSet={fieldSet}`.
- `Novo lead` button: add `disabled={noStages}` (React omits the attribute when `false`, so the full markup is unchanged).
- Body: when `noStages`, render this INSTEAD of the board/list ternary (the header with the toggle and the filter stays):

```tsx
<div
  className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-[18px] border-[1.5px] border-dashed border-[#e8e8ec] p-8 text-center"
  data-no-stages={canManageStages ? 'admin' : 'seller'}
>
  <p className="text-[14px] text-[#57575f]">
    {canManageStages ? CONTACT_LEAD_COPY.emptyStagesAdmin : CONTACT_LEAD_COPY.emptyStagesSeller}
  </p>
  {canManageStages && onOpenStagesCadastro ? (
    <button className={primaryButtonClass} data-open-stages-cadastro onClick={onOpenStagesCadastro} type="button">
      {CONTACT_LEAD_COPY.emptyStagesAdminAction}
    </button>
  ) : null}
</div>
```

- Column header: wrap the totals row (`data-stage-total`, `PERCENT_OF_TOTAL`) and the proportion track (`data-stage-bar`) in `{!contact ? (<>...</>) : null}`; the dot, name, `data-stage-count` and `Ver em lista` stay.
- Lista phase chips: the `fmtBrl0(totalGeral)` span in `Todas as fases` and the `fmtBrl0(totalByStage...)` span in each stage chip render only when `!contact`; `data-phase-count` stays in both.
- Lista table, when `contact`:
  - Headers: `CONTACT_LIST_HEADERS.lead`, `.phase`, `.birthday`, `.seller`, `.inStage`, `.actions` (the last `text-right`).
  - Row cells: Lead (name plus second line `leadContactLine(row)` with `data-row-contact`), Fase (unchanged chip), Aniversário (`leadBirthdayLabel(row) ?? NO_PRODUCTS_DASH`, `data-row-birthday`), Vendedor (unchanged), Na fase (unchanged), Ações (unchanged).
  - Empty row `colSpan={contact ? 6 : 7}`.
  - When `!contact` the current header row and cells are untouched (render them in the `else` arm, character for character).
- Lista footer: the `TOTAL` block (`TOTAL_LABEL` plus `data-list-total`) renders only when `!contact`; `scopeLeadsCount` stays.
- No other change: `emitMove`, drag handlers, `moveTargetsFor`, `MoveLeadDialog` wiring, `stageColors`, `stageIsNormal` untouched.

### 8. `apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx`

- Imports: `useNavigate` from `react-router-dom`; `useAuthProfile`, `useSalesEdition` from `@/auth/react`; `leadFieldSet` from `@fxl-sales/shared-utils/sales-edition`; `buildSalesOpsPath` from `../navigation`; `ContactLeadDialog`; `blockedNoticeClass`; `SaveContactLeadPayload`; `contactLeadSaveErrorCopy`, `leadToContactSeed` from `./contact-lead`.
- New reads at the top of the component (before any early return, hooks order fixed):

```ts
const fieldSet = leadFieldSet(useSalesEdition());
const canManageStages = useAuthProfile().roles.includes('admin');
const navigate = useNavigate();
const [contactSeed, setContactSeed] = React.useState<SaveContactLeadPayload | null>(null);
const [saveError, setSaveError] = React.useState<string | null>(null);
```

- Skeleton guard becomes `if (stagesQuery.isPending || (stages.length > 0 && boardQuery.isPending))`.
  A comment states why: `useLeadsBoard` is disabled with zero stage rows and would stay pending forever.
  FXL always has stage rows, so its behaviour is unchanged.
- `onCreateLead`: `setDialogSeed(null); setContactSeed(null); setSaveError(null); setDialogOpen(true);`.
- `onEditLead(lead)`: `setDialogSeed(leadToSeed(lead)); setContactSeed(leadToContactSeed(lead)); setSaveError(null); setDialogOpen(true);`.
- `LeadsBoard` additionally receives `fieldSet={fieldSet}`, `canManageStages={canManageStages}`, `onOpenStagesCadastro={() => navigate(buildSalesOpsPath({ workspace: 'cadastros', view: 'etapas' }))}`.
- DEFENSIVE CONVERSION GUARD: `onRequestConversion={fieldSet === 'full' ? onRequestConversion : undefined}` and `onOpenSale={fieldSet === 'full' ? onOpenSale : undefined}`, with a comment: the leads edition has no proposta, so the board must never be handed the conversion door even if a conversion-kind etapa somehow exists; `moveTargetsFor` then excludes it and `emitMove` returns early.
- Above `<LeadsBoard>`: `{saveError !== null ? <p className={blockedNoticeClass} data-lead-save-error="true" role="alert">{saveError}</p> : null}`.
- Dialog mount: the existing `LeadDialog` block gets the condition `dialogOpen && fieldSet === 'full'` and is otherwise unchanged (`saveLead.mutate`).
  Add:

```tsx
{dialogOpen && fieldSet === 'contact' ? (
  <ContactLeadDialog
    initial={contactSeed}
    key={contactSeed?.id ?? 'novo'}
    onOpenChange={setDialogOpen}
    onSubmit={(payload) => {
      setSaveError(null);
      saveLead.mutateAsync(payload).catch((error: unknown) => {
        setSaveError(contactLeadSaveErrorCopy(error));
      });
    }}
    open
    pending={saveLead.isPending}
    sellers={sellers}
  />
) : null}
```

  Prefix with `void` if `@typescript-eslint/no-floating-promises` is active.

### 9. `apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts`

Append `'contact-lead.ts'` and `'ContactLeadDialog.tsx'` to `OWNED_FILES`.
Nothing else changes in that file.

### 10. Auth mocks in tests that mount the container

SEAM A5: slice 05 already added `useSalesEdition` to every existing `vi.mock('@/auth/react', ...)` factory and pinned it with `apps/web/src/auth/__tests__/auth-mock-edition-export.test.ts`.
This slice adds it only to its own new test files (`leads-contact-container.test.tsx` already has it) and edits no existing factory for that purpose; the guard test must stay green.

### 11. `nexo/knowledge/reference/kanban-de-leads.md` (on top of slice 04's section)

Append to slice 04's `## Edição Leads (2026-10-05, edicao-leads)` section, one sentence per line: the container reads `leadFieldSet(useSalesEdition())` once and passes `fieldSet` down; `LeadDialog.tsx` is untouched and `ContactLeadDialog.tsx` is the leads-edition dialog; the contact card and Lista show phone, email and birthday (`displayDate`) and no R$, `% do total`, proportion bar or footer total; zero active etapas render `[data-no-stages]` (gestor action to `/cadastros/etapas`, vendedor copy) with `Novo lead` disabled; the container no longer waits on the disabled board query when there are zero etapas; the board is never handed `onRequestConversion` / `onOpenSale` in the leads edition; a `400` with `reason: 'no_open_stage'` renders the inline notice (`ApiError.reason`); oracles `leads-contact-board.test.tsx`, `leads-contact-container.test.tsx`, `leads-full-edition.test.tsx`.

## Tests (oracles)

All `.tsx` tests start with `// @vitest-environment happy-dom` and use the `act`, `settle`, `click`, `typeInto` helpers copied from `lead-dialog.test.tsx`.
A date input is filled with the same native-setter `typeInto`.

### `contact-lead.test.ts` (pure)

- `validateContactLeadDraft` returns `nameRequired` for `'   '`, `null` for a name-only draft, `birthDateInvalid` for `'2026-02-30'`, `birthDateFuture` for `'2026-10-06'` with today `'2026-10-05'`, `null` for `'2026-10-05'` (today itself is allowed), `emailInvalid` for `'ana@'`, `null` for `'ana@construbom.com.br'`.
- `buildContactLeadPayload` trims every field, turns blanks into `null`, includes `id` only when given, and `Object.keys` equals exactly `['contactName','contactPhone','contactEmail','contactBirthDate','description','sellerPersonId']` without id.
- `leadToContactSeed` then `contactDraftFromSeed` then `buildContactLeadPayload(draft, id)` round-trips a lead's contact fields.
- `leadContactLine`: phone and email gives `'(11) 98888-7777 · ana@x.com'`; phone only; email only; neither gives `'Sem contato'`; whitespace-only counts as blank.
- `leadBirthdayLabel`: `'1990-02-28'` gives `'28/02/1990'`; `'1990-03-01T00:00:00.000Z'` gives `'01/03/1990'` (proves no timezone shift); `null` gives `null`.
- `contactLeadSaveErrorCopy({ status: 400, error: 'validation_error', reason: 'no_open_stage' })` is `noStageError`; `{ status: 400, error: 'validation_error' }` (no reason), `{ status: 400, reason: 'seller_scope' }`, `{ status: 409, reason: 'no_open_stage' }`, `{ status: 500 }`, `new Error('x')` and `undefined` all give `saveFailed`.

### `contact-lead-dialog.test.tsx` (real `Dialog`, real `Combobox`)

Render `ContactLeadDialog` with `today="2026-10-05"`, `initial={null}`, three sellers.
- Renders exactly the six labels in order (`label, [id="lead-seller-label"]` text list equals `['Nome *', 'Data de aniversário', 'Número (telefone/WhatsApp)', 'Email', 'Descrição', 'Vendedor responsável']`).
- Renders no `Empresa`, `Produtos`, `Valor estimado`, `R$` text anywhere in the dialog, and no `input[type="number"]`.
- `#lead-birth-date` has `type="date"` and `max="2026-10-05"`.
- Salvar is disabled and `[data-lead-blocked]` reads `Informe o nome.` with a blank Nome; typing a name enables it.
- A birthday of `2026-10-06` disables Salvar with `A data de aniversário não pode ser no futuro.`; `2026-10-05` enables it.
- An email `ana@` disables Salvar with `Informe um email válido.`.
- Filling every field and picking `Rafael Lima` then Salvar calls `onSubmit` once with `toEqual({ contactName: 'Ana Construbom', contactPhone: '(11) 98888-7777', contactEmail: 'ana@construbom.com.br', contactBirthDate: '1990-02-28', description: 'Indicação da feira', sellerPersonId: SELLER_TWO })` and calls `onOpenChange(false)`.
- Clearing the phone on an edit seed sends `contactPhone: null` and carries `id`.
- Title is `Novo lead` with `initial={null}` and `Editar lead` with a seed carrying `id`.
- Escape while the seller Combobox is open does not call `onOpenChange` (inline-layer rule, inside the real `Dialog`).
- No raw seller uuid appears in `dialogNode().textContent`.

### `leads-contact-board.test.tsx` (real `LeadsBoard`, `fieldSet="contact"`)

Fixtures: two `normal` stages `Primeiro contato`, `Retorno`; leads with `contactPhone`, `contactEmail`, `contactBirthDate`, `estimatedValueBrl: 0`, `clientNameSnapshot: ''`; one lead with no contact data.
- Quadro card shows `data-lead-contact` with `phone · email` and `data-lead-birthday` reading `Aniversário 28/02/1990`; the no-contact lead shows `Sem contato` and no `data-lead-birthday`.
- Board `textContent` contains no `R$`, no `% do total`, no `Sem empresa`; there is no `[data-stage-total]` and no `[data-stage-bar]`; `[data-stage-count]` still shows each column count.
- Lista: header texts equal `['Lead','Fase','Aniversário','Vendedor','Na fase','Ações']`; no `Valor estimado`, no `Produtos`; each phase chip has a `[data-phase-count]` and no `R$`; footer has the `scopeLeadsCount` text and no `TOTAL` and no `[data-list-total]`; `[data-row-birthday]` shows `28/02/1990` or `-`.
- No lead id, stage id or seller id appears in the board `textContent`.
- Zero stages, `canManageStages` true: `[data-no-stages="admin"]` shows `Nenhuma etapa configurada. Crie as etapas do funil em Cadastros.`; clicking `Ir para Etapas do funil` calls `onOpenStagesCadastro` once; `Novo lead` is `disabled`.
- Zero stages, `canManageStages` false: `[data-no-stages="seller"]` shows `Nenhuma etapa configurada. Fale com o gestor.`, no `[data-open-stages-cadastro]`, `Novo lead` is `disabled`.
- Stages present but all `archived`: the empty-state renders too.
- Stages present: `Novo lead` is enabled and no `[data-no-stages]`.
- Standalone `LeadCard` with `fieldSet="contact"`: pointerdown at (0,0) then click at (20,20) does NOT call `onEdit`; pointerdown and click at the same point calls it once (the 6px guard survives the branch).

### `leads-contact-container.test.tsx` (container wiring)

Mocks:
- `@/auth/react`: `useSalesEdition: () => mocks.edition`, `useAuthProfile: () => ({ isLoaded: true, isSignedIn: true, roles: mocks.roles, name: 'Gestor', email: 'gestor@example.com' })`, `useAccessToken: () => ({ getToken: async () => 'token' })`.
- `../hooks`: `useLeadStages` returns `{ isPending: false, isError: false, data: mocks.stages }`; `useLeadsBoard` returns `{ isPending: mocks.stages.length === 0, isError: false, data: mocks.stages.length ? { leads: mocks.leads, hasMore: false } : undefined, isFetchingNextPage: false, fetchNextPage: vi.fn() }` (pending with zero stages reproduces the real disabled query); `useMoveLead` returns `{ mutate: vi.fn(), isPending: false }`; `useSaveLead` returns `{ mutate: mocks.mutate, mutateAsync: mocks.mutateAsync, isPending: false }`.
- `../LeadsBoard`: a stub built with `React.createElement` that pushes its props into `mocks.boardProps` and renders three buttons (`stub-create` calling `onCreateLead`, `stub-edit` calling `onEditLead(mocks.leads[0])`, `stub-stages` calling `onOpenStagesCadastro`).
Render inside `MemoryRouter initialEntries={['/operacional/leads']}` with a `Routes` that echoes `useLocation().pathname` into `[data-path]`.

Cases:
- Leads edition: last board props have `fieldSet: 'contact'`, `onRequestConversion: undefined`, `onOpenSale: undefined` although the container was given both spies.
- Full edition: `fieldSet: 'full'`, `onRequestConversion` is the given spy, `onOpenSale` is the given spy.
- Zero stages in the leads edition renders the board stub (not the Skeleton) with `stages: []`.
- `stub-stages` navigates to `/cadastros/etapas`.
- `canManageStages` is `true` for roles `['admin','seller']` and `false` for `['seller']`.
- Leads edition `stub-create` mounts the contact dialog (`#lead-birth-date` present, `#lead-company-text` absent); full edition mounts `LeadDialog` (`#lead-company-text` present, `#lead-birth-date` absent).
- Leads edition `stub-edit` seeds the contact dialog with the lead's phone and saving calls `mutateAsync` with a payload carrying the lead `id`.
- `mutateAsync` rejecting with `{ status: 400, error: 'validation_error', reason: 'no_open_stage' }`: after Salvar, `[data-lead-save-error]` reads `Nenhuma etapa ativa no funil. O lead não foi salvo.` and no dialog is open.
- Rejecting with `{ status: 500 }`: reads `Não foi possível salvar o lead. Tente novamente.`.
- Opening the dialog again clears the notice.
- Full edition Salvar calls `mutate` (not `mutateAsync`) and never renders `[data-lead-save-error]`.

### `leads-full-edition.test.tsx` (FXL oracles)

- `LeadsBoard` rendered with `fieldSet` omitted and with `fieldSet="full"` (same fixtures as `leads-list-view.test.tsx`, including a conversion stage and a converted lead) produces identical `container.innerHTML`, in the Quadro and after switching to the Lista.
- `LeadCard` innerHTML is identical with `fieldSet` omitted and `"full"`.
- Full board shows `[data-stage-total]` with `R$`, `% do total` and `[data-stage-bar]`; Lista headers include `Produtos` and `Valor estimado`; phase chips show `R$`; footer shows `TOTAL` and `[data-list-total]`; cards show the empresa label and product chips.
- Full board with zero stages renders no `[data-no-stages]` and `Novo lead` is enabled (FXL behaviour unchanged).
- `LeadDialog` still renders `Empresa (texto livre)`, `Produtos em negociação` and `Valor estimado (R$)`.

### `leads-api-contract.test.ts` (append one case)

- `leadsApi.saveLead(buildContactLeadPayload(draft), 't')` calls `apiFetch` with `/api/v1/sales-ops/leads`, `POST`, and a body whose keys are exactly the six contact keys; with an `id` it is `PATCH /api/v1/sales-ops/leads/<id>` and the body has no `id`.

## Run-once commands

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/web exec vitest run src/lib/__tests__/api-client-reason.test.ts src/auth/__tests__/auth-mock-edition-export.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/leads-routing.test.tsx src/sales-ops/__tests__/sale-deep-link.test.tsx src/sales-ops/import/__tests__/import-routing.test.tsx
pnpm --filter @fxl-sales/web test
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web build
git diff --stat master -- apps/web/src/sales-ops/SalesOpsApp.tsx apps/web/src/sales-ops/leads/LeadDialog.tsx
```

The last command must print nothing.

## Browser check (after slice 08 lands, recorded in Verify)

With `make dev-fake`, sign in as `leads-owner`: `/operacional/leads` shows the admin empty-state, its button lands on `/cadastros/etapas`, and after creating one etapa the contact dialog creates a lead whose card shows phone, email and birthday with no R$ anywhere.
Sign in as `leads-seller`: `/meus-dados/leads` shows the seller copy until an etapa exists.
Sign in as `team-owner`: `/operacional/leads` is pixel-identical to today.
Stop the dev servers by their process-group id afterwards.
