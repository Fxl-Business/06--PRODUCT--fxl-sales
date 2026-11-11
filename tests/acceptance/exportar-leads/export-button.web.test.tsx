// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
}));

/**
 * The contract for the web half: importApi gains `exportLeads(token)` resolving `{ blob, filename }`
 * (GET /api/v1/sales-ops/import/export/leads), and the Importação screen gets a button labelled
 * `Exportar leads`.
 */
vi.mock('../../../apps/web/src/sales-ops/import/api', () => ({
  importApi: { downloadTemplate: vi.fn(), preview: vi.fn(), commit: vi.fn(), exportLeads: vi.fn() },
}));

import { importApi } from '../../../apps/web/src/sales-ops/import/api';
import { ImportContainer } from '../../../apps/web/src/sales-ops/import/ImportContainer';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const api = vi.mocked(importApi) as unknown as { exportLeads: ReturnType<typeof vi.fn> };

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

async function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <ImportContainer />
      </QueryClientProvider>,
    );
  });
}

function exportButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Exportar leads');
}

describe('Importação: Exportar leads', () => {
  it('shows the button and downloads the file with the access token', async () => {
    api.exportLeads.mockResolvedValue({ blob: new Blob(['x']), filename: 'leads.xlsx' });
    await renderView();
    const button = exportButton();
    expect(button).toBeDefined();
    await act(async () => {
      button!.click();
    });
    expect(api.exportLeads).toHaveBeenCalledTimes(1);
    expect(api.exportLeads.mock.calls[0]![0]).toBe('test-token');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shows the server warning (409 message) instead of downloading', async () => {
    api.exportLeads.mockRejectedValue({
      error: 'export_too_large',
      status: 409,
      message: 'A exportação passa do limite de linhas da importação.',
    });
    await renderView();
    await act(async () => {
      exportButton()!.click();
    });
    expect(container.textContent).toContain('A exportação passa do limite de linhas da importação.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
