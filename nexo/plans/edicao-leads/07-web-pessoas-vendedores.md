---
id: 07-web-pessoas-vendedores
milestone: v4.3.0
status: todo
depends_on: [04-api-leads-edition, 05-web-edition-navigation]
files_modified:
  - apps/web/src/sales-ops/people/vendedores.ts
  - apps/web/src/sales-ops/people/VendedoresView.tsx
  - apps/web/src/sales-ops/people/__tests__/vendedores.test.ts
  - apps/web/src/sales-ops/people/__tests__/vendedores-view.test.tsx
  - apps/web/src/sales-ops/__tests__/vendedores-routing.test.tsx
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - nexo/knowledge/reference/pessoas-e-funcoes.md
  - CLAUDE.md
acceptance: "In the leads edition an admin at /cadastros/pessoas sees the page title 'Vendedores', a header button 'Novo vendedor', a table whose only headers are Nome, E-mail, Ações (no Funções column, no função badge) listing active vendedores and, after them, inactive ones muted with an 'Inativo' badge and a 'Reativar' action that PATCHes status 'active' (SEAM A4), the existing Inativar action behind a confirmation whose copy never mentions Cadastros > Geral or the histórico, and a 'Vendedor' dialog with only Nome* and E-mail plus the helper 'Use o mesmo e-mail com que o vendedor entra no sistema.'; Salvar is enabled with a name alone and the payload carries funcaoIds = [the catalog's system vendedor id] or [] when the catalog has none. In the full edition the same URL renders exactly today's 'Pessoas' screen, 'Nova pessoa' button, Funções column and PersonDialog that still refuses to save without a função."
goal: "Present the people cadastro as a plain Vendedores screen in the leads edition (name, e-mail, inactivate) through a new self-contained component file, with SalesOpsApp only choosing which view, dialog, title and header label to mount."
must_not_break:
  - apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastro-archive.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastro-history.test.tsx
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
  - apps/web/src/sales-ops/__tests__/navigation.test.ts
  - apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - "pnpm --filter @fxl-sales/web lint / type-check / test / build"
oracle: apps/web/src/sales-ops/__tests__/vendedores-routing.test.tsx
rules:
  - "Never import anything (value or type) from '../SalesOpsApp' inside people/**. SalesOpsApp imports people/**, so any import back is a cycle. Style constants are local copies, exactly like CadastroHistoryPanel.tsx."
  - "SalesOpsApp.tsx changes are exactly the edits in Step 4. Nothing else in that file moves, and the full-edition expressions evaluate to today's values."
  - "No native <select>/<option>/<datalist>, no raw <input type=\"number\">. The dialog has no Combobox and no InfoHint, so no useInlineLayer is needed; do not add any inline layer."
  - "Never render a raw person, org or função id. pt-BR copy, no em dash anywhere (code comments included)."
  - "Inside SalesOpsApp read the edition ONLY through slice 05's existing `const edition = profile.edition;` (the shell's one read site; never add a useSalesEdition() call there). Never read entitlements or modules in this slice."
  - "Do not touch apps/web/src/sales-ops/leads/**, navigation.ts, api.ts, hooks.ts, optimistic.ts or types.ts."
verifier_focus: "That the full-edition oracle renders the real PersonDialog (função Combobox present, Salvar disabled with a name but no função) through the shell with edition 'full'; that the leads payload never carries an id the catalog does not hold; that the leads confirmation copy promises no restore path; that no file under people/ imports SalesOpsApp."
---

# Slice 07 - web Pessoas as Vendedores (leads edition)

## Objective

In the leads edition (`profile.edition === 'leads'`, read in `SalesOpsApp` as slice 05's `edition`) the Cadastros > Pessoas route becomes a plain Vendedores cadastro.
A pessoa there is always a vendedor (overview decision D4): the server assigns the system `vendedor` função itself, so the web shows no função picker and never blocks a save on `funcao_required`.
The full edition keeps today's `PessoasView` and `PersonDialog` untouched, and a shell oracle proves it.

## Code facts (verified while planning, master at 554362b)

- `apps/web/src/sales-ops/SalesOpsApp.tsx` is 9620 lines.
  - `titleForView(view, workspace)` (around line 403) holds `pessoas: { title: 'Pessoas', subtitle: 'Cadastro único de pessoas e das funções atribuídas a cada uma' }` (line 482).
  - `const profile = useAuthProfile();` is at line 1282.
  - `const title = titleForView(view, workspace);` is at line 1425.
  - `canManagePeople = canManageCadastros && view === 'pessoas'` (line 1432) and `personModalMatchesRoute = canManagePeople && modal?.kind === 'person'` (line 1434).
  - `changeCadastroStatus(target: CadastroArchiveTarget)` (around line 1460) PATCHes `cadastroArchive[target.cadastro].resource` with `{ status }` only; for `cadastro: 'pessoa'` the resource is `people` and the archived literal is `inactive`.
  - `runHeaderAction` (line 1657) opens `setModal({ kind: 'person' })` when `canManagePeople`; this slice does not touch it.
  - `headerAction` (line 1690) yields `'Nova pessoa'` for `view === 'pessoas'` when `canManagePeople`.
  - The pessoas mount is `{view === 'pessoas' ? (<PessoasView bootstrap={bootstrap} onArchive={changeCadastroStatus} onEdit={(person) => setModal({ kind: 'person', person })} />) : null}` (line 2253).
  - The dialog mount is `<PersonDialog funcoes={persistedBootstrap.funcoes} modal={personModalMatchesRoute && modal?.kind === 'person' ? modal : null} onClose=... onCreateFuncao={createFuncaoByName} onSave={(payload) => { savePerson.mutate(payload, { onSuccess: () => setModal(null) }); }} saving={savePerson.isPending} />` (line 2373).
  - `useCadastroArchive`, `CadastroArchiveButton`, `CadastroArchiveConfirm`, `EmptyPanel`, `Field`, `PrimaryButton`, `SecondaryButton`, `panelClass`, `mutedPanelClass`, `tableHeadClass`, `tableCellClass`, `iconButtonClass`, `iconButtonPendingClass` and `type ModalState` are all module-private.
  - The full pessoa archive copy (`cadastroArchive.pessoa.confirmBody`) says "você pode reativá-la no histórico de arquivamentos, em Cadastros > Geral". In the leads edition `geral` is not visible and `GET /history` answers `403 edition_capability`, so that sentence would be false there; the leads confirmation needs its own copy.
- `PersonDialogBody` (line 6048) has exactly three inputs: Nome (required), E-mail (`contactEmail`, `type="email"`), and the Funções `FieldBlock` (assigned list, `Atribua ao menos uma função.`, Combobox `aria-label="Função da pessoa"` with an inline create row).
  It has NO document, commission, finder, status or role field.
  `submit` returns early when `assignedIds.length === 0`, and Salvar is `disabled={saving || !displayName.trim() || assignedIds.length === 0}`: that is the client-side `funcao_required` gate.
  The payload is `{ id: person?.id, displayName: trimmed, contactEmail: trimmed || undefined, status: person?.status ?? 'active', funcaoIds }`.
- `PessoasView` (line 3872) lists `bootstrap.people` with `status === 'active'`, columns Nome, E-mail, Funções (badges), Ações (Editar `Edit3` button with `aria-label` `Editar <nome>` or `Salvando <nome>` while optimistic, plus `CadastroArchiveButton` labelled `Inativar pessoa <nome>`).
  The empty state is `Nenhuma pessoa cadastrada`.
- `apps/web/src/sales-ops/api.ts`: `SavePersonPayload = { id?: string; displayName: string; contactEmail?: string; status?: 'active' | 'inactive'; funcaoIds: string[] }` (`funcaoIds` is required by the type).
- `apps/web/src/sales-ops/hooks.ts` `useSaveSalesOpsPerson` applies `optimisticPerson`, which resolves `funcoes` from `payload.funcaoIds` against the cached catalogue, and invalidates `['sales-ops']`.
- `apps/web/src/sales-ops/calculations.ts` exports `FUNCAO_SLUG_VENDEDOR = 'vendedor'` and `hasFuncao`; it is pure.
- `apps/web/src/sales-ops/optimistic.ts` exports `isOptimisticId(id)` and `optimisticId(collection, seed)`.
- API today: `planPersonFuncoes` in `apps/api/src/domains/sales-ops/service.ts` returns `funcao_required` for an explicit empty `funcaoIds`; slice 04 must apply the leads-edition override (exactly `[vendedor]`) BEFORE that plan, per SEAM-CONTRACT section 2.
- Lead rows carry `sellerNameSnapshot`, so an inactivated vendedor keeps showing on the leads that already reference him.
- Tests use `createRoot` + `React.act` + happy-dom, no Testing Library; `pessoas-funcoes-view.test.tsx` holds the `change`, `click`, `submit` helpers and `leads-routing.test.tsx` holds the shell mount pattern (mocks `@/auth/react`, `../hooks`, both lead containers and `@/components/ui/dialog`).
- `cadastro-history.test.tsx` lines 39-77 hold the `CloseCtx` mock of `@/components/ui/alert-dialog`.

## Per-field decision (leads-edition dialog)

| Field in today's PersonDialog | Leads edition | Why |
| --- | --- | --- |
| Nome (required) | SHOWN, required | The only thing the gestor must type. |
| E-mail (`contactEmail`) | SHOWN, optional, with helper copy | The existing email self-claim binds the pessoa to the Hub account on first access; a different e-mail means the vendedor never sees his leads. |
| Funções (list, picker, inline create, `Atribua ao menos uma função.`) | HIDDEN | The server forces `[vendedor]`; the `catalog` capability is off, so `/funcoes` writes would 403 anyway. |
| Status | Not a field in either edition | The stored status is carried, exactly like today. |
| Document, commission, finder, role | Do not exist in PersonDialog | Nothing to hide. |

Table columns: Nome SHOWN, E-mail SHOWN, Funções HIDDEN, Ações SHOWN (Editar + Inativar).
There is no filter on the Pessoas screen today, so there is no filter to hide.

## Step 1 - `apps/web/src/sales-ops/people/vendedores.ts` (new, pure, no React)

```ts
import type { SavePersonPayload } from '../api';
import { FUNCAO_SLUG_VENDEDOR } from '../calculations';
import type { SalesOpsFuncao, SalesOpsPerson } from '../types';

/**
 * Every user-facing string of the leads-edition Vendedores screen, in one place so
 * the tests can pin them and scan them. pt-BR, no em dash, and no word that belongs
 * to the full product (função, finder, comissão, proposta).
 */
export const VENDEDORES_COPY = {
  pageTitle: {
    title: 'Vendedores',
    subtitle: 'Vendedores da equipe que podem receber leads na prospecção',
  },
  newAction: 'Novo vendedor',
  emptyTitle: 'Nenhum vendedor cadastrado',
  emptyText:
    'Cadastre os vendedores da equipe para atribuir leads a eles. Use o mesmo e-mail com que cada vendedor entra no sistema.',
  dialogTitle: 'Vendedor',
  dialogDescription: 'Cadastre o vendedor para atribuir leads a ele.',
  nameLabel: 'Nome',
  emailLabel: 'E-mail',
  emailHelper: 'Use o mesmo e-mail com que o vendedor entra no sistema.',
  cancel: 'Cancelar',
  save: 'Salvar',
  editLabel: (name: string) => `Editar ${name}`,
  savingLabel: (name: string) => `Salvando ${name}`,
  inactivateLabel: (name: string) => `Inativar vendedor ${name}`,
  inactivateTitle: (name: string) => `Inativar o vendedor "${name}"?`,
  inactivateBody:
    'Ele sai da lista de vendedores dos leads, mas continua nos leads que já o utilizam e pode ser reativado nesta tela. Nada é apagado.',
  inactivateAction: 'Inativar vendedor',
  inactivateBack: 'Voltar',
  inactiveBadge: 'Inativo',
  reactivateLabel: (name: string) => `Reativar vendedor ${name}`,
} as const;

/** The org's system `vendedor` função id, or null when the catalogue has none yet. */
export function vendedorFuncaoId(funcoes: readonly SalesOpsFuncao[]): string | null {
  return funcoes.find((funcao) => funcao.isSystem && funcao.slug === FUNCAO_SLUG_VENDEDOR)?.id ?? null;
}

/**
 * The leads-edition person write. The server ignores `funcaoIds` in this edition and
 * assigns exactly [vendedor] itself (seeding the system funções when the org has
 * none). The id is still sent when the catalogue knows it, so the optimistic row
 * already carries the vendedor badge data the lead board's seller picker filters on;
 * with an empty catalogue it is [] and the server alone decides.
 * Never an id the catalogue does not hold.
 */
export function buildVendedorPayload(input: {
  person: SalesOpsPerson | null;
  displayName: string;
  contactEmail: string;
  funcoes: readonly SalesOpsFuncao[];
}): SavePersonPayload {
  const vendedorId = vendedorFuncaoId(input.funcoes);
  return {
    id: input.person?.id,
    displayName: input.displayName.trim(),
    contactEmail: input.contactEmail.trim() || undefined,
    // The stored status, never a value this dialog owns, exactly like PersonDialog.
    status: input.person?.status ?? 'active',
    funcaoIds: vendedorId ? [vendedorId] : [],
  };
}
```

## Step 2 - `apps/web/src/sales-ops/people/VendedoresView.tsx` (new)

Imports: `Archive`, `Edit3`, `Loader2`, `RotateCcw`, `Save` from `lucide-react`; `useState`, `type FormEvent`, `type ReactNode` from `react`; the `AlertDialog*` family from `@/components/ui/alert-dialog`; `Dialog`, `DialogContent`, `DialogDescription`, `DialogHeader`, `DialogTitle` from `@/components/ui/dialog`; `Input` from `@/components/ui/input`; `Table*` from `@/components/ui/table`; `isOptimisticId` from `../optimistic`; `type SavePersonPayload` from `../api`; `type SalesOpsFuncao, type SalesOpsPerson` from `../types`; `VENDEDORES_COPY, buildVendedorPayload` from `./vendedores`.
Never import from `../SalesOpsApp`.

Local style copies, with this exact comment above them: `Intentional local copies of the SalesOpsApp.tsx style constants, as in CadastroHistoryPanel.tsx: SalesOpsApp imports this module, so importing them back would be a cycle.`

```ts
const panelClass = 'rounded-[18px] border border-[#e8e8ec] bg-white';
const mutedPanelClass = 'rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc]';
const tableHeadClass = 'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';
const tableCellClass = 'px-4 py-3 text-[13.5px] text-[#57575f]';
const iconButtonBaseClass = 'inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition';
const iconButtonClass = `${iconButtonBaseClass} border-[#dcdce2] bg-white text-[#57575f] hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210]`;
const iconButtonPendingClass = `${iconButtonBaseClass} cursor-not-allowed border-[#ececf1] bg-[#f6f6f8] text-[#b6b6bd]`;
const primaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-[#201f24] px-4 py-2 text-[13.5px] font-bold text-white transition hover:bg-[#33333a] disabled:cursor-not-allowed disabled:opacity-60';
const secondaryButtonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-[11px] border border-[#dcdce2] bg-white px-4 py-2 text-[13.5px] font-semibold text-[#57575f] transition hover:bg-[#f2f2f4] disabled:cursor-not-allowed disabled:opacity-60';
```

(Copy each string byte for byte from `SalesOpsApp.tsx` lines 221-235 and the `PrimaryButton` / `SecondaryButton` bodies; if any differs at execution time, copy the current value.)

### 2a. `VendedoresView`

```ts
export function VendedoresView(props: {
  people: readonly SalesOpsPerson[];
  onEdit: (person: SalesOpsPerson) => void;
  onInactivate: (person: SalesOpsPerson) => void;
  /** SEAM A4: a status-only PATCH back to 'active'. Geral and GET /history are gated off in this edition. */
  onReactivate: (person: SalesOpsPerson) => void;
}): JSX.Element
```

Behaviour, in order:

1. `const [pending, setPending] = useState<SalesOpsPerson | null>(null);` above any early return.
2. `const active = props.people.filter((person) => person.status === 'active');` and `const inactive = props.people.filter((person) => person.status !== 'active');`; `const listed = [...active, ...inactive];` (active first, each group in bootstrap order).
   Every pessoa is listed, without a `hasFuncao` filter: in this edition the server makes every pessoa a vendedor, and a filter would hide a just-created optimistic row whenever the catalogue had no vendedor yet.
   Inactive vendedores are listed too (SEAM A4), because Geral and `GET /history` are gated off in this edition and this screen is the only place to reactivate one.
3. Empty (only when `listed.length === 0`): render `<div className={`${mutedPanelClass} flex min-h-[154px] flex-col items-center justify-center gap-2 p-6 text-center`} data-vendedores-empty>` with a `text-sm font-bold text-[#201f24]` div holding `VENDEDORES_COPY.emptyTitle` and a `max-w-[420px] text-[13px] leading-5 text-[#8b8b92]` div holding `VENDEDORES_COPY.emptyText`.
   The confirmation below is not rendered in this branch (nothing can be pending).
4. Otherwise `<div className={`${panelClass} overflow-hidden`} data-vendedores-view>` holding a `Table`:
   - Header row `className="bg-[#fafafb] hover:bg-[#fafafb]"` with exactly three `TableHead`s: `Nome` (`tableHeadClass`), `E-mail` (`tableHeadClass`), `Ações` (`${tableHeadClass} text-center`).
   - One `TableRow key={person.id}` per listed pessoa, with `const optimistic = isOptimisticId(person.id);`:
     - Nome cell `className="px-4 py-3 text-sm font-semibold"` with `person.displayName`.
     - E-mail cell `className={tableCellClass}` with `person.contactEmail ?? <span className="text-[#b6b6bd]">-</span>`.
     - Ações cell `className="px-4 py-3 text-center"` with `<div className="flex items-center justify-center gap-1.5">` holding:
       - Editar: `<button type="button" aria-label={optimistic ? VENDEDORES_COPY.savingLabel(name) : VENDEDORES_COPY.editLabel(name)} title={optimistic ? 'Salvando...' : 'Editar'} className={optimistic ? iconButtonPendingClass : iconButtonClass} disabled={optimistic} onClick={() => props.onEdit(person)}>` with `<Edit3 className="h-[15px] w-[15px]" />`.
       - Inativar: `<button type="button" aria-label={VENDEDORES_COPY.inactivateLabel(name)} title="Inativar" className={optimistic ? iconButtonPendingClass : iconButtonClass} disabled={optimistic} onClick={() => setPending(person)}>` with `<Archive className="h-[15px] w-[15px]" />`.
   - An INACTIVE row (`person.status !== 'active'`, SEAM A4) is muted: `TableRow` gets `data-vendedor-inactive` and `className="opacity-60"`; the Nome cell renders `person.displayName` followed by `<span className="ml-2 rounded-full bg-[#f2f2f4] px-2 py-0.5 text-[11px] font-semibold text-[#8b8b92]" data-vendedor-status-badge>{VENDEDORES_COPY.inactiveBadge}</span>`; the E-mail cell is unchanged; the Ações cell holds ONLY `<button type="button" aria-label={VENDEDORES_COPY.reactivateLabel(name)} title="Reativar" className={iconButtonClass} onClick={() => props.onReactivate(person)}>` with `<RotateCcw className="h-[15px] w-[15px]" />` (no confirmation: a restore loses nothing; no Editar on an inactive row).
5. After the table, the confirmation:

```tsx
<AlertDialog onOpenChange={(open) => (!open ? setPending(null) : undefined)} open={pending !== null}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{pending ? VENDEDORES_COPY.inactivateTitle(pending.displayName) : ''}</AlertDialogTitle>
      <AlertDialogDescription>{VENDEDORES_COPY.inactivateBody}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>{VENDEDORES_COPY.inactivateBack}</AlertDialogCancel>
      <AlertDialogAction onClick={() => { if (pending) props.onInactivate(pending); setPending(null); }}>
        {VENDEDORES_COPY.inactivateAction}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

The body points to this same screen for a restore, never to Geral or the histórico: the leads edition has no Geral screen and `GET /history` is gated.

### 2b. `VendedorDialog`

```ts
export function VendedorDialog(props: {
  open: boolean;
  person: SalesOpsPerson | null;
  funcoes: readonly SalesOpsFuncao[];
  onClose: () => void;
  onSave: (payload: SavePersonPayload) => void;
  saving: boolean;
}): JSX.Element | null
```

- `if (!props.open) return null;` then render `<VendedorDialogBody key={props.person?.id ?? 'new-vendedor'} ...all props except open />`, the same remount-per-record pattern as `PersonDialog`.
- `VendedorDialogBody` (module-private):
  - `const [displayName, setDisplayName] = useState(person?.displayName ?? '');`
  - `const [contactEmail, setContactEmail] = useState(person?.contactEmail ?? '');`
  - `const canSave = !saving && displayName.trim().length > 0;` This is the whole gate: no função check, which is the client-side `funcao_required` bypass for this edition.
  - `submit(event: FormEvent)`: `event.preventDefault(); if (!displayName.trim()) return; onSave(buildVendedorPayload({ person, displayName, contactEmail, funcoes }));`
  - Markup:

```tsx
<Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
  <DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">
    <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
      <DialogTitle className="sales-ops-num text-[19px]">{VENDEDORES_COPY.dialogTitle}</DialogTitle>
      <DialogDescription>{VENDEDORES_COPY.dialogDescription}</DialogDescription>
    </DialogHeader>
    <form className="flex flex-col gap-4 px-6 py-5" data-vendedor-form onSubmit={submit}>
      <label className="flex flex-col gap-[6px]">
        <span className="text-xs font-semibold text-[#8b8b92]">
          {VENDEDORES_COPY.nameLabel}<span className="text-[#b23a22]"> *</span>
        </span>
        <Input className="bg-[#fafafb]" name="displayName" onChange={(e) => setDisplayName(e.target.value)} value={displayName} />
      </label>
      <label className="flex flex-col gap-[6px]">
        <span className="text-xs font-semibold text-[#8b8b92]">{VENDEDORES_COPY.emailLabel}</span>
        <Input aria-describedby="vendedor-email-helper" className="bg-[#fafafb]" name="contactEmail" onChange={(e) => setContactEmail(e.target.value)} type="email" value={contactEmail} />
        <span className="text-[12.5px] text-[#8b8b92]" id="vendedor-email-helper">{VENDEDORES_COPY.emailHelper}</span>
      </label>
      <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
        <button className={secondaryButtonClass} onClick={onClose} type="button">{VENDEDORES_COPY.cancel}</button>
        <button className={primaryButtonClass} disabled={!canSave} type="submit">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {VENDEDORES_COPY.save}
        </button>
      </div>
    </form>
  </DialogContent>
</Dialog>
```

The fixed `id="vendedor-email-helper"` is safe because at most one `VendedorDialog` is ever mounted.
`type="submit"` is correct here: this is a one-step form, not a wizard, and it mirrors `PersonDialog`.

## Step 3 - edition value in `SalesOpsApp.tsx`

Slice 05 is merged before this slice and declared `const edition = profile.edition;` right after `const profile = useAuthProfile();`.
Every edit of Step 4 uses that `edition` variable; this slice adds no edition read and no `useSalesEdition` import to `SalesOpsApp.tsx` (the shell harnesses mock `@/auth/react` with a hand-written profile, and an absent `edition` there must read as the full edition).
If `grep -n "const edition = profile.edition" apps/web/src/sales-ops/SalesOpsApp.tsx` finds nothing, STOP and record a blocker naming slice 05.

## Step 4 - the `SalesOpsApp.tsx` edits (nothing else)

1. Imports, directly after `import { ImportContainer } from './import/ImportContainer';`:

```ts
import { VendedorDialog, VendedoresView } from './people/VendedoresView';
import { VENDEDORES_COPY } from './people/vendedores';
```

2. (No edit: Step 3's `edition` already exists from slice 05.)

3. Title. Replace `const title = titleForView(view, workspace);` with:

```ts
  /*
    The leads edition renames the people cadastro to Vendedores. Overridden here
    rather than inside `titleForView` so the full-edition map stays byte-identical.
  */
  const title =
    edition === 'leads' && view === 'pessoas'
      ? VENDEDORES_COPY.pageTitle
      : titleForView(view, workspace);
```


4. Header action. In the `headerAction` chain replace

```ts
            : view === 'pessoas'
              ? canManagePeople
                ? 'Nova pessoa'
                : null
```

with

```ts
            : view === 'pessoas'
              ? canManagePeople
                ? edition === 'leads'
                  ? VENDEDORES_COPY.newAction
                  : 'Nova pessoa'
                : null
```

`runHeaderAction` is unchanged: it already opens `{ kind: 'person' }`, and Step 4.6 decides which dialog renders it.

5. Mount. Replace the `{view === 'pessoas' ? (<PessoasView ... />) : null}` block with:

```tsx
                {view === 'pessoas' ? (
                  edition === 'leads' ? (
                    <VendedoresView
                      onEdit={(person) => setModal({ kind: 'person', person })}
                      onInactivate={(person) =>
                        changeCadastroStatus({
                          cadastro: 'pessoa',
                          id: person.id,
                          name: person.displayName,
                          status: 'inactive',
                        })
                      }
                      onReactivate={(person) =>
                        changeCadastroStatus({
                          cadastro: 'pessoa',
                          id: person.id,
                          name: person.displayName,
                          status: 'active',
                        })
                      }
                      people={bootstrap.people}
                    />
                  ) : (
                    <PessoasView
                      bootstrap={bootstrap}
                      onArchive={changeCadastroStatus}
                      onEdit={(person) => setModal({ kind: 'person', person })}
                    />
                  )
                ) : null}
```

The `PessoasView` element keeps its three props exactly as today.

6. Dialog. Replace the `<PersonDialog ... />` element with:

```tsx
      {edition === 'leads' ? (
        <VendedorDialog
          funcoes={persistedBootstrap.funcoes}
          onClose={() => setModal(null)}
          onSave={(payload) => {
            savePerson.mutate(payload, { onSuccess: () => setModal(null) });
          }}
          open={personModalMatchesRoute && modal?.kind === 'person'}
          person={modal?.kind === 'person' ? (modal.person ?? null) : null}
          saving={savePerson.isPending}
        />
      ) : (
        <PersonDialog
          funcoes={persistedBootstrap.funcoes}
          modal={personModalMatchesRoute && modal?.kind === 'person' ? modal : null}
          onClose={() => setModal(null)}
          onCreateFuncao={createFuncaoByName}
          onSave={(payload) => {
            savePerson.mutate(payload, { onSuccess: () => setModal(null) });
          }}
          saving={savePerson.isPending}
        />
      )}
```

The `PersonDialog` element's props are byte-identical to today.
`PessoasView`, `PersonDialog`, `PersonDialogBody`, `cadastroArchive` and `titleForView` are not edited.

## Step 5 - tests

All component tests start with `// @vitest-environment happy-dom`, use `createRoot` + `(React as ...).act`, and copy the `change`, `click`, `submit`, `buttonByText` helpers from `pessoas-funcoes-view.test.tsx`.
Fixture ids are uuids of the existing `11111111-1111-4111-8111-111111111111` shape; the vendedor função fixture is `fc000001-0000-4000-8000-000000000001`, slug `vendedor`, `isSystem: true`.

### 5a. `apps/web/src/sales-ops/people/__tests__/vendedores.test.ts` (node environment)

1. `builds a new vendedor with the catalogue's vendedor id`: catalogue `[vendedor, finder, designer]`, `person: null`, name `'  Ana Lima  '`, email `' ana@construbom.example '` gives exactly `{ id: undefined, displayName: 'Ana Lima', contactEmail: 'ana@construbom.example', status: 'active', funcaoIds: [vendedor.id] }` (`toEqual`).
2. `sends no função id when the catalogue has no vendedor yet`: catalogue `[]` gives `funcaoIds: []`; catalogue `[finder, designer]` gives `funcaoIds: []`.
3. `never picks a non-system função slugged vendedor`: catalogue `[{ ...designer, slug: 'vendedor', isSystem: false }]` gives `funcaoIds: []`.
4. `keeps the edited pessoa's id and stored status`: `person` with `status: 'inactive'` gives `id: person.id`, `status: 'inactive'`.
5. `drops a blank e-mail`: email `'   '` gives `contactEmail: undefined`.
6. `copy is pt-BR leads vocabulary only`: every string value of `VENDEDORES_COPY` (functions called with `'X'`, nested `pageTitle` included) contains no U+2014 character (test it with `/\u2014/`), and none matches `/fun[cç][aã]o|finder|comiss|proposta|Cadastros > Geral|hist[oó]rico/i`.
7. `vendedorFuncaoId returns null for an empty catalogue and the id otherwise`.

### 5b. `apps/web/src/sales-ops/people/__tests__/vendedores-view.test.tsx`

Mock `@/components/ui/dialog` exactly as `pessoas-funcoes-view.test.tsx` does and `@/components/ui/alert-dialog` with the `CloseCtx` version from `cadastro-history.test.tsx` lines 39-77.

View cases:
1. `lists vendedores with only Nome, E-mail and Ações, inactive ones last and muted`: two active (`Ana Lima` with e-mail, `Bruno Reis` with `contactEmail: null` and funções `[finder]`) and one `inactive` (`Caio Inativo`), passed in the order Caio, Ana, Bruno.
   Header texts are exactly `['Nome', 'E-mail', 'Ações']`; row order is Ana, Bruno, Caio; Caio's row has `data-vendedor-inactive` and a `[data-vendedor-status-badge]` reading `Inativo`, a `Reativar vendedor Caio Inativo` button, and no `Editar Caio Inativo` nor `Inativar vendedor Caio Inativo`; Ana's and Bruno's rows have no badge; Bruno's e-mail cell text is `-`; the container text contains neither `Funções`, `Finder`, `Vendedor` badge text nor any person id.
2. `shows the empty state only when no pessoa exists`: `[]` renders `Nenhum vendedor cadastrado` and the `emptyText`, and no `table`; `[Caio Inativo]` renders the table with his inactive row (no empty state).
2b. `reactivates an inactive vendedor without a confirmation`: clicking `Reativar vendedor Caio Inativo` calls `onReactivate` once with Caio, `onInactivate` is not called, and no alert dialog opens.
3. `opens edit for the clicked row`: clicking `Editar Ana Lima` calls `onEdit` with Ana.
4. `inactivates only after confirmation`: click `Inativar vendedor Ana Lima`; the title `Inativar o vendedor "Ana Lima"?` and `inactivateBody` render, and the text contains neither `Geral` nor `histórico` and does contain `reativado nesta tela`; clicking `Voltar` closes it with `onInactivate` not called; reopening and clicking `Inativar vendedor` calls `onInactivate` once with Ana and closes it.
5. `locks both actions on an optimistic row`: a pessoa with `id: optimisticId('people', 'Dora')` renders `Salvando Dora` and `Inativar vendedor Dora` both `disabled`.

Dialog cases:
6. `renders only Nome and E-mail with the e-mail helper`: `open`, `person: null`, catalogue `[vendedor]`.
   Title `Vendedor`, description present, exactly two `input` elements in the form (`name="displayName"`, `name="contactEmail"` with `type="email"`), the e-mail input's `aria-describedby` is `vendedor-email-helper` and that element's text is `Use o mesmo e-mail com que o vendedor entra no sistema.`; no `button[role="combobox"]`, and the text contains neither `Funções` nor `Atribua ao menos uma função.`.
7. `saves with a name alone`: Salvar is disabled while the name is blank and a submit calls nothing; after `change(name, 'Ana Lima')` Salvar is enabled and submit calls `onSave` with exactly `{ id: undefined, displayName: 'Ana Lima', contactEmail: undefined, status: 'active', funcaoIds: [vendedor.id] }`.
8. `sends an empty função set when the catalogue has none`: catalogue `[]`, submit with a name gives `funcaoIds: []`.
9. `prefills and keeps the id when editing`: `person` Ana prefills both inputs; submit gives `id: ana.id` and `status: 'active'`.
10. `disables Salvar while saving`: `saving: true` with a prefilled name keeps Salvar disabled.
11. `Cancelar closes`: click calls `onClose`.
12. `renders nothing when closed`: `open: false` leaves the container empty.

### 5c. `apps/web/src/sales-ops/__tests__/vendedores-routing.test.tsx` (THE ORACLE, both editions)

Copy the scaffolding of `leads-routing.test.tsx` (the `../hooks` mock with `funcoes: [funcaoVendedor, funcaoFinder]` and `people: [vendedorFixture, finderOnlyFixture, archivedVendedorFixture]`, both lead container mocks, the dialog mock, `renderRoute`).
The `@/auth/react` mock adds a module-level `let edition: 'full' | 'leads' = 'full';`, returns `edition` from `useSalesEdition: () => edition`, and adds `edition` to the `useAuthProfile()` object; if slice 05 added further exports that `SalesOpsApp` reads from `@/auth/react`, mirror them from slice 05's updated `leads-routing.test.tsx` mock.
`renderRoute(path, roles, nextEdition)` sets `edition` before rendering.
`mutation.mutate` is a `vi.fn()` reset in `afterEach`.

Full edition (`edition = 'full'`, roles `['admin']`, `/cadastros/pessoas`):
1. `full edition keeps the Pessoas screen with funções`: `h1` is `Pessoas`; the header has a button `Nova pessoa` and none `Novo vendedor`; a `th` reads `Funções`; the `Vendedor` and `Finder` badges render.
2. `full edition PersonDialog still requires a função`: click `Nova pessoa`; the dialog title is `Pessoa`; `button[role="combobox"][aria-label="Função da pessoa"]` exists; after typing `Halland` into the first form input, Salvar is disabled, `Atribua ao menos uma função.` renders, and a form submit does not call `mutation.mutate`.

Leads edition (`edition = 'leads'`, roles `['admin']`, `/cadastros/pessoas`):
3. `leads edition mounts Vendedores without funções`: `h1` is `Vendedores` and the subtitle `Vendedores da equipe que podem receber leads na prospecção` renders; the header button is `Novo vendedor` and there is no `Nova pessoa`; no `th` reads `Funções`; `[data-vendedores-view]` exists; `Alex Silva` and `Bia Indicadora` render without a badge, and `Caio Arquivado` renders last with the `Inativo` badge and a `Reativar vendedor Caio Arquivado` button (SEAM A4).
4. `leads edition dialog saves a vendedor by name`: click `Novo vendedor`; the dialog title is `Vendedor`; there is no `Função da pessoa` combobox; the e-mail helper renders; type `Ana Lima` into `input[name="displayName"]` and submit; `mutation.mutate` was called once with first argument `{ id: undefined, displayName: 'Ana Lima', contactEmail: undefined, status: 'active', funcaoIds: [funcaoVendedor.id] }`.
5. `leads edition inactivates through the people resource`: mock `useSetSalesOpsCadastroStatus` with its own `vi.fn()` `mutate` (`statusMutation`); click `Inativar vendedor Alex Silva` then `Inativar vendedor` (the confirmation is the real Radix AlertDialog here unless the file also mocks `@/components/ui/alert-dialog`; mock it with the `CloseCtx` version so the click is deterministic); `statusMutation.mutate` was called with `{ resource: 'people', id: vendedorFixture.id, status: 'inactive' }` as its first argument.
6. `leads edition reactivates through the people resource` (SEAM A4): with the same `statusMutation`, click `Reativar vendedor Caio Arquivado`; `statusMutation.mutate` was called once with `{ resource: 'people', id: archivedVendedorFixture.id, status: 'active' }` as its first argument and no confirmation rendered.
7. `full edition still hides inactive pessoas`: with `edition = 'full'`, `Caio Arquivado` does not render on `/cadastros/pessoas` (today's behaviour).

## Step 6 - reference update

Append to `nexo/knowledge/reference/pessoas-e-funcoes.md`, one sentence per line, under a new heading `## Leads edition (v4.3.0)`:

- In the leads edition the Cadastros > Pessoas route renders `VendedoresView` and `VendedorDialog` from `apps/web/src/sales-ops/people/VendedoresView.tsx`; `SalesOpsApp` only chooses between them and `PessoasView` / `PersonDialog`.
- The leads screen shows Nome, E-mail and Ações only, and the dialog Nome and E-mail with the self-claim helper; no função UI exists there because the server forces exactly `[vendedor]`.
- `buildVendedorPayload` sends the catalogue's system vendedor id when known and `[]` otherwise, never an unknown id, and never blocks a save on funções.
- In the leads edition the Vendedores screen lists inactive vendedores last, muted with an `Inativo` badge, and offers `Reativar` (a status-only `PATCH /people/:id` with `status: 'active'`, which slice 04 accepts without touching funções), because Geral and `GET /history` are gated off in that edition (SEAM A4).
- The leads inactivation copy points to this screen for a restore and never to Geral or the histórico.
- Oracle: `apps/web/src/sales-ops/__tests__/vendedores-routing.test.tsx` pins both editions on the same route.

## Step 6b - `CLAUDE.md`: the ONE consolidated edition section (PLAN-CHECK C10)

This slice runs last (serial order 01, 03, 02, 05, 04, 08, 06, 07), so it writes the single `CLAUDE.md` section for slices 04 to 08; slice 02 already edited the `## Auth Model` access-gate lines and no other slice edits `CLAUDE.md`.
Edits, one sentence per line where a bullet holds several, keeping every other line byte-identical:

1. `## Sales Ops Routing`: directly after the bullet that starts with "Visibility comes only from", add this bullet:

```markdown
- In the leads edition (`profile.edition === 'leads'`, from `entitlements.modules`) every navigation function takes a trailing `edition`: `admin` sees only `operacional` [`leads`] and `cadastros` [`pessoas` labelled Vendedores, `etapas`], a non-admin `seller` only `meus-dados` [`leads`], and `NoRoleGuard` keys on `getVisibleWorkspaces(roles, edition)`. Oracle: `navigation-edition.test.ts`.
```

2. `## Development identity mode`: directly after the bullet that starts with "The roster is", add:

```markdown
- `leads-owner` and `leads-seller` (on `org_fake_leads`, `FIXTURE_LEADS_EDITION_ORGANIZATION_ID`) are the ONLY identities with `modules`, exactly `['sales.edition.leads']`; `LEADS_EDITION_MODULE` is pinned equal to `SALES_EDITION_LEADS_MODULE` by `dev-identity-roles.test.tsx`. The seed gives that org no etapas, no settings row and one UNBOUND vendedor pessoa with `leads-seller`'s email.
```

3. New section `## Edição Leads`, placed directly before `## Integração Sales-Finance (plano de controle)`:

```markdown
## Edição Leads

Full reference: `nexo/knowledge/reference/kanban-de-leads.md` (section Edição Leads), `pessoas-e-funcoes.md`, `sales-ops-routing.md`, `auth-model.md`.

- The edition is DERIVED per request from the verified token: `resolveSalesEdition(entitlements.modules)` from `@fxl-sales/shared-utils/sales-edition` (subpath only). Only the exact module `sales.edition.leads` selects `leads`; absent, empty or unknown modules are `full`, which is FXL byte-for-byte. It is never stored and never read from a body.
- API: `c.get('salesEdition')` is set only in `applyHubAuthContext`; services take the edition as an explicit argument from the route (`c.get('salesEdition') ?? 'full'`) and never read the Hono context.
- Web: the shell reads `profile.edition`; leaf components read `useSalesEdition()`. Every `vi.mock('@/auth/react')` factory exports `useSalesEdition` (`auth-mock-edition-export.test.ts`).
- Leads writes use `ContactLeadFieldsSchema` (strict, `null` or `''` clears an optional) through `createContactLead` / `updateContactLead`, chosen by `leadFieldSet`; the full schemas stay byte-identical and still reject the contact keys. A leads-edition lead stores `client_id NULL`, `''`, `0` and no produtos.
- No etapa is ever seeded in the leads edition. Creating a lead with no active `normal` etapa answers the existing `400` `reason: 'no_open_stage'`; the web keys on status 400 plus `ApiError.reason`. The board shows `[data-no-stages]` and never receives `onRequestConversion` / `onOpenSale`.
- In the leads edition `POST/PATCH /people` force exactly `[vendedor]` (seeding the system funções in the same transaction) before `planPersonFuncoes`; a status-only PATCH leaves funções untouched. The Vendedores screen lists inactive vendedores with `Reativar`, because Geral and `GET /history` are gated.
- An admin in the leads edition never sees `meus-dados` (product decision); a finder-only operator stays on `/no-role`.
```


## Step 7 - run-once verification

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/auth-mock-edition-export.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/people src/sales-ops/__tests__/vendedores-routing.test.tsx src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx src/sales-ops/__tests__/cadastro-archive.test.tsx src/sales-ops/__tests__/leads-routing.test.tsx src/sales-ops/__tests__/routing.test.tsx src/sales-ops/__tests__/combobox-adoption.test.tsx
pnpm --filter @fxl-sales/web exec eslint src/sales-ops/people src/sales-ops/SalesOpsApp.tsx src/sales-ops/__tests__/vendedores-routing.test.tsx
pnpm --filter @fxl-sales/web run type-check
grep -rn "SalesOpsApp" apps/web/src/sales-ops/people --include='*.ts' --include='*.tsx' | grep -v __tests__ | grep import && echo "CYCLE" || echo "no cycle"
grep -rn "$(printf '\xe2\x80\x94')" apps/web/src/sales-ops/people && echo "EM DASH" || echo "no em dash"
```

Every vitest invocation is `vitest run` (never watch).
Before the commit, assert with `git diff master -- apps/web/src/sales-ops/SalesOpsApp.tsx` that the hunks are exactly the edits of Step 4 (imports, title, header action, mount with `onReactivate`, dialog).
Also `grep -c "$(printf '\342\200\224')" CLAUDE.md nexo/knowledge/reference/pessoas-e-funcoes.md` must print `0` for both.

## Browser check (AC6 end to end; this is the last slice, so every piece is merged)

1. Start `make dev-fake` in the background and record its process-group id.
2. As `leads-owner` (Lara): the sidebar shows only Prospecção, Vendedores and Etapas do funil; `/operacional/vendas` and `/tatico/dashboard` land back on `/operacional/leads`; the board shows the gestor empty-state.
3. Cadastros > Etapas do funil: create two etapas; Cadastros > Vendedores: the seeded vendedor (leads-seller's email) is listed; create `Ana Lima` by name only; inactivate her (confirmation copy, row turns muted with `Inativo`), then `Reativar` her.
4. Prospecção: `Novo lead` opens the contact dialog with exactly the six fields; save a lead with phone, email and birthday; the card shows them with no R$ anywhere; drag it to the second etapa.
5. As `leads-seller` (Leo): only Minha prospecção; he sees only his own leads and can create one.
6. As `team-owner`: all four painéis and today's Pessoas screen, pixel-identical to before.
7. Stop the dev server with `kill -- -<pgid>`; record screenshots or notes in the exec notes.

## Seam notes for the orchestrator

- Slice 04 applies the leads-edition `[vendedor]` override BEFORE `planPersonFuncoes` (SEAM A3), so `funcaoIds: []` never answers `funcao_required`.
- A status-only `PATCH /people/:id` (Inativar, Reativar) in the leads edition leaves the função set untouched (slice 04 returns the `unchanged` plan when the body carries no função key).
- Slice 05 added `useSalesEdition` to every existing `vi.mock('@/auth/react', ...)` factory (SEAM A5); this slice only adds it to its own new test file, and `auth-mock-edition-export.test.ts` must stay green.
