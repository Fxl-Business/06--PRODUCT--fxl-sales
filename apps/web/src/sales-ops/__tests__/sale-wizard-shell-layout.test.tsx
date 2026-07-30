// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaleWizardDialog } from '../SalesOpsApp';
import type { SalesOpsBootstrap, SalesOpsPersonFuncao, SalesOpsProduct } from '../types';

/**
 * The wizard shell is a layout contract, not a copy contract: the honest claim is
 * "these classes sit on THESE four elements", which only a DOM render can prove.
 * The dialog mock passes `className` straight through to a plain `div`, so the shell
 * and its four children are inspectable exactly as the component wrote them.
 */
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

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const areaId = '66666666-6666-4666-8666-666666666666';

const funcaoVendedor: SalesOpsPersonFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
};

const product: SalesOpsProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: 'org-test',
  name: 'FXL Finance',
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

const bootstrap: SalesOpsBootstrap = {
  sales: [],
  products: [product],
  clients: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      orgId: 'org-test',
      name: 'SegPro',
      contact: null,
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: null,
    },
  ],
  funcoes: [],
  people: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      orgId: 'org-test',
      displayName: 'Ana Martins',
      contactEmail: null,
      status: 'active',
      funcaoIds: [funcaoVendedor.id],
      funcoes: [funcaoVendedor],
      createdAt: '2026-07-29T12:00:00.000Z',
      updatedAt: null,
    },
  ],
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
  productFuncaoCosts: [],
  saleProfessionals: [],
  settings: {
    orgId: 'org-test',
    legalName: '',
    document: '',
    phone: '',
    financeEmail: '',
    defaultSellerCommissionPct: '10',
    defaultFinderCommissionPct: '3',
    defaultTaxPct: '6',
    currency: 'BRL',
    taxRegime: 'Simples Nacional',
    periodClosingDay: 1,
    tableDensity: 'comfortable',
    dateFormat: 'dd/mm/aaaa',
    language: 'pt-BR',
    commissionOnRecurring: true,
    sellerCanBeFinder: true,
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: null,
  },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SaleWizardDialog
        bootstrap={bootstrap}
        editSale={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
        open
        saving={false}
      />,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.restoreAllMocks();
});

/** The shell's four blocks in source order: header, stepper, scroll body, footer. */
function shellChild(shell: Element, index: number): HTMLElement {
  const child = shell.children.item(index);
  if (!(child instanceof HTMLElement)) throw new Error(`shell child ${index} not found`);
  return child;
}

describe('sale wizard shell layout', () => {
  it('pins the wizard shell to a flex column so the footer can never be clipped', () => {
    const shell = container.querySelector('div[class*="max-w-[940px]"]');
    if (!(shell instanceof HTMLElement)) throw new Error('wizard shell not found');
    const [header, stepper, body, footer] = [0, 1, 2, 3].map((index) =>
      shellChild(shell, index),
    ) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];

    // positive controls: prove we grabbed the right four nodes before asserting on them
    expect(header.textContent).toContain('Nova proposta');
    expect(stepper.textContent).toContain('Pagamento');
    expect(body.textContent).toContain('Cliente e responsáveis');
    expect(footer.textContent).toContain('Salvar rascunho');
    expect(footer.textContent).toContain('Avançar');

    // the shell is a flex column with a real height
    for (const token of ['flex', 'flex-col', 'h-[92vh]', 'overflow-hidden', 'gap-0']) {
      expect(shell.className.split(' ')).toContain(token);
    }
    // preserved identity
    for (const token of [
      'max-w-[940px]',
      'rounded-[22px]',
      'sm:rounded-[22px]',
      'bg-[#f4f4f6]',
      'p-0',
    ]) {
      expect(shell.className.split(' ')).toContain(token);
    }
    expect(shell.className).toContain('[&>button]:right-[26px]');

    // only the body scrolls, and it absorbs all the free space
    for (const token of ['min-h-0', 'flex-1', 'overflow-y-auto']) {
      expect(body.className.split(' ')).toContain(token);
    }
    expect(body.className).not.toContain('max-h-');

    // chrome never shrinks
    expect(header.className.split(' ')).toContain('shrink-0');
    expect(stepper.className.split(' ')).toContain('shrink-0');
    expect(footer.className.split(' ')).toContain('shrink-0');
    expect(footer.className).not.toContain('absolute');
  });
});
