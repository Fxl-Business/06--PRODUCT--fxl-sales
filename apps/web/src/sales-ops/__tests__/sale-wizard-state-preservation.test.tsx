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
  SalesOpsProduct,
} from '../types';

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
  isSeller: true,
  isFinder: false,
  isCollaborator: false,
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

function clientInput(): HTMLInputElement {
  const match = container.querySelector(
    'input[placeholder="Buscar ou digitar um novo cliente..."]',
  );
  if (!(match instanceof HTMLInputElement)) throw new Error('cliente input not found');
  return match;
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
    expect(clientInput().value).toBe('Zeta Seguros');

    await changeInput(clientInput(), 'Cliente Digitado');
    expect(clientInput().value).toBe('Cliente Digitado');

    await renderWizard(bootstrap({ clients: [alfaClient, zetaClient] }));

    expect(clientInput().value).toBe('Cliente Digitado');
  });

  it('keeps typed wizard state when a bootstrap refetch changes the people count', async () => {
    await renderWizard(bootstrap());

    await changeInput(clientInput(), 'Cliente Digitado');
    expect(clientInput().value).toBe('Cliente Digitado');

    await renderWizard(bootstrap({ people: [seller, extraSeller] }));

    expect(clientInput().value).toBe('Cliente Digitado');
  });
});
