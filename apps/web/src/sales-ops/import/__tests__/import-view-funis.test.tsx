// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
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
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

vi.mock('../api', () => ({
  importApi: { downloadTemplate: vi.fn(), preview: vi.fn(), commit: vi.fn(), exportLeads: vi.fn() },
}));

import { importApi } from '../api';
import { IMPORT_COPY } from '../import-copy';
import { ImportContainer } from '../ImportContainer';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const api = vi.mocked(importApi);

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.clearAllMocks();
});

const click = (el: Element | undefined | null) =>
  act(async () => {
    (el as HTMLElement).click();
  });
const importButton = () => container.querySelector('[data-import-commit]') as HTMLButtonElement;
const trigger = (label: string) =>
  container.querySelector(`[role="combobox"][aria-label="${label}"]`) as HTMLElement;
const revalidate = () => container.querySelector('[data-import-revalidate]') as HTMLButtonElement;

async function pick(label: string, option: string) {
  await click(trigger(label));
  await click([...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === option));
}

const PIPELINE_TARGETS = [
  { id: 'p-vendas', name: 'Vendas', isDefault: true },
  { id: 'p-pos', name: 'Pós-venda', isDefault: false },
];
const STAGE_TARGETS = [
  { id: 's-novo', name: 'Novo', kind: 'normal', pipelineId: 'p-vendas' },
  { id: 's-ativo', name: 'Ativo', kind: 'normal', pipelineId: 'p-pos' },
];
const row = (funil: string | null, name: string, stageId?: string) => ({
  funil,
  name,
  leads: 2,
  resolution: stageId ? { kind: 'existing', stageId } : { kind: 'not_found' },
});
const preview = (over: Record<string, unknown>) => ({
  ok: true,
  counts: { leads: 4 },
  issues: [],
  truncated: false,
  pipelineTargets: PIPELINE_TARGETS,
  stageTargets: STAGE_TARGETS,
  ...over,
});

async function validatedWith(body: unknown) {
  api.preview.mockResolvedValue(body as never);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ImportContainer />
      </QueryClientProvider>,
    );
  });
  const input = container.querySelector('[data-import-file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array(10)], 'p.xlsx')], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click([...container.querySelectorAll('button')].find((b) => b.textContent?.includes(IMPORT_COPY.validate)));
}

const lastSent = () => api.preview.mock.calls.at(-1)!.slice(2) as [unknown, unknown];

describe('Mapear funis', () => {
  it('is hidden when every sheet funil exists and the org has one funil', async () => {
    await validatedWith(
      preview({
        pipelineTargets: [PIPELINE_TARGETS[0]],
        leadPipelines: [{ name: 'Vendas', leads: 4, resolution: { kind: 'existing', pipelineId: 'p-vendas' } }],
        leadStages: [row('Vendas', 'Novo', 's-novo')],
      }),
    );
    expect(container.querySelector('[data-import-map-pipelines]')).toBeNull();
    expect(importButton().disabled).toBe(false);
  });

  it('lists a missing funil, blocks Importar and sends the destination on revalidation', async () => {
    await validatedWith(
      preview({
        ok: false,
        leadPipelines: [{ name: 'Suporte', leads: 4, resolution: { kind: 'not_found' } }],
        leadStages: [],
      }),
    );
    expect(container.querySelector('[data-import-map-pipelines]')).not.toBeNull();
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[data-map-pipeline-row="Suporte"]')).not.toBeNull();
    expect(revalidate()).not.toBeNull();
    await pick('Funil de destino: Suporte', 'Pós-venda');
    api.preview.mockResolvedValue(preview({
      leadPipelines: [{ name: 'Suporte', leads: 4, resolution: { kind: 'not_found' } }],
      leadStages: [row('Suporte', 'Ativo', 's-ativo')],
    }) as never);
    await click(revalidate());
    expect(lastSent()[1]).toEqual({ Suporte: { pipelineId: 'p-pos' } });
    expect(importButton().disabled).toBe(false);
  });

  it('sends no pipelineId while a funil that exists keeps its destination', async () => {
    const body = preview({
      leadPipelines: [{ name: 'Vendas', leads: 4, resolution: { kind: 'existing', pipelineId: 'p-vendas' } }],
      leadStages: [row('Vendas', 'Novo', 's-novo')],
    });
    await validatedWith(body);
    await click(revalidate());
    expect(lastSent()[1]).toEqual({ Vendas: { stages: { Novo: { stageId: 's-novo' } } } });
  });

  it('changing the destination drops that funil etapa choices, hides its rows and blocks Importar until revalidated', async () => {
    const body = preview({
      leadPipelines: [
        { name: 'Vendas', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-vendas' } },
        { name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } },
      ],
      leadStages: [row('Vendas', 'Novo', 's-novo'), row('Suporte', 'Ativo', 's-ativo')],
    });
    await validatedWith(body);
    expect(container.querySelectorAll('[data-map-stage-row]')).toHaveLength(2);
    await pick('Funil de destino: Suporte', 'Vendas');
    expect(container.querySelector('[data-map-stage-funil="Suporte"]')).toBeNull();
    expect(container.querySelector('[data-map-stage-funil="Vendas"]')).not.toBeNull();
    expect(importButton().disabled).toBe(true);
    await pick('Funil de destino: Suporte', 'Pós-venda');
    // back to the original destination: still stale and still hidden until revalidated
    expect(container.querySelector('[data-map-stage-funil="Suporte"]')).toBeNull();
    expect(importButton().disabled).toBe(true);
    await click(revalidate());
    expect(container.querySelector('[data-map-stage-funil="Suporte"]')).not.toBeNull();
    expect(importButton().disabled).toBe(false);
  });

  it('keeps two sheet funis with the same etapa name as independent choices with unique labels', async () => {
    await validatedWith(
      preview({
        ok: false,
        leadPipelines: [
          { name: 'Vendas', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-vendas' } },
          { name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } },
        ],
        leadStages: [row('Vendas', 'Contato'), row('Suporte', 'Contato')],
      }),
    );
    const labels = [...container.querySelectorAll('[role="combobox"]')].map((e) => e.getAttribute('aria-label'));
    expect(new Set(labels).size).toBe(labels.length);
    await pick('Vai para: Vendas - Contato', 'Novo');
    await pick('Vai para: Suporte - Contato', 'Criar etapa com este nome');
    expect(container.querySelectorAll('[data-map-stage-funil-heading]')).toHaveLength(2);
    await click(revalidate());
    expect(lastSent()[1]).toEqual({
      Vendas: { stages: { Contato: { stageId: 's-novo' } } },
      Suporte: { stages: { Contato: { create: true } } },
    });
  });

  it('scopes the etapa options to the funil destination', async () => {
    await validatedWith(
      preview({
        ok: false,
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } }],
        leadStages: [row('Suporte', 'Contato')],
      }),
    );
    await click(trigger('Vai para: Suporte - Contato'));
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim());
    expect(options).toContain('Ativo');
    expect(options).not.toContain('Novo');
  });

  it('keeps the four summaries on screen after a 422 on commit', async () => {
    await validatedWith(
      preview({
        leadPipelines: [{ name: 'Vendas', leads: 4, resolution: { kind: 'existing', pipelineId: 'p-vendas' } }],
        leadStages: [row('Vendas', 'Novo', 's-novo')],
      }),
    );
    api.commit.mockRejectedValue({
      status: 422,
      body: { ok: false, counts: { leads: 4 }, issues: [], truncated: false },
    });
    await click(importButton());
    await click(container.querySelector('[data-confirm-action]'));
    expect(container.querySelector('[data-map-stage-row]')).not.toBeNull();
    expect(container.querySelector('[data-map-pipeline-row]')).not.toBeNull();
    expect(trigger('Vai para: Vendas - Novo')).not.toBeNull();
  });

  it('reads an older API without the funil keys as before', async () => {
    await validatedWith({
      ok: true,
      counts: { leads: 1 },
      issues: [],
      truncated: false,
      leadStages: [{ name: 'Novo', leads: 1, resolution: { kind: 'existing', stageId: 's-novo' } }],
      stageTargets: [{ id: 's-novo', name: 'Novo', kind: 'normal' }],
    });
    expect(container.querySelector('[data-import-map-pipelines]')).toBeNull();
    expect(container.querySelector('[data-map-stage-funil-heading]')).toBeNull();
    expect(importButton().disabled).toBe(false);
  });

  it('keeps Importar disabled when a sheet funil has no destination, even with ok:true', async () => {
    await validatedWith(
      preview({
        leadPipelines: [{ name: 'Suporte', leads: 4, resolution: { kind: 'not_found' } }],
        leadStages: [],
      }),
    );
    expect(importButton().disabled).toBe(true);
  });

  it('after switching a funil away, the next validation carries no stages for it and shows no rows meanwhile', async () => {
    await validatedWith(
      preview({
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } }],
        leadStages: [row('Suporte', 'Ativo', 's-ativo')],
      }),
    );
    await pick('Funil de destino: Suporte', 'Vendas');
    expect(container.querySelector('[data-map-stage-row]')).toBeNull();
    api.preview.mockResolvedValue(
      preview({
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } }],
        leadStages: [row('Suporte', 'Ativo')],
      }) as never,
    );
    await click(revalidate());
    expect(lastSent()[1]).toEqual({ Suporte: { pipelineId: 'p-vendas' } });
  });

  it('switching a funil away and back leaves its etapas blank and Importar disabled', async () => {
    await validatedWith(
      preview({
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } }],
        leadStages: [row('Suporte', 'Ativo', 's-ativo')],
      }),
    );
    await pick('Funil de destino: Suporte', 'Vendas');
    await pick('Funil de destino: Suporte', 'Pós-venda');
    expect(importButton().disabled).toBe(true);
    expect(container.querySelector('[data-map-stage-row]')).toBeNull();
    api.preview.mockResolvedValue(
      preview({
        ok: false,
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } }],
        leadStages: [row('Suporte', 'Contato')],
      }) as never,
    );
    await click(revalidate());
    expect(container.querySelector('[data-map-stage-row="Contato"]')).not.toBeNull();
    expect(trigger('Vai para: Suporte - Contato').hasAttribute('data-placeholder')).toBe(true);
    expect(importButton().disabled).toBe(true);
  });

  it('switching away and back keeps Importar disabled even when the maps end up identical (etapas the Etapas tab creates)', async () => {
    await validatedWith(
      preview({
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } }],
        leadStages: [{ funil: 'Suporte', name: 'Ativo', leads: 2, resolution: { kind: 'existing', stageId: null } }],
      }),
    );
    expect(importButton().disabled).toBe(false);
    await pick('Funil de destino: Suporte', 'Vendas');
    await pick('Funil de destino: Suporte', 'Pós-venda');
    expect(container.querySelector('[data-map-stage-row]')).toBeNull();
    expect(importButton().disabled).toBe(true);
  });

  it('commit sends both maps', async () => {
    await validatedWith(
      preview({
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'not_found' } }],
        leadStages: [],
      }),
    );
    await pick('Funil de destino: Suporte', 'Pós-venda');
    api.preview.mockResolvedValue(
      preview({
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'not_found' } }],
        leadStages: [row('Suporte', 'Ativo', 's-ativo')],
      }) as never,
    );
    await click(revalidate());
    api.commit.mockResolvedValue({ counts: { leads: 2 } } as never);
    await click(importButton());
    await click(container.querySelector('[data-confirm-action]'));
    expect(api.commit.mock.calls[0]!.slice(2)).toEqual([
      {},
      { Suporte: { pipelineId: 'p-pos', stages: { Ativo: { stageId: 's-ativo' } } } },
    ]);
  });

  it('puts no overflow clipping wrapper between a Combobox and its step (the inline panel would be cut)', async () => {
    await validatedWith(
      preview({
        ok: false,
        leadPipelines: [{ name: 'Suporte', leads: 2, resolution: { kind: 'existing', pipelineId: 'p-pos' } }],
        leadStages: [row('Suporte', 'Contato')],
      }),
    );
    for (const sel of ['[data-import-map-pipelines]', '[data-import-map-stages]']) {
      const step = container.querySelector(sel) as HTMLElement;
      const combo = step.querySelector('[role="combobox"]') as HTMLElement;
      for (let el = combo.parentElement; el && el !== step.parentElement; el = el.parentElement) {
        expect(el.className).not.toMatch(/overflow-(hidden|auto|x-auto|y-auto|scroll|x-hidden)/);
      }
    }
  });
});
