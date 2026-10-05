// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
}));

/* The CloseCtx version from cadastro-history.test.tsx: Cancel really closes. */
vi.mock('@/components/ui/alert-dialog', () => {
  const CloseCtx = React.createContext<() => void>(() => undefined);
  return {
    AlertDialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      open ? (
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>{children}</CloseCtx.Provider>
      ) : null,
    AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button data-confirm-action onClick={onClick} type="button">
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { children: ReactNode }) => {
      const close = React.useContext(CloseCtx);
      return (
        <button data-confirm-cancel onClick={close} type="button">
          {children}
        </button>
      );
    },
  };
});

vi.mock('../api', () => ({
  importApi: { downloadTemplate: vi.fn(), preview: vi.fn(), commit: vi.fn() },
}));

import { importApi } from '../api';
import { IMPORT_COPY } from '../import-copy';
import { ImportContainer } from '../ImportContainer';
import { MAX_IMPORT_UPLOAD_BYTES, type ImportIssue, type ImportPreviewBody } from '../types';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const api = vi.mocked(importApi);

let container: HTMLDivElement;
let root: Root | null;
let queryClient: QueryClient;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement('div');
  document.body.append(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderView() {
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ImportContainer />
      </QueryClientProvider>,
    );
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find((b) =>
    b.textContent?.trim().includes(text),
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found as HTMLButtonElement;
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function chooseFile(name = 'planilha.xlsx', size = 10): Promise<File> {
  const input = container.querySelector('[data-import-file]') as HTMLInputElement;
  const file = new File([new Uint8Array(size)], name);
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return file;
}

const issue = (over: Partial<ImportIssue>): ImportIssue => ({
  severity: 'error',
  sheet: null,
  row: null,
  column: null,
  code: 'secret_code',
  message: 'mensagem',
  ...over,
});

const okPreview = (counts: ImportPreviewBody['counts'] = { areas: 2 }): ImportPreviewBody => ({
  ok: true,
  counts,
  issues: [],
  truncated: false,
});

async function validatedWith(preview: ImportPreviewBody) {
  api.preview.mockResolvedValue(preview);
  await renderView();
  const file = await chooseFile();
  await click(button(IMPORT_COPY.validate));
  return file;
}

const text = () => container.textContent ?? '';
const importButton = () => container.querySelector('[data-import-commit]') as HTMLButtonElement;

describe('import view', () => {
  it('renders the three steps with Validar disabled until a file is chosen', async () => {
    await renderView();
    expect(container.querySelector('[data-import-step="1"]')).not.toBeNull();
    expect(container.querySelector('[data-import-step="2"]')).not.toBeNull();
    expect(container.querySelector('[data-import-step="3"]')).toBeNull();
    expect(button(IMPORT_COPY.validate).disabled).toBe(true);
    await chooseFile();
    expect(button(IMPORT_COPY.validate).disabled).toBe(false);
  });

  it('downloads the blank and the example template', async () => {
    api.downloadTemplate.mockResolvedValue({ blob: new Blob(['x']), filename: 'a.xlsx' });
    await renderView();
    await click(button(IMPORT_COPY.downloadBlank));
    await click(button(IMPORT_COPY.downloadExample));
    expect(api.downloadTemplate.mock.calls).toEqual([
      [false, 'test-token'],
      [true, 'test-token'],
    ]);
  });

  it('refuses a non-xlsx and an oversized file before uploading', async () => {
    await renderView();
    await chooseFile('notes.csv');
    expect(container.querySelector('[data-import-error]')?.textContent).toContain(
      IMPORT_COPY.notXlsxLocal,
    );
    expect(button(IMPORT_COPY.validate).disabled).toBe(true);
    await chooseFile('big.xlsx', MAX_IMPORT_UPLOAD_BYTES + 1);
    expect(container.querySelector('[data-import-error]')?.textContent).toContain(
      IMPORT_COPY.tooLargeLocal,
    );
    expect(button(IMPORT_COPY.validate).disabled).toBe(true);
    expect(api.preview).not.toHaveBeenCalled();
  });

  it('renders non-zero counts and grouped issues errors first', async () => {
    await validatedWith({
      ok: false,
      counts: { clientes: 3, areas: 0, propostas: 2 },
      issues: [
        issue({ severity: 'warning', sheet: 'propostas', row: 4, column: 'Desconto' }),
        issue({ sheet: 'clientes', row: 7, column: 'Documento' }),
        issue({ sheet: null }),
      ],
      truncated: true,
    });
    expect(
      [...container.querySelectorAll('[data-import-count]')].map((e) =>
        e.getAttribute('data-import-count'),
      ),
    ).toEqual(['clientes', 'propostas']);
    const errors = container.querySelector('[data-import-issues="error"]') as Element;
    const warnings = container.querySelector('[data-import-issues="warning"]') as Element;
    expect(
      errors.compareDocumentPosition(warnings) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      [...errors.querySelectorAll('[data-import-issue-group]')].map((e) =>
        e.getAttribute('data-import-issue-group'),
      ),
    ).toEqual(['file', 'clientes']);
    expect(text()).toContain('Linha 7 · Documento');
    expect(container.querySelector('[data-import-truncated]')).not.toBeNull();
    expect(text()).not.toContain('secret_code');
  });

  it('keeps Importar disabled while the preview has errors', async () => {
    await validatedWith({
      ok: false,
      counts: { areas: 2 },
      issues: [issue({ sheet: 'areas', row: 2, column: 'Nome' })],
      truncated: false,
    });
    expect(importButton().disabled).toBe(true);
  });

  it('keeps Importar disabled for an ok preview with nothing to create', async () => {
    await validatedWith(okPreview({}));
    expect(importButton().disabled).toBe(true);
    expect(text()).toContain(IMPORT_COPY.nothingToImport);
  });

  it('enables Importar for an ok preview and commits the same file after confirming', async () => {
    api.commit.mockResolvedValue({ counts: { areas: 2 } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const file = await validatedWith(okPreview());
    expect(importButton().disabled).toBe(false);
    await click(importButton());
    expect(text()).toContain('2 registros');
    expect(api.commit).not.toHaveBeenCalled();
    await click(container.querySelector('[data-confirm-action]') as Element);
    expect(api.preview.mock.calls[0]?.[0]).toBe(file);
    expect(api.commit).toHaveBeenCalledTimes(1);
    expect(api.commit.mock.calls[0]?.[0]).toBe(file);
    const success = container.querySelector('[data-import-success]');
    expect(success?.textContent).toContain('Importação concluída');
    expect(success?.querySelector('[data-import-count="areas"]')).not.toBeNull();
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
    expect(keys).toContainEqual(['sales-ops']);
    expect(keys).toContainEqual(['leads']);
  });

  it('cancelling the confirmation commits nothing', async () => {
    await validatedWith(okPreview());
    await click(importButton());
    await click(container.querySelector('[data-confirm-cancel]') as Element);
    expect(container.querySelector('[data-confirm-action]')).toBeNull();
    expect(api.commit).not.toHaveBeenCalled();
    expect(container.querySelector('[data-import-success]')).toBeNull();
  });

  it('a new file selection discards the previous preview', async () => {
    await validatedWith(okPreview());
    expect(container.querySelector('[data-import-step="3"]')).not.toBeNull();
    await chooseFile('outra.xlsx');
    expect(container.querySelector('[data-import-step="3"]')).toBeNull();
  });

  it('renders a 403 inline with the admin copy and never ForbiddenPanel', async () => {
    api.preview.mockRejectedValue({ status: 403, error: 'forbidden' });
    await renderView();
    await chooseFile();
    await click(button(IMPORT_COPY.validate));
    expect(container.querySelector('[data-import-error]')?.textContent).toContain(
      MUTATION_ERROR_COPY.adminRequired,
    );
    expect(document.querySelector('[data-forbidden]')).toBeNull();
  });

  it('replaces the preview with the 422 body', async () => {
    api.commit.mockRejectedValue({
      status: 422,
      error: 'request_failed',
      body: {
        ok: false,
        counts: { areas: 2 },
        issues: [issue({ sheet: 'areas', row: 2, column: 'Nome' })],
        truncated: false,
      },
    });
    await validatedWith(okPreview());
    await click(importButton());
    await click(container.querySelector('[data-confirm-action]') as Element);
    expect(container.querySelector('[data-import-error]')?.textContent).toContain(
      'mudaram desde a validação',
    );
    expect(text()).toContain('Linha 2 · Nome');
    expect(importButton().disabled).toBe(true);
    expect(container.querySelector('[data-import-success]')).toBeNull();
  });

  it('renders 409 and 413 inline', async () => {
    api.commit.mockRejectedValue({ status: 409, error: 'conflict' });
    await validatedWith(okPreview());
    await click(importButton());
    await click(container.querySelector('[data-confirm-action]') as Element);
    expect(container.querySelector('[data-import-error]')?.textContent).toContain(
      'um registro foi recusado',
    );
    expect(container.querySelector('[data-import-step="3"]')).not.toBeNull();

    api.preview.mockRejectedValue({ status: 413, error: 'request_failed' });
    await click(button(IMPORT_COPY.validate));
    expect(container.querySelector('[data-import-error]')?.textContent).toContain(
      IMPORT_COPY.tooLargeLocal,
    );
  });

  it('Importar outra planilha resets the screen', async () => {
    api.commit.mockResolvedValue({ counts: { areas: 2 } });
    await validatedWith(okPreview());
    await click(importButton());
    await click(container.querySelector('[data-confirm-action]') as Element);
    await click(button(IMPORT_COPY.another));
    expect(container.querySelector('[data-import-success]')).toBeNull();
    expect(container.querySelector('[data-import-step="2"]')).not.toBeNull();
    expect(text()).toContain(IMPORT_COPY.noFile);
    expect(button(IMPORT_COPY.validate).disabled).toBe(true);
  });
});
