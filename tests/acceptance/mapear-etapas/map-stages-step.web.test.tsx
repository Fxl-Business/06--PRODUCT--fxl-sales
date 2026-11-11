// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
}));

vi.mock('../../../apps/web/src/sales-ops/import/api', () => ({
  importApi: { downloadTemplate: vi.fn(), preview: vi.fn(), commit: vi.fn(), exportLeads: vi.fn() },
}));

import { importApi } from '../../../apps/web/src/sales-ops/import/api';
import { ImportContainer } from '../../../apps/web/src/sales-ops/import/ImportContainer';

/**
 * ASSUMED preview contract (the approved criteria name the data but not the keys; reconcile these two names with the
 * API contract if they differ): `leadStages: [{ name, count, resolution, stageId? }]` with resolution
 * 'existing' | 'not_found' | 'conversion', and `stageTargets: [{ id, name }]`. The re-validation must carry the
 * operator's choice as a stageMap (sheet name -> {stageId} | {create: true} | {first: true}) in an argument of
 * `importApi.preview`.
 */
const TARGETS = [
  { id: 'stage-novo', name: 'Novo' },
  { id: 'stage-qual', name: 'Qualificação' },
];
const leadRow = (name: string, count: number, resolution: string, stageId?: string) => ({ name, count, resolution, ...(stageId ? { stageId } : {}) });

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const api = vi.mocked(importApi) as unknown as { preview: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> };

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const button = (text: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().includes(text)) as HTMLButtonElement | undefined;
const click = (el: Element | undefined) =>
  act(async () => {
    (el as HTMLElement).click();
  });
const importButton = () => container.querySelector('[data-import-commit]') as HTMLButtonElement;
const triggers = () => [...container.querySelectorAll('[role="combobox"]')] as HTMLElement[];

async function validate(preview: unknown) {
  api.preview.mockResolvedValue(preview);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ImportContainer />
      </QueryClientProvider>,
    );
  });
  const input = container.querySelector('[data-import-file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(10)], 'planilha.xlsx')], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(button('Validar planilha'));
}

const notFoundIssue = {
  severity: 'error',
  sheet: 'leads',
  row: 2,
  column: 'Etapa',
  code: 'unknown_ref',
  message: 'Não encontramos a etapa "Contato".',
};

describe('Mapear etapas step', () => {
  it('does not show the step when the Leads tab has no etapas', async () => {
    await validate({ ok: true, counts: { areas: 1 }, issues: [], truncated: false, leadStages: [], stageTargets: TARGETS });
    expect(container.textContent).not.toContain('Mapear etapas');
    expect(triggers()).toHaveLength(0);
  });

  it('shows one Combobox per sheet etapa, pre-filled when matched by name and empty when not, and blocks Importar', async () => {
    await validate({
      ok: false,
      counts: { leads: 3 },
      issues: [notFoundIssue],
      truncated: false,
      leadStages: [leadRow('Novo', 1, 'existing', 'stage-novo'), leadRow('Contato', 2, 'not_found')],
      stageTargets: TARGETS,
    });
    expect(container.textContent).toContain('Mapear etapas');
    for (const header of ['Etapa na planilha', 'Leads', 'Vai para']) expect(container.textContent).toContain(header);
    expect(container.querySelector('select')).toBeNull();
    expect(triggers()).toHaveLength(2);
    expect(triggers()[0]!.textContent).toContain('Novo');
    expect(triggers()[1]!.hasAttribute('data-placeholder')).toBe(true);
    expect(importButton().disabled).toBe(true);
  });

  it('offers the destination etapas, "Criar etapa com este nome" and "Primeira etapa"', async () => {
    await validate({
      ok: false,
      counts: { leads: 2 },
      issues: [notFoundIssue],
      truncated: false,
      leadStages: [leadRow('Contato', 2, 'not_found')],
      stageTargets: TARGETS,
    });
    await click(triggers()[0]);
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
    expect(options).toEqual(expect.arrayContaining(['Novo', 'Qualificação']));
    expect(options.some((o) => o?.includes('Criar etapa com este nome'))).toBe(true);
    expect(options.some((o) => o?.includes('Primeira etapa'))).toBe(true);
  });

  it('Validar novamente re-sends the choice as stageMap and Importar enables only with every etapa resolved and zero errors', async () => {
    await validate({
      ok: false,
      counts: { leads: 2 },
      issues: [notFoundIssue],
      truncated: false,
      leadStages: [leadRow('Contato', 2, 'not_found')],
      stageTargets: TARGETS,
    });
    expect(importButton().disabled).toBe(true);
    await click(triggers()[0]);
    await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === 'Qualificação'));
    // errors from the earlier validation are still there until it is re-run
    expect(importButton().disabled).toBe(true);

    api.preview.mockResolvedValue({
      ok: true,
      counts: { leads: 2 },
      issues: [],
      truncated: false,
      leadStages: [leadRow('Contato', 2, 'existing', 'stage-qual')],
      stageTargets: TARGETS,
    });
    await click(button('Validar novamente'));
    const call = api.preview.mock.calls.at(-1)!;
    expect(JSON.stringify(call.slice(1))).toContain('"Contato":{"stageId":"stage-qual"}');
    expect(importButton().disabled).toBe(false);
  });
});
