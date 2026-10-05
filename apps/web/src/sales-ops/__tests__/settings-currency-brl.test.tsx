// @vitest-environment happy-dom

/**
 * The settings currency is locked to BRL (PC23 companion): no picker, no USD, a
 * read-only `Real (BRL)`, and every save sends `BRL` even over a legacy row.
 */
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsSettings } from '../types';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
}));

import { SettingsView } from '../SalesOpsApp';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const legacySettings: SalesOpsSettings = {
  orgId: 'org-a',
  legalName: 'FXL Consultoria',
  document: '00.000.000/0001-00',
  phone: '',
  financeEmail: '',
  defaultSellerCommissionPct: '10',
  defaultFinderCommissionPct: '3',
  defaultTaxPct: '6',
  currency: 'USD',
  taxRegime: 'Simples Nacional',
  periodClosingDay: 1,
  tableDensity: 'comfortable',
  dateFormat: 'dd/mm/aaaa',
  language: 'pt-BR',
  commissionOnRecurring: true,
  sellerCanBeFinder: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function renderSettings(onSave = vi.fn()) {
  await act(async () =>
    root.render(<SettingsView isSaving={false} onSave={onSave} settings={legacySettings} />),
  );
  return onSave;
}

describe('Configurações currency', () => {
  it('offers no USD currency option', async () => {
    await renderSettings();

    const text = container.textContent ?? '';
    expect(text).toContain('Real (BRL)');
    expect(text).not.toContain('USD');
    expect(text).not.toContain('Dólar');
    expect(container.querySelector('[aria-label="Moeda"]')).toBeNull();
  });

  it('shows the currency read-only', async () => {
    await renderSettings();

    const field = container.querySelector('[data-settings-currency]');
    expect(field?.textContent).toBe('Real (BRL)');
    expect(field?.getAttribute('aria-readonly')).toBe('true');
  });

  it('saves BRL even when the stored currency is a legacy USD', async () => {
    const onSave = await renderSettings();

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.trim() === 'Salvar alterações',
    );
    expect(button).toBeDefined();
    await act(async () => button?.click());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ currency: 'BRL' }));
  });
});
