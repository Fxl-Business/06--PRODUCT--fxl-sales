---
id: 09-web-import-view
milestone: v4.2.0
status: done
depends_on: [01-contract-and-parser]
files_modified:
  - apps/web/src/lib/api-client.ts
  - apps/web/src/lib/__tests__/api-upload.test.ts
  - apps/web/src/sales-ops/import/types.ts
  - apps/web/src/sales-ops/import/api.ts
  - apps/web/src/sales-ops/import/hooks.ts
  - apps/web/src/sales-ops/import/issues.ts
  - apps/web/src/sales-ops/import/import-copy.ts
  - apps/web/src/sales-ops/import/ImportContainer.tsx
  - apps/web/src/sales-ops/import/ImportView.tsx
  - apps/web/src/sales-ops/import/ImportIssueList.tsx
  - apps/web/src/sales-ops/import/ImportCountsTable.tsx
  - apps/web/src/sales-ops/import/__tests__/issues.test.ts
  - apps/web/src/sales-ops/import/__tests__/import-copy.test.ts
  - apps/web/src/sales-ops/import/__tests__/import-view.test.tsx
  - apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/__tests__/navigation.test.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
acceptance: "At /cadastros/importacao an admin sees the Importação page with the two template download buttons, an .xlsx file input and Validar planilha; a preview body renders only the non-zero per-sheet counts and the issues grouped errors-first by sheet as 'Linha N · Coluna' plus message; Importar is disabled while the preview has an error (or nothing to create) and enabled for ok:true; a confirmed commit answering 201 renders the success summary and invalidates both ['sales-ops'] and ['leads']; 400/403/409/413/422 render inline on the screen and never ForbiddenPanel; the Cadastros nav lists Importação immediately before Geral with produtos still [0]."
goal: "Ship the cadastros/importacao screen (download blank and example templates, upload, dry-run preview, all-or-nothing commit, success summary) on the slice-07 wire contract, with one minimal multipart helper in api-client.ts."
must_not_break:
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
  - apps/web/src/sales-ops/__tests__/leads-routing.test.tsx
  - apps/web/src/sales-ops/__tests__/navigation.test.ts (updated in this slice, never weakened)
  - apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx
  - apps/web/src/sales-ops/__tests__/financial-mutation-forbidden.test.tsx
  - apps/web/src/sales-ops/__tests__/mutation-error-banner.test.tsx
  - apps/web/src/lib/__tests__/api-client-token-guard.test.ts
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - "pnpm --filter @fxl-sales/web lint / type-check / test / build"
rules:
  - "Never touch apps/web/src/sales-ops/leads/** (live peer run). Only READ leads files as style reference."
  - "SalesOpsApp.tsx changes are exactly four: the ImportContainer import, the titleForView map entry, `view === 'importacao'` added to the head of the headerAction null chain, and the mount line next to the etapas mount. Nothing else."
  - "No native <select>, <option>, <datalist> or raw <input type=\"number\">; <input type=\"file\"> is allowed."
  - "Mutations only through useAppMutation; every UI call uses mutateAsync. Preview and download are NO_CACHE_EFFECT; commit invalidates [queryKeys.salesOps.all, queryKeys.leads.all]."
  - "Error classification keys on ApiError.status only (isForbiddenFailure, isAuthFailure, numeric status), never on body `code`/`reason`. A 403 renders inline copy MUTATION_ERROR_COPY.adminRequired; ForbiddenPanel is never imported in import/**."
  - "No raw id ever rendered; the server `message` of a 409 is never rendered (it may carry service prose); issue `message` strings ARE rendered (the contract makes them pt-BR and id-free)."
  - "The only Authorization header lives in api-client.ts. import/api.ts calls apiFetchBlob and the new apiUpload only."
  - "No new dependency (no Testing Library): tests use createRoot + act + happy-dom like the existing sales-ops tests."
verifier_focus: "That Importar is disabled for any preview with an error and for zero counts, that the commit re-sends the SAME File object the preview validated (a new file selection resets the preview), that the 422 body replaces the preview, that both query roots are invalidated after the commit, and that apiUpload sends no Content-Type header (the browser must write the multipart boundary)."
---

# Slice 09 - web import view (`cadastros/importacao`)

## Objective

Give admins the onboarding and on-demand import screen inside Cadastros.
It downloads the blank or example template, uploads one `.xlsx`, shows the server's dry-run preview, and commits the same file all-or-nothing.
The API is slices 07/08; this slice only consumes the wire contract in `SEAM-CONTRACT.md` ("HTTP wire contract" and "Web contract") and the `ImportPreviewBody` / `ImportCommitBody` / `ImportIssue` / `SheetKey` shapes of slice 01's `types.ts`, mirrored by hand (the web never imports from `apps/api`).

## Code facts (verified while planning)

- `apps/web/src/lib/api-client.ts`: `apiFetch` ALWAYS sets `Content-Type: application/json` before the caller's headers, and its thrown `ApiError` keeps only `error`, `code`, `message`, `status`, `rows`, `retryAfterSeconds`.
  It therefore cannot carry a multipart body (a JSON content type breaks the boundary) and loses the `422` preview body.
  `apiFetchBlob` sends only `Authorization` and returns `{ blob, filename }` from `Content-Disposition`.
  Both call `assertBearerToken(token)` before `fetch`.
- `apps/web/src/lib/app-mutation.ts`: `useAppMutation` is the only door to `useMutation` (lint bans the direct import); `invalidates` is a non-empty key tuple or `NO_CACHE_EFFECT`; keys are invalidated in `onSettled` (success and failure).
- `apps/web/src/lib/query-keys.ts`: `queryKeys.salesOps.all = ['sales-ops']` (prefix of bootstrap, cadastro history, settlements); `queryKeys.leads.all = ['leads']` is a SEPARATE root (board and stages). An import creates leads and etapas, so the commit must list both.
- `apps/web/src/admin/payouts/usePayouts.ts` `useDownloadPayoutCsv` is the blob-download precedent (object URL + temporary `<a download>`, `NO_CACHE_EFFECT`).
- `apps/web/src/sales-ops/navigation.ts`: `SalesOpsView` is a string union; `cadastros` nav array currently ends `etapas`, `geral`; `resolveSalesOpsRoute` accepts any id present in the workspace's nav list, so adding the union member plus the nav entry is the whole routing change.
- `apps/web/src/sales-ops/SalesOpsApp.tsx`:
  - `titleForView` builds `Record<SalesOpsView, {title, subtitle}>`; a new union member does not type-check without an entry. The shell renders that title as the page `h1` and the subtitle under it, so the "header + one-line explanation" comes from here and `ImportView` renders NO `h1`.
  - `headerAction` (around line 1683) falls through to `'Nova proposta'` for any unnamed view; `importacao` must join the `geral || leads || etapas` head.
  - The etapas mount is `{view === 'etapas' ? <LeadStagesContainer /> : null}` (around line 2289) inside the `!bootstrapQuery.isLoading && !bootstrapQuery.isError` block.
  - Style constants (`panelClass`, `mutedPanelClass`, `tableHeadClass`, `tableCellClass`, `wizardPrimaryButtonClass`, `wizardSecondaryButtonClass`) cannot be imported (they are module-private and `SalesOpsApp` imports this module, a cycle); `CadastroHistoryPanel.tsx` documents the local-copy convention.
- `apps/web/src/sales-ops/mutation-error-copy.ts` exports `MUTATION_ERROR_COPY` (`adminRequired`, `generic`, `dismiss`) and `MutationErrorBanner.tsx` renders a fixed message chosen by `salesOpsMutationErrorMessage`, which only knows 403/409-settlement/generic. It cannot show import-specific copy, so this slice renders its own inline banner with the SAME classes and `role="alert"`, and uses `MUTATION_ERROR_COPY.adminRequired` verbatim for 403.
- `apps/web/src/lib/require-token.ts` exports `isAuthFailure`, `isForbiddenFailure`, `requireToken`.
- `apps/web/src/sales-ops/__tests__/navigation.test.ts` pins the Cadastros id list and label list literally (lines 59-76); both must gain `importacao` / `Importação` before `geral` / `Geral`.
- `apps/web/src/sales-ops/__tests__/leads-routing.test.tsx` is the shell mount-oracle pattern (mocks `../hooks` wholesale and the two lead containers, renders `SalesOpsApp` in a `MemoryRouter` with `/:workspace/:view`).
- `apps/web/vitest.config.ts`: default environment `node`, includes `src/**/__tests__/**/*.test.ts(x)`; component tests start with `// @vitest-environment happy-dom`.
- No `@testing-library/*` is installed; tests use `createRoot` + `React.act` (`(React as ...).act`, see leads-routing.test.tsx line 41).
- `lucide-react@0.475` exports `FileSpreadsheet`, `Download`, `Upload`, `Loader2`, `CheckCircle2`, `AlertTriangle`, `XCircle`, `X`.
- `@/components/ui/alert-dialog` (Radix) is the confirmation pattern used by `CadastroHistoryPanel`; its tests mock it with the `CloseCtx` version in `cadastro-history.test.tsx` lines 38-75.

## File 1 - `apps/web/src/lib/api-client.ts` (minimal addition, nothing existing changes)

1. Add one optional field to `ApiError`, after `retryAfterSeconds`:

```ts
  /**
   * The parsed JSON error body, set ONLY by `apiUpload`. The import commit answers
   * `422` with a whole preview body that the screen must render. Display data only:
   * classification still keys on `status`.
   */
  body?: unknown;
```

2. Add, directly after `apiFetchBlob`:

```ts
/**
 * Multipart variant of apiFetch for file uploads (the spreadsheet import). Same base
 * URL and Bearer chokepoint; deliberately NO Content-Type header, because the browser
 * must write `multipart/form-data; boundary=...` itself. A failure throws an ApiError
 * that also carries the parsed `body`.
 */
export async function apiUpload<T>(
  path: string,
  init: { token: string; form: FormData },
): Promise<T> {
  assertBearerToken(init.token);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${init.token}` },
    body: init.form,
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const err: ApiError = {
      error: typeof record.error === 'string' ? record.error : 'request_failed',
      code: typeof record.code === 'string' ? record.code : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
      status: res.status,
      body,
    };
    throw err;
  }
  return res.json() as Promise<T>;
}
```

`apiFetch` and `apiFetchBlob` are byte-unchanged.

## File 2 - `apps/web/src/sales-ops/import/types.ts`

```ts
/**
 * Hand mirror of apps/api/src/domains/import/types.ts (slice 01) wire shapes. The web
 * never imports from apps/api. Keep SHEET_KEYS in the SEAM-CONTRACT sheet order.
 */
export const SHEET_KEYS = [
  'areas', 'funcoes', 'produtos', 'custosProduto', 'pessoas', 'clientes', 'etapas',
  'leads', 'propostas', 'itens', 'profissionais', 'parcelas', 'pagamentos',
] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export const SHEET_LABELS: Record<SheetKey, string> = {
  areas: 'Áreas',
  funcoes: 'Funções',
  produtos: 'Produtos',
  custosProduto: 'Custos por produto',
  pessoas: 'Pessoas',
  clientes: 'Clientes',
  etapas: 'Etapas',
  leads: 'Leads',
  propostas: 'Propostas',
  itens: 'Itens da proposta',
  profissionais: 'Profissionais da proposta',
  parcelas: 'Parcelas',
  pagamentos: 'Pagamentos',
};

export type ImportIssueSeverity = 'error' | 'warning';
export type ImportIssue = {
  severity: ImportIssueSeverity;
  sheet: SheetKey | null;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
};
export type ImportCounts = Partial<Record<SheetKey, number>>;
export type ImportPreviewBody = { ok: boolean; counts: ImportCounts; issues: ImportIssue[]; truncated: boolean };
export type ImportCommitBody = { counts: ImportCounts };

/** D9 mirror: the server refuses above this with 413; the screen refuses before uploading. */
export const MAX_IMPORT_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_RETURNED_ISSUES = 500;

export const IMPORT_TEMPLATE_FILENAME = 'fxl-sales-importacao.xlsx';
export const IMPORT_EXAMPLE_FILENAME = 'fxl-sales-importacao-exemplo.xlsx';
export const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Structural guard for the 422 body of POST /commit. */
export function isImportPreviewBody(value: unknown): value is ImportPreviewBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean' && typeof v.truncated === 'boolean' &&
    Array.isArray(v.issues) && typeof v.counts === 'object' && v.counts !== null;
}
```

`types.ts` exports a function and constants but no component, so `react-refresh/only-export-components` does not apply.

## File 3 - `apps/web/src/sales-ops/import/api.ts`

```ts
import { apiFetchBlob, apiUpload } from '@/lib/api-client';
import { IMPORT_EXAMPLE_FILENAME, IMPORT_TEMPLATE_FILENAME, type ImportCommitBody, type ImportPreviewBody } from './types';

const BASE = '/api/v1/sales-ops/import';

function fileForm(file: File): FormData {
  const form = new FormData();
  form.append('file', file, file.name);
  return form;
}

export const importApi = {
  downloadTemplate: async (example: boolean, token: string) => {
    const { blob, filename } = await apiFetchBlob(`${BASE}/template?example=${example ? '1' : '0'}`, { method: 'GET', token });
    return { blob, filename: filename ?? (example ? IMPORT_EXAMPLE_FILENAME : IMPORT_TEMPLATE_FILENAME) };
  },
  preview: (file: File, token: string) => apiUpload<ImportPreviewBody>(`${BASE}/preview`, { token, form: fileForm(file) }),
  commit: (file: File, token: string) => apiUpload<ImportCommitBody>(`${BASE}/commit`, { token, form: fileForm(file) }),
};
```

## File 4 - `apps/web/src/sales-ops/import/hooks.ts`

```ts
export function useDownloadImportTemplate()   // useAppMutation<void, unknown, boolean>; mutationFn(example): importApi.downloadTemplate(example, await requireToken(getToken)) then saveBlob(blob, filename); invalidates: NO_CACHE_EFFECT
export function usePreviewImport()            // useAppMutation<ImportPreviewBody, unknown, File>; invalidates: NO_CACHE_EFFECT (read-only server verification)
export function useCommitImport()             // useAppMutation<ImportCommitBody, unknown, File>; invalidates: [queryKeys.salesOps.all, queryKeys.leads.all]
```

`saveBlob(blob, filename)` is a module-private function copying the `useDownloadPayoutCsv` body (createObjectURL, append `<a download>`, click, remove, revokeObjectURL).
`getToken` comes from `useAccessToken()` in `@/auth/react`; token via `await requireToken(getToken)`.
The commit's `invalidates` comment states that leads are a separate root (query-keys.ts) and an import creates leads and etapas.

## File 5 - `apps/web/src/sales-ops/import/issues.ts` (pure, no React)

```ts
export type IssueGroup = { sheet: SheetKey | null; label: string; issues: ImportIssue[] };
export type GroupedIssues = { errors: IssueGroup[]; warnings: IssueGroup[]; errorCount: number; warningCount: number };

export function groupImportIssues(issues: readonly ImportIssue[]): GroupedIssues;
export function issueLocation(issue: ImportIssue): string;
export function nonZeroCounts(counts: ImportCounts): Array<{ sheet: SheetKey; label: string; count: number }>;
export function totalCount(counts: ImportCounts): number;
```

Algorithms:

- `groupImportIssues`: partition by `severity`; inside each partition group by `sheet`, groups ordered `null` first (label `Arquivo`) then `SHEET_KEYS` order (label `SHEET_LABELS[sheet]`); inside a group sort by `row` ascending with `null` first, stable otherwise (keep server order for ties). Empty groups are omitted. An issue whose `sheet` is not a known key (defensive) goes to the `null` group.
- `issueLocation`: parts = [`row !== null ? \`Linha ${row}\` : null`, `column`] filtered non-null, joined with ` · `; when empty: `Aba inteira` if `sheet !== null`, else `Arquivo inteiro`.
  Examples: `{row:7,column:'Cliente'}` gives `Linha 7 · Cliente`; `{row:1,column:'Vendedor'}` gives `Linha 1 · Vendedor`; `{row:null,column:'Valor'}` gives `Valor`; `{row:12,column:null}` gives `Linha 12`.
- `nonZeroCounts`: iterate `SHEET_KEYS` order, keep `count > 0` (ignore undefined, 0, negatives, non-finite).
- `totalCount`: sum of `nonZeroCounts`.

## File 6 - `apps/web/src/sales-ops/import/import-copy.ts` (pure)

```ts
export const IMPORT_COPY = {
  intro: 'Use os modelos para trazer cadastros, leads e propostas de uma vez. A importação só cria registros novos: nada existente é alterado.',
  step1Title: '1. Baixe o modelo',
  step1Text: 'O modelo em branco já traz as listas com os cadastros atuais da organização. O modelo com exemplo mostra uma linha preenchida em cada aba.',
  downloadBlank: 'Baixar modelo em branco',
  downloadExample: 'Baixar modelo com exemplo',
  step2Title: '2. Envie a planilha preenchida',
  step2Text: 'Apenas arquivos .xlsx de até 5 MB. Abas vazias são ignoradas.',
  chooseFile: 'Escolher arquivo',
  noFile: 'Nenhum arquivo escolhido',
  validate: 'Validar planilha',
  validating: 'Validando...',
  step3Title: '3. Confira e importe',
  countsSheet: 'Aba',
  countsToCreate: 'Registros a criar',
  countsCreated: 'Registros criados',
  nothingToImport: 'A planilha não tem linhas para importar.',
  errorsTitle: (n: number) => (n === 1 ? '1 erro' : `${n} erros`),
  warningsTitle: (n: number) => (n === 1 ? '1 aviso' : `${n} avisos`),
  errorsBlock: 'Corrija os erros na planilha e valide novamente. Enquanto houver erros, nada pode ser importado.',
  truncated: `A lista mostra os primeiros 500 problemas. Corrija estes e valide novamente para ver os demais.`,
  readyOk: 'Nenhum erro encontrado. Os avisos acima não impedem a importação.',
  readyClean: 'Nenhum erro encontrado.',
  allOrNothing: 'A importação é tudo ou nada: se qualquer linha for recusada na gravação, nada é criado. Ela só cria registros novos e nunca altera cadastros existentes.',
  import: 'Importar',
  importing: 'Importando...',
  confirmTitle: 'Importar planilha?',
  confirmText: (total: number) => `Serão criados ${total} registros nesta organização, de uma vez. Se qualquer linha for recusada, nada é criado. Registros existentes nunca são alterados.`,
  confirmCancel: 'Voltar',
  confirmAction: 'Importar',
  successTitle: 'Importação concluída',
  successText: 'Os registros abaixo foram criados e já aparecem nas outras telas.',
  another: 'Importar outra planilha',
  tooLargeLocal: 'O arquivo passa do limite de 5 MB. Divida a planilha em partes menores.',
  notXlsxLocal: 'Escolha um arquivo .xlsx.',
} as const;

export function importErrorMessage(error: unknown): string;
```

`importErrorMessage` keys on the status only, in this order:
1. `isForbiddenFailure(error)` returns `MUTATION_ERROR_COPY.adminRequired` (imported from `../mutation-error-copy`).
2. `isAuthFailure(error)` returns `Sua sessão do FXL Hub expirou ou não pôde ser renovada. Atualize a página para entrar novamente.`
3. `status === 400` returns `O arquivo não é uma planilha .xlsx válida. Baixe o modelo e tente novamente.`
4. `status === 413` returns `IMPORT_COPY.tooLargeLocal`.
5. `status === 409` returns `Nada foi importado: um registro foi recusado durante a gravação. Valide a planilha novamente e tente outra vez.`
6. `status === 422` returns `Nada foi importado: a planilha ou os cadastros da organização mudaram desde a validação. Corrija os erros abaixo e valide novamente.`
7. anything else returns `MUTATION_ERROR_COPY.generic`.

`status` is read as `(error as { status?: unknown }).status` when `error` is a non-null object; never read `code`, `reason` or `message`.

## File 7 - `apps/web/src/sales-ops/import/ImportCountsTable.tsx`

`ImportCountsTable({ counts, heading }: { counts: ImportCounts; heading: string })` renders `@/components/ui/table` with columns `IMPORT_COPY.countsSheet` and `heading`, one row per `nonZeroCounts(counts)` entry (label, count right-aligned with `sales-ops-num`), wrapped in `<div data-import-counts>`.
Each row carries `data-import-count={sheet}`.
With zero non-zero rows it renders `<p>` with `IMPORT_COPY.nothingToImport` instead of the table.

## File 8 - `apps/web/src/sales-ops/import/ImportIssueList.tsx`

`ImportIssueList({ issues, truncated }: { issues: readonly ImportIssue[]; truncated: boolean })`:
- `const grouped = groupImportIssues(issues)`; renders nothing when both counts are 0.
- Errors section first (`data-import-issues="error"`, heading `IMPORT_COPY.errorsTitle(n)`, `XCircle` icon, red palette `text-[#c93d32]`), then warnings (`data-import-issues="warning"`, `warningsTitle`, `AlertTriangle`, amber `text-[#9c7210]`).
- Per group: `<h4 data-import-issue-group={sheet ?? 'file'}>{label}</h4>` then a `<ul>`; each `<li data-import-issue>` shows `<span className="font-semibold">{issueLocation(issue)}</span>` then ` - ` then `{issue.message}`. Never render `code`.
- When `truncated`, a muted `<p data-import-truncated>{IMPORT_COPY.truncated}</p>` under the lists.

## File 9 - `apps/web/src/sales-ops/import/ImportView.tsx` (prop-driven, holds UI state only)

Props:

```ts
type ImportViewProps = {
  onDownload: (example: boolean) => Promise<void>;
  onPreview: (file: File) => Promise<ImportPreviewBody>;
  onCommit: (file: File) => Promise<ImportCommitBody>;
};
```

Local copies of the style constants (comment citing the cycle, as `CadastroHistoryPanel.tsx` does): `panelClass`, `mutedPanelClass`, `tableHeadClass`, `tableCellClass`, `primaryButtonClass` (= `wizardPrimaryButtonClass`), `secondaryButtonClass` (= `wizardSecondaryButtonClass` plus `disabled:cursor-not-allowed disabled:opacity-60 inline-flex items-center gap-2`), `errorBannerClass` (= the `MutationErrorBanner` container classes).

State: `file: File | null`, `preview: ImportPreviewBody | null`, `result: ImportCommitBody | null`, `error: unknown` (null when none), `localError: string | null`, `busy: 'download-blank' | 'download-example' | 'preview' | 'commit' | null`, `confirmOpen: boolean`.
A ref `inputRef` on the file input to clear its value on reset.

Layout: root `<div className="flex flex-col gap-[14px]" data-import-view>`; no `h1` (the shell renders the title and subtitle).

- Error banner (top, when `error !== null || localError !== null`): `<div role="alert" data-import-error className={errorBannerClass}>` with message `localError ?? importErrorMessage(error)` and a dismiss button (`aria-label={MUTATION_ERROR_COPY.dismiss}`, `X` icon) clearing both.
- When `result !== null`: ONLY the success panel `<section data-import-success>` with `CheckCircle2`, `IMPORT_COPY.successTitle`, `successText`, `<ImportCountsTable counts={result.counts} heading={IMPORT_COPY.countsCreated} />`, and a secondary button `IMPORT_COPY.another` that resets every state to initial and clears `inputRef.current.value`.
- Otherwise three step panels (`panelClass`, `px-[22px] py-4` header like CadastroHistoryPanel):
  - Step 1 (`data-import-step="1"`): title, text, two secondary buttons with `Download` icon: `downloadBlank` calls `run('download-blank', () => onDownload(false))`, `downloadExample` calls `run('download-example', () => onDownload(true))`. Both `disabled={busy !== null}`. On rejection set `error`.
  - Step 2 (`data-import-step="2"`): title, text; `<label>` styled as secondary button (`Upload` icon, `IMPORT_COPY.chooseFile`) wrapping `<input type="file" accept={XLSX_ACCEPT} className="sr-only" data-import-file onChange={...} ref={inputRef} />`; next to it the file name or `noFile` (muted). Primary button `type="button"` `validate` (`validating` + `Loader2` spinner while `busy === 'preview'`), `disabled={file === null || busy !== null}`.
    - onChange: `const next = event.target.files?.[0] ?? null`; ALWAYS reset `preview`, `error`, `localError`; if `next` and not `next.name.toLowerCase().endsWith('.xlsx')` set `localError = notXlsxLocal` and `file = null`; else if `next.size > MAX_IMPORT_UPLOAD_BYTES` set `localError = tooLargeLocal` and `file = null`; else `file = next`.
    - Validate click: `busy='preview'`, clear errors, `setPreview(await onPreview(file))`; catch sets `error`; finally `busy=null`.
  - Step 3 (`data-import-step="3"`), rendered only when `preview !== null`: title; `<ImportCountsTable counts={preview.counts} heading={IMPORT_COPY.countsToCreate} />`; `<ImportIssueList issues={preview.issues} truncated={preview.truncated} />`; status line: if `!preview.ok` show `errorsBlock`; else `warningCount > 0 ? readyOk : readyClean`; `allOrNothing` paragraph (muted); primary button `type="button"` `data-import-commit` `IMPORT_COPY.import`, `disabled={!canImport || busy !== null}` where `canImport = preview.ok && totalCount(preview.counts) > 0 && file !== null`; click sets `confirmOpen = true`.
- `AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}` with title `confirmTitle`, description `confirmText(totalCount(preview.counts))`, `AlertDialogCancel` `confirmCancel`, `AlertDialogAction` `confirmAction` with `onClick={confirmCommit}`.
- `confirmCommit`: `setConfirmOpen(false)`; `busy='commit'`; clear errors; `try { setResult(await onCommit(file)); setPreview(null); } catch (e) { setError(e); const body = (e as { body?: unknown })?.body; if ((e as {status?:unknown})?.status === 422 && isImportPreviewBody(body)) setPreview(body); } finally { busy = null }`.
  The same `File` object validated in step 2 is sent; selecting a new file resets the preview, so a commit can never send a file other than the one previewed.

## File 10 - `apps/web/src/sales-ops/import/ImportContainer.tsx`

No state, no logic (the `LeadStagesContainer` convention, cite it):

```tsx
export function ImportContainer() {
  const download = useDownloadImportTemplate();
  const preview = usePreviewImport();
  const commit = useCommitImport();
  return (
    <ImportView
      onCommit={(file) => commit.mutateAsync(file)}
      onDownload={(example) => download.mutateAsync(example)}
      onPreview={(file) => preview.mutateAsync(file)}
    />
  );
}
```

## File 11 - `apps/web/src/sales-ops/navigation.ts`

- Add `FileSpreadsheet` to the lucide import (alphabetical position, after `Database`).
- Add `| 'importacao'` to `SalesOpsView` after `'etapas'`.
- In `cadastros`, insert `{ id: 'importacao', label: 'Importação', icon: FileSpreadsheet },` between the `etapas` entry and `geral`, extending the existing comment: "Before `geral` too; `produtos` stays `[0]`."

## File 12 - `apps/web/src/sales-ops/SalesOpsApp.tsx` (exactly four edits)

1. Import, after the `LeadStagesContainer` import line: `import { ImportContainer } from './import/ImportContainer';`
2. `titleForView` map, after `etapas`:
   ```ts
   importacao: {
     title: 'Importação',
     subtitle: 'Planilhas para o onboarding e para trazer cadastros, leads e propostas em lote',
   },
   ```
3. `headerAction`: `view === 'geral' || view === 'leads' || view === 'etapas' || view === 'importacao'`, and append to the comment above it: "`importacao` has no create action at all."
4. Mount line immediately after the etapas mount: `{view === 'importacao' ? <ImportContainer /> : null}`.

## Red tests (write first, watch them fail, then implement)

### `apps/web/src/lib/__tests__/api-upload.test.ts` (node env, `vi.stubGlobal('fetch', ...)` like api-client-token-guard.test.ts)

- `rejects an empty token without calling fetch` (`AuthTokenUnavailableError`).
- `posts the FormData with a Bearer header and no Content-Type`: asserts method `POST`, `init.body` is the same FormData instance, `headers.Authorization === 'Bearer abc'`, and `Object.keys(headers)` has no case-insensitive `content-type`.
- `throws an ApiError carrying status and the parsed body`: fetch resolves `{ ok: false, status: 422, json: async () => ({ ok: false, counts: {}, issues: [], truncated: false }) }`; the rejection has `status: 422`, `error: 'request_failed'` and `body` deep-equal to that object.
- `maps error and message strings from the body`: 409 `{ error: 'conflict', reason: 'import_execution_failed', message: 'x' }` gives `error: 'conflict'`, `message: 'x'`, `status: 409`.

### `apps/web/src/sales-ops/import/__tests__/issues.test.ts`

- `orders errors before warnings and groups by sheet in workbook order with Arquivo first`: input mixes a `propostas` warning, an `areas` error row 9, a `null`-sheet error, an `areas` error row 3, a `leads` error; asserts `errors.map(g => g.label)` is `['Arquivo', 'Áreas', 'Leads']`, Áreas rows `[3, 9]`, warnings `['Propostas']`, `errorCount 4`, `warningCount 1`.
- `formats the location as Linha N · Coluna`: the four examples in File 5 plus `Aba inteira` and `Arquivo inteiro`.
- `keeps only non-zero counts in sheet order`: `{ propostas: 2, areas: 0, clientes: 5, leads: undefined }` gives `[clientes 5, propostas 2]` with labels `Clientes`, `Propostas`; `totalCount` is 7.
- `SHEET_LABELS names the tabs of the seam contract in order`: `SHEET_KEYS.map(k => SHEET_LABELS[k])` deep-equals the 13 tab names of SEAM-CONTRACT.md literally.

### `apps/web/src/sales-ops/import/__tests__/import-copy.test.ts`

- `importErrorMessage keys on status`: `{status:403}` gives `MUTATION_ERROR_COPY.adminRequired`; 401 gives the session line; 400, 409, 413, 422 give their lines; `{status:500}` and `new Error('x')` give `MUTATION_ERROR_COPY.generic`.
- `ignores the body code`: `{ status: 409, code: 'forbidden', error: 'forbidden' }` still gives the 409 line.

### `apps/web/src/sales-ops/import/__tests__/import-view.test.tsx` (`// @vitest-environment happy-dom`)

Setup: `vi.mock('../api', () => ({ importApi: { downloadTemplate: vi.fn(), preview: vi.fn(), commit: vi.fn() } }))`; `vi.mock('@/auth/react', () => ({ useAccessToken: () => ({ getToken: async () => 'test-token' }) }))`; the `CloseCtx` `@/components/ui/alert-dialog` mock copied from `cadastro-history.test.tsx`; render `<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ImportContainer /></QueryClientProvider>` with `createRoot` + `act`; spy `vi.spyOn(queryClient, 'invalidateQueries')`.
Helper `chooseFile(name = 'planilha.xlsx', size = 10)`: builds `new File([new Uint8Array(size)], name)`, `Object.defineProperty(input, 'files', { value: [file], configurable: true })`, dispatches `new Event('change', { bubbles: true })` inside `act`.
`URL.createObjectURL` / `revokeObjectURL` are stubbed with `vi.fn()` for the download case.

- `renders the three steps with Validar disabled until a file is chosen`.
- `downloads the blank and the example template`: clicking each button calls `importApi.downloadTemplate` with `(false, 'test-token')` then `(true, 'test-token')`.
- `refuses a non-xlsx and an oversized file before uploading`: `notes.csv` shows `notXlsxLocal`; a `MAX_IMPORT_UPLOAD_BYTES + 1` byte xlsx shows `tooLargeLocal`; `preview` never called; Validar disabled.
- `renders non-zero counts and grouped issues errors first`: preview resolves `{ ok: false, counts: { clientes: 3, areas: 0, propostas: 2 }, issues: [warning propostas row 4 column 'Desconto', error clientes row 7 column 'Documento', error null sheet], truncated: true }`; asserts `[data-import-count]` values are `['clientes', 'propostas']` (no `areas`); `[data-import-issues="error"]` precedes `[data-import-issues="warning"]` in document order; error groups `['file', 'clientes']`; an `li` text contains `Linha 7 · Documento`; `[data-import-truncated]` present; no issue `code` text rendered.
- `keeps Importar disabled while the preview has errors`.
- `keeps Importar disabled for an ok preview with nothing to create` (`counts: {}`).
- `enables Importar for an ok preview and commits the same file after confirming`: preview ok with `{ areas: 2 }`; click Importar, the confirm text names `2 registros`; click the confirm action; `importApi.commit` was called with the exact `File` instance passed to `preview`; `[data-import-success]` shows `Importação concluída` and the created count row `areas`; `invalidateQueries` was called with `{ queryKey: ['sales-ops'] }` and `{ queryKey: ['leads'] }`.
- `cancelling the confirmation commits nothing`.
- `a new file selection discards the previous preview` (step 3 disappears).
- `renders a 403 inline with the admin copy and never ForbiddenPanel`: preview rejects `{ status: 403, error: 'forbidden' }`; `[data-import-error]` text equals `MUTATION_ERROR_COPY.adminRequired`; `document.querySelector('[data-forbidden]')` is null (the real ForbiddenPanel marker).
- `replaces the preview with the 422 body`: commit rejects `{ status: 422, error: 'request_failed', body: { ok: false, counts: { areas: 2 }, issues: [error areas row 2 'Nome'], truncated: false } }`; the error banner shows the 422 line, the issue list shows `Linha 2 · Nome`, Importar is disabled, no success panel.
- `renders 409 and 413 inline`: commit rejecting 409 shows the 409 line and keeps step 3; preview rejecting 413 shows `tooLargeLocal`.
- `Importar outra planilha resets the screen` (after success, step panels return, file name shows `noFile`).

### `apps/web/src/sales-ops/import/__tests__/import-routing.test.tsx` (`// @vitest-environment happy-dom`)

Copy the leads-routing.test.tsx harness (mocks of `@/auth/react`, `../../hooks` wholesale with the same object, `../../leads/LeadsBoardContainer`, `../../leads/LeadStagesContainer`, `@/components/ui/dialog`), plus `vi.mock('../ImportContainer', () => ({ ImportContainer: () => <div data-import-container /> }))`.
Paths are relative to `import/__tests__/`.

- `mounts the import screen at cadastros/importacao with its title and no create action`: `[data-import-container]` present, `h1` is `Importação`, header text contains none of `Nova proposta`, `Novo produto`, `Nova área`; non-vacuity control: `/operacional/vendas` header contains `Nova proposta`.
- `mounts it nowhere else`: `/cadastros/produtos`, `/cadastros/geral`, `/tatico/dashboard` render no `[data-import-container]`.
- `lists Importação in the Cadastros sidebar right before Geral`: the rendered nav button texts include `Importação` immediately followed by `Geral`.
- `a seller cannot reach it`: `['seller']` at `/cadastros/importacao` renders no `[data-import-container]` (redirected to the role default).

### `apps/web/src/sales-ops/__tests__/navigation.test.ts` (update, not weaken)

Insert `'importacao'` between `'etapas'` and `'geral'` in the id list and `'Importação'` between `'Etapas do funil'` and `'Geral'` in the label list.
Add one case `resolves cadastros/importacao for an admin only`: `resolveSalesOpsRoute({ workspace: 'cadastros', view: 'importacao' }, team)` equals `{ route: { workspace: 'cadastros', view: 'importacao' }, path: '/cadastros/importacao', redirect: false }`, and for `seller` it is `redirect: true` with a non-`importacao` view.

Named locked oracles for this slice: `src/sales-ops/import/__tests__/import-view.test.tsx` (`keeps Importar disabled while the preview has errors`, `enables Importar for an ok preview and commits the same file after confirming`, `renders a 403 inline with the admin copy and never ForbiddenPanel`), `src/sales-ops/import/__tests__/import-routing.test.tsx`, `src/sales-ops/__tests__/navigation.test.ts`, `src/lib/__tests__/api-upload.test.ts`.

## Commands (run once each, never watch mode)

```bash
pnpm --filter @fxl-sales/web exec vitest run src/lib/__tests__/api-upload.test.ts src/sales-ops/import src/sales-ops/__tests__/navigation.test.ts src/sales-ops/__tests__/routing.test.tsx src/sales-ops/__tests__/leads-routing.test.tsx src/lib/__tests__/api-client-token-guard.test.ts
pnpm --filter @fxl-sales/web exec eslint src/lib/api-client.ts src/lib/__tests__/api-upload.test.ts src/sales-ops/import src/sales-ops/navigation.ts src/sales-ops/__tests__/navigation.test.ts src/sales-ops/SalesOpsApp.tsx
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web test
```

If `@fxl-sales/shared-utils` subpaths fail to resolve in type-check, run `pnpm run build:packages` once at the repo root and retry.

## Manual E2E

The orchestrator runs this after slices 07 and 08 are merged (the screen needs the real routes).
Start with `make dev-fake` (API http://localhost:3006, web http://localhost:8006), sign in as the `team-owner` identity, and stop the process group it started when done.

1. Open the Cadastros painel: the sidebar shows `Importação` (spreadsheet icon) directly above `Geral`; `Produtos & Serviços` is still the first entry and the Cadastros landing route.
2. Open `/cadastros/importacao`: `h1` `Importação` with its subtitle; no `Nova proposta` header button; three step panels aligned with the other Cadastros panels (same radius, borders, paddings); check at 1440px and at a narrow 390px width that nothing overflows horizontally.
3. Click `Baixar modelo em branco`: the browser saves `fxl-sales-importacao.xlsx`; the network request carries the Bearer header and answers 200. Click `Baixar modelo com exemplo`: `fxl-sales-importacao-exemplo.xlsx`.
4. Choose a `.csv`: the inline `Escolha um arquivo .xlsx.` banner, Validar disabled, no network request.
5. Choose the downloaded EXAMPLE file and click `Validar planilha`: request `POST /api/v1/sales-ops/import/preview` is `multipart/form-data; boundary=...` (inspect the request headers: NOT `application/json`); step 3 shows only non-zero counts, zero errors, possibly warnings, and `Importar` enabled.
6. Click `Importar`, read the confirmation (all-or-nothing, create-only, the total), click `Voltar`: nothing is sent. Click `Importar` again and confirm: `POST /commit` answers 201, the success panel lists the created counts, and `/cadastros/produtos`, `/cadastros/pessoas`, `/operacional/leads` and `/operacional/vendas` show the imported rows without a page reload.
7. Validate the SAME example file again: the preview now shows `duplicate_existing` errors for the cadastros (D5) grouped under their tabs as `Linha N · <coluna>`, and `Importar` is disabled.
8. Edit a copy of the blank template with one bad date in `Propostas` and validate: one error under `Propostas` naming the row and the header text; no raw uuid anywhere on the page.
9. Choose a file larger than 5 MB (any padded `.xlsx`): the local `5 MB` banner, no request.
10. Dismiss each banner with the close button; the banner disappears and the rest of the screen stays.
11. Switch to a seller-only route check: `/cadastros/importacao` typed by hand as a non-admin identity (if the roster has none, skip and note the CLAUDE.md "OPEN PRODUCT QUESTION") redirects away.
12. Console: no React warnings, no failed requests other than the deliberate ones.

## Seam deviations

1. `SalesOpsApp.tsx` needs FOUR edits, not "only the one mount line plus its import": `titleForView` is a `Record<SalesOpsView, ...>` that does not type-check without an `importacao` entry (and it is where the page header and one-line explanation come from), and `headerAction` falls through to `Nova proposta` for any view it does not name (the exact trap the leads/etapas comment documents). Proposed SEAM amendment to the "Web contract" bullet: "`SalesOpsApp.tsx` gains the `ImportContainer` import, the `importacao` entry in `titleForView`, `view === 'importacao'` in the `headerAction` null head, and the one mount line."
2. `apps/web/src/lib/api-client.ts` gains `apiUpload` and an optional `ApiError.body` (plus its test file `apps/web/src/lib/__tests__/api-upload.test.ts`). `apiFetch` cannot carry `FormData` (it forces `Content-Type: application/json`) and drops the 422 preview body that the screen must render. Proposed SEAM wording: "uploads use `apiUpload` in `api-client.ts` (multipart, no Content-Type, error carries `body`)".
3. The 403 is rendered by an import-local inline banner with the `MutationErrorBanner` classes and `MUTATION_ERROR_COPY.adminRequired` verbatim, not by `MutationErrorBanner` itself, because that component can only show its three fixed messages and the import needs status-specific copy (400/409/413/422) in the same slot. `MutationErrorBanner.tsx` and `mutation-error-copy.ts` stay unchanged.
4. `apps/web/src/sales-ops/__tests__/navigation.test.ts` is outside `import/**` but pins the Cadastros list literally, so it is updated here.
5. Capture step (orchestrator, not this slice): CLAUDE.md "Sales Ops Routing" route list and `nexo/knowledge/reference/sales-ops-routing.md` line 6 should gain `importacao` in `cadastros/produtos|areas|clientes|pessoas|funcoes|etapas|importacao|geral`.
