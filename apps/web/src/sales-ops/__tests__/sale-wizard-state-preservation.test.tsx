// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaleWizardDialog } from '../SalesOpsApp';
import type {
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsPerson,
  SalesOpsPersonFuncao,
  SalesOpsProduct,
} from '../types';

/**
 * Funções replace the three removed `is_seller` / `is_finder` / `is_collaborator`
 * mirrors on a pessoa. `vendedor` and `finder` are the two predefined system funções;
 * `prestador` is an ordinary custom one, which is what makes a pessoa a prestador.
 */
const funcaoVendedor: SalesOpsPersonFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
};

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  ),
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const areaId = '66666666-6666-4666-8666-666666666666';

const fixedProduct: SalesOpsProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: 'org-test',
  name: 'FXL Finance',
  type: 'SaaS',
  codeSuffix: 'FIN',
  areaId,
  openPrice: false,
  setupBrl: 250000,
  hasMonthly: false,
  monthlyBrl: 0,
  recurringCommission: false,
  hasFinderCommission: false,
  sellerCommissionType: 'pct',
  sellerCommissionValue: '10',
  sellerWithFinderCommissionType: 'pct',
  sellerWithFinderCommissionValue: '7',
  finderCommissionType: 'pct',
  finderCommissionValue: '3',
  modules: [],
  providers: [],
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const zetaClient: SalesOpsClient = {
  id: '33333333-3333-4333-8333-333333333333',
  orgId: 'org-test',
  name: 'Zeta Seguros',
  contact: null,
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const alfaClient: SalesOpsClient = {
  ...zetaClient,
  id: '55555555-5555-4555-8555-555555555555',
  name: 'ACME Alfa',
};

const seller: SalesOpsPerson = {
  id: '44444444-4444-4444-8444-444444444444',
  orgId: 'org-test',
  displayName: 'Ana Martins',
  contactEmail: null,
  status: 'active',
  funcaoIds: [funcaoVendedor.id],
  funcoes: [funcaoVendedor],
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const extraSeller: SalesOpsPerson = {
  ...seller,
  id: '88888888-8888-4888-8888-888888888888',
  displayName: 'Bruno Costa',
};

function bootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [],
    products: [fixedProduct],
    clients: [zetaClient],
    funcoes: [],
    people: [seller],
    areas: [
      {
        id: areaId,
        orgId: 'org-test',
        name: 'FXL Tech',
        status: 'active',
        createdAt: '2026-07-29T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    payables: [],
    saleItems: [],
    receivables: [],
    saleProfessionals: [],
    settings: null,
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.restoreAllMocks();
});

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

function comboboxText(ariaLabel: string): string {
  return comboboxTrigger(ariaLabel).textContent?.trim() ?? '';
}

function labeledInput(label: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return match;
}

function panelSearch(): HTMLInputElement {
  const panel = container.querySelector('[role="listbox"]')?.parentElement;
  const match = panel?.querySelector('input[type="text"]');
  if (!(match instanceof HTMLInputElement)) throw new Error('panel search field not found');
  return match;
}

/**
 * Commit a cliente name that is not in the list, through the picker's create row. With
 * no `onCreateClient` wired this is the fallback path: it sets `clientName` and leaves
 * `clientId` empty, which is the wizard state this file exists to protect.
 */
async function typeCliente(name: string) {
  await click(comboboxTrigger('Cliente'));
  await changeInput(panelSearch(), name);
  const row = container.querySelector('[data-combobox-create="true"]');
  if (!(row instanceof HTMLElement)) throw new Error('create row not found');
  await click(row);
}

async function renderWizard(snapshot: SalesOpsBootstrap) {
  await act(async () => {
    root.render(
      <SaleWizardDialog
        bootstrap={snapshot}
        editSale={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        open
        saving={false}
      />,
    );
  });
}

describe('sale wizard state preservation across bootstrap refetches', () => {
  it('keeps typed wizard state when a bootstrap refetch changes the first cliente', async () => {
    await renderWizard(bootstrap());
    expect(comboboxText('Cliente')).toBe('Zeta Seguros');

    await typeCliente('Cliente Digitado');
    await changeInput(labeledInput('Valor unitário do item 1'), '4321');
    expect(comboboxText('Cliente')).toBe('Cliente Digitado');
    expect(labeledInput('Valor unitário do item 1').value).toBe('4321');

    await renderWizard(bootstrap({ clients: [alfaClient, zetaClient] }));

    expect(comboboxText('Cliente')).toBe('Cliente Digitado');
    expect(labeledInput('Valor unitário do item 1').value).toBe('4321');
  });

  it('keeps typed wizard state when a bootstrap refetch changes the people count', async () => {
    await renderWizard(bootstrap());

    await typeCliente('Cliente Digitado');
    await changeInput(labeledInput('Valor unitário do item 1'), '4321');
    expect(comboboxText('Cliente')).toBe('Cliente Digitado');
    expect(labeledInput('Valor unitário do item 1').value).toBe('4321');

    await renderWizard(bootstrap({ people: [seller, extraSeller] }));

    expect(comboboxText('Cliente')).toBe('Cliente Digitado');
    expect(labeledInput('Valor unitário do item 1').value).toBe('4321');
  });
});
