// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SaleWizardDialog } from '../SalesOpsApp';
import type {
  SalesOpsBootstrap,
  SalesOpsPersonFuncao,
  SalesOpsProduct,
  SalesOpsSale,
} from '../types';

/*
  Resolved through `node:path` rather than `new URL('../SalesOpsApp.tsx', import.meta.url)`:
  this file is now `@vitest-environment happy-dom` so it can render, and happy-dom's global
  `URL` resolves against the document origin instead of the module's `file:` base, which
  turned the old expression into `http://localhost:3000/...`.
*/
const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'SalesOpsApp.tsx');
const source = readFileSync(sourcePath, 'utf8');

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

const funcaoVendedor: SalesOpsPersonFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
};

const servicoId = '11111111-1111-4111-8111-111111111111';
const openPriceProductId = '22222222-2222-4222-8222-222222222222';
const fixedProductId = '33333333-3333-4333-8333-333333333333';
const clientId = '44444444-4444-4444-8444-444444444444';
const sellerId = '55555555-5555-4555-8555-555555555555';
const areaId = '66666666-6666-4666-8666-666666666666';
const saleId = '88888888-8888-4888-8888-888888888888';

function product(
  overrides: Partial<SalesOpsProduct> & { id: string; name: string },
): SalesOpsProduct {
  return {
    orgId: 'org-test',
    codeSuffix: '0',
    areaId,
    openPrice: false,
    setupBrl: 0,
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
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: null,
    ...overrides,
  };
}

const editSale: SalesOpsSale = {
  id: saleId,
  orgId: 'org-test',
  sequence: 1,
  code: 'V-0001',
  clientId,
  clientNameSnapshot: 'SegPro',
  sellerPersonId: sellerId,
  sellerNameSnapshot: 'Ana Martins',
  finderPersonId: null,
  finderNameSnapshot: null,
  status: 'open',
  paymentMethod: 'pix',
  condition: 'cash',
  installments: 1,
  baseDate: '2026-07-10',
  notes: '',
  wonAt: null,
  lostAt: null,
  totalBrl: 400000,
  recurringBrl: 0,
  sellerCommissionPct: '10',
  finderCommissionPct: '0',
  taxPct: '6',
  otherCostsBrl: 0,
  professionalCostsBrl: 0,
  sellerCommissionBrl: 40000,
  finderCommissionBrl: 0,
  taxBrl: 24000,
  netMarginBrl: 336000,
  netMarginPct: '84.0',
  createdAt: '2026-07-10T12:00:00.000Z',
  updatedAt: null,
};

/** The stored description that the edit path must reopen without a click. */
const storedServicoDescription = 'Escopo mensal acordado';

function bootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [editSale],
    products: [
      // First in the list, so `firstProduct` seeds item 1 with the serviço, whose
      // description is the ONE optional regime.
      product({ id: servicoId, name: 'Consultoria FXL', kind: 'service', openPrice: true }),
      product({ id: openPriceProductId, name: 'FXL Custom', kind: 'product', openPrice: true }),
      product({ id: fixedProductId, name: 'FXL Finance', kind: 'product', setupBrl: 250000 }),
    ],
    clients: [
      {
        id: clientId,
        orgId: 'org-test',
        name: 'SegPro',
        contact: null,
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    funcoes: [],
    people: [
      {
        id: sellerId,
        orgId: 'org-test',
        displayName: 'Ana Martins',
        contactEmail: null,
        status: 'active',
        funcaoIds: [funcaoVendedor.id],
        funcoes: [funcaoVendedor],
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    areas: [
      {
        id: areaId,
        orgId: 'org-test',
        name: 'FXL Tech',
        status: 'active',
        createdAt: '2026-07-14T12:00:00.000Z',
        updatedAt: null,
      },
    ],
    payables: [],
    saleItems: [
      {
        id: 'item-1',
        saleId,
        productId: servicoId,
        productNameSnapshot: storedServicoDescription,
        productTypeSnapshot: '',
        quantity: 1,
        unitBrl: 400000,
        subtotalBrl: 400000,
      },
    ],
    receivables: [
      {
        id: 'rec-1',
        saleId,
        label: '1/1',
        dueDate: '2026-07-10',
        amountBrl: 400000,
        method: 'pix',
        status: 'open',
      },
    ],
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
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: null,
    },
    ...patch,
  };
}

let container: HTMLDivElement;
let root: Root | null = null;

async function renderWizard(sale: SalesOpsSale | null) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <SaleWizardDialog
        bootstrap={bootstrap()}
        editSale={sale}
        onClose={vi.fn()}
        onSave={vi.fn()}
        open
        saving={false}
      />,
    );
  });
}

afterEach(async () => {
  if (root) {
    const mounted = root;
    root = null;
    await act(async () => mounted.unmount());
    container.remove();
  }
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.restoreAllMocks();
});

function buttonExists(label: string): boolean {
  return [...container.querySelectorAll('button')].some(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function labeledInput(label: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return match;
}

function optionalInput(label: string): HTMLInputElement | null {
  return container.querySelector(`input[aria-label="${label}"]`);
}

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const revealLabel = '+ Adicionar descrição';

describe('sale wizard UI contract', () => {
  it('keeps the proposal dialog aligned with the Nova proposta wizard shell', () => {
    expect(source).toContain('Nova proposta');
    expect(source).toContain('Editar proposta');
    expect(source).toContain(
      'Cliente, itens, pagamento e custos - salve como rascunho a qualquer momento',
    );
    expect(source).toContain("label: 'Proposta'");
    expect(source).toContain("label: 'Pagamento'");
    expect(source).toContain('Custos e margem');
    expect(source).toContain('Revisão');
    expect(source).toContain('Essa proposta teve um finder');
    expect(source).toContain('Cadastrar produto');
    expect(source).toContain('+ item avulso');
    expect(source).toContain('Adicionar descrição');
    expect(source).toContain('Plano de pagamento');
    /*
      Only strings this file is the sole home of are pinned here. The declarative
      header's own labels (`Tipo de entrada`, `Parcelas restantes`, `Número de ciclos`,
      `Deixe em branco para prazo indeterminado`) are shared verbatim with the produto
      cadastro's default-plan editor further up this same file, so a substring
      assertion on them would pass even if step 2 lost them entirely. Those are pinned
      by DOM queries in `sale-wizard-payment-plan.test.tsx` instead, where they can
      actually fail.
    */
    expect(source).toContain('Parcelas a receber');
    expect(source).toContain('Plano ajustado manualmente');
    expect(source).toContain('Regerar plano');
    expect(source).toContain('Manter parcelas');
    expect(source).toContain('A soma das parcelas precisa ser igual ao total da proposta.');
    expect(source).toContain('por prazo indeterminado');
    expect(source).toContain('Previsão de contas a pagar');
    /*
      Overrides. `Alterado manualmente` and `Restaurar padrão` are the visible
      contract that a cadastro number is a default the operator may take over;
      `Custos profissionais` and `Outros custos` are the Revisão breakdown that
      replaced the single opaque `Custos + imposto` line.
    */
    expect(source).toContain('Alterado manualmente');
    expect(source).toContain('Restaurar padrão');
    expect(source).toContain('Custos profissionais');
    expect(source).toContain('Selecione a função de cada profissional alocado.');
    /*
      `CUSTO ALOCADO` takes `%` or `R$`. These labels are distinct from the produto
      dialog's `Custo da função ${index + 1} em porcentagem` further up this same
      file, so they can only pass if the wizard's own toggle is really there.
    */
    expect(source).toContain('Custo do profissional ${index + 1} em porcentagem');
    expect(source).toContain('Custo do profissional ${index + 1} em reais');
    expect(source).toContain('Nenhum item de produto na proposta');
    expect(source).not.toContain('Custos + imposto');
    // The two free-text escape hatches Profissionais alocados used to carry.
    expect(source).not.toContain('Digite manualmente');
    expect(source).not.toContain("role: 'Operacional'");
    expect(source).toContain('Passo {wizardStep} de 4');
    expect(source).toContain('Avançar');
    expect(source).toContain('Salvar proposta');
    expect(source).toContain('Salvar rascunho');
    expect(source).not.toContain('Fechamento da venda');
    expect(source).not.toContain('Nova venda');
    expect(source).not.toContain('Salvar incompleto');
    expect(source).not.toContain('Confirmar venda');
    expect(source).not.toContain('Passo {wizardStep} de 3');
    expect(source).not.toContain('Salvar venda');
    /*
      The manual plan controls the declarative builder replaced. Each of these was a
      real string in this file before the builder landed, so every negative below is
      about markup that was removed rather than markup that never existed - the
      positive assertions above are the matching control.
    */
    expect(source).not.toContain('Dividir em');
    expect(source).not.toContain('+ parcela');
    expect(source).not.toContain('Adicionar recorrência');
    expect(source).not.toContain('Número de parcelas');
    expect(source).not.toContain('Remover parcela');
    /*
      The `Prazo indeterminado` checkbox is gone, blank ciclos being the only
      expression of it, so the error copy that pointed at the checkbox is gone too.
      The checkbox's own absence from step 2 is asserted in the DOM by
      `sale-wizard-payment-plan.test.tsx`, because the green summary keeps the phrase
      `, por prazo indeterminado` and a substring negative here would fail on it.
    */
    expect(source).not.toContain('marque prazo indeterminado');
  });

  it('keeps the step-2 payment plan header on one grid with no right-flown derived lines', () => {
    /*
      Both negatives below were real strings in this file before the alignment fix, so
      each is about markup that was removed rather than markup that never existed. The
      structural claim itself is asserted in the DOM by `sale-wizard-payment-plan.test.tsx`,
      where it can actually fail.
    */
    // The two-column header grid that put `Recorrência` on its own row underneath.
    expect(source).not.toContain('md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]');
    // The derived lines pinned to their grid column's right edge.
    expect(source).not.toContain('sales-ops-num text-right text-[12.5px] font-bold');
    // Positive control: the derived lines still exist, just left-aligned.
    expect(source).toContain('sales-ops-num text-[12.5px] font-bold');
    expect(source).toContain('entrada cobre o total');
  });

  it('keeps the wizard shell free of a hand-computed body height', () => {
    // Positive control: the flex-column shell really is there, so the negative below
    // is about a constant that was removed rather than one that never existed.
    expect(source).toContain(
      'flex h-[92vh] max-h-[92vh] w-[calc(100vw-48px)] max-w-[940px] flex-col',
    );
    expect(source).toContain('min-h-0 flex-1 overflow-y-auto px-[26px] py-6');
    // A `calc()` against the viewport HEIGHT is always a guess about chrome height.
    expect(source).not.toContain('calc(92vh-');
    expect(source).not.toContain('vh-210px');
  });

  it('keeps every picker on the Combobox with no native picker markup left behind', () => {
    // Positive control: the pickers really are Comboboxes, so the negatives below are
    // about a migration that happened rather than about markup that never existed.
    expect(source).toContain("from '@/components/ui/combobox'");
    expect(source).toContain('<Combobox');

    expect(source).not.toContain('<select');
    expect(source).not.toContain('<option');
    expect(source).not.toContain('<datalist');
    // The only way to reach a datalist is an `Input list=` attribute, so ban that too.
    expect(source).not.toContain('list="');
    expect(source).not.toContain('NativeSelect');

    /*
      The wizard's FUNÇÃO NO PROJETO picker offers inline create like every other
      sales-ops picker. The create ROW is asserted in the DOM by
      sale-wizard-funcao-costs.test.tsx; what is pinned here is the wiring, because a
      substring test cannot see a rendered row.
      Two occurrences: PersonDialog and SaleWizardDialog. A count rather than
      `toContain`, which would still pass if the wizard's line were deleted.
    */
    expect(source).toContain('createFuncaoForProfessional');
    expect(source.match(/onCreateFuncao=\{createFuncaoByName\}/g)).toHaveLength(2);
  });

  /**
   * The affordance may only ever hide a field that is genuinely optional, which is
   * the Serviço row and nothing else. A free row and an open-price non-Serviço row
   * both REQUIRE the description, so hiding either would move a blocking rule out of
   * sight; the edit path must reopen a stored description with no click at all.
   */
  it('renders the description as an opt-in affordance only where it is optional', async () => {
    await renderWizard(null);

    // Item 1 is the Serviço: the field is optional, so it starts collapsed.
    expect(optionalInput('Nome / descrição do item 1')).toBeNull();
    expect(buttonByText(revealLabel)).toBeInstanceOf(HTMLButtonElement);
    // The one geometry claim a class-only runner can honestly make: the numeric
    // inputs are the same 44px as the `formSelectClass` picker beside them.
    expect(labeledInput('Quantidade do item 1').className).toContain('h-11');
    expect(labeledInput('Quantidade do item 1').className).not.toContain('h-10');

    await click(buttonByText(revealLabel));
    const description = labeledInput('Nome / descrição do item 1');
    expect(document.activeElement).toBe(description);
    expect(buttonExists(revealLabel)).toBe(false);

    // Never vanish from under the caret: clearing the text keeps the field mounted.
    await changeInput(description, 'Escopo mensal');
    await changeInput(labeledInput('Nome / descrição do item 1'), '');
    expect(optionalInput('Nome / descrição do item 1')).toBeInstanceOf(HTMLInputElement);
    expect(buttonExists(revealLabel)).toBe(false);

    // An open-price produto that is not a Serviço REQUIRES the description.
    await pickOption('Produto / serviço do item 1', 'FXL Custom');
    expect(optionalInput('Nome / descrição do item 1')).toBeInstanceOf(HTMLInputElement);
    expect(buttonExists(revealLabel)).toBe(false);

    // A free row's description is required too, and arrives already open.
    await click(buttonByText('+ item avulso'));
    expect(optionalInput('Descrição do item 2')).toBeInstanceOf(HTMLInputElement);
    expect(buttonExists(revealLabel)).toBe(false);

    // A fixed-price produto has no description field and no affordance for one.
    await pickOption('Produto / serviço do item 1', 'FXL Finance');
    expect(optionalInput('Nome / descrição do item 1')).toBeNull();
    expect(buttonExists(revealLabel)).toBe(false);
  });

  /**
   * First-run explanatory copy moved behind an `InfoHint`; live UI did not move.
   * Every negative below quotes a string that was really in this file before the
   * move, so none of them can pass vacuously.
   */
  it('keeps first-run explanatory copy behind an info hint and live UI inline', () => {
    // Positive control: the tips still exist as copy - they moved, they were not deleted.
    expect(source).toContain('InfoHint');
    expect(source).toContain(
      'Aloque os profissionais do projeto e ajuste os percentuais - a margem líquida e as comissões são calculadas em tempo real.',
    );
    expect(source).toContain(
      'Esta é uma previsão - nada é lançado no financeiro até a proposta ser marcada como Ganha.',
    );
    /*
      Tip A's copy is soft-wrapped in the JSX, so it is pinned by the sentence's
      contiguous head here and by a DOM assertion on the whole sentence in
      `product-service-dialog.test.tsx`.
    */
    expect(source).toContain('Tudo aqui é padrão: dentro da proposta você pode alterar qualquer');
    // Three tips moved, and only three: produto title, step 3, step 4.
    expect(source.match(/<InfoHint /g)).toHaveLength(3);
    // ...but no longer inside a standalone amber banner div.
    expect(source).not.toContain(
      'className="rounded-[11px] border border-[#f0dfae] bg-[#fdf0cf] px-[14px] py-[11px] text-[13px] text-[#57575f]"',
    );
    // The per-item helper lines lost the warning skin but not a single character of copy.
    expect(source).toContain('Item avulso - informe a área, a descrição e o valor');
    expect(source).not.toContain('<AlertTriangle className="h-[13px] w-[13px]" />');
    expect(source).not.toContain('AlertTriangle');
    // Untouchable: the action-required bar and the state indicators.
    expect(source).toContain('Você ajustou as parcelas manualmente. Aplicar');
    expect(source).toContain('Manter parcelas');
    expect(source).toContain('Alterado manualmente');
    expect(source).toContain('Definido na venda');
    expect(source).toContain('Sem área');
    // The planDirty bar keeps its own amber skin, byte for byte.
    expect(source).toContain(
      'rounded-[10px] border border-[#f0dfae] bg-[#fdf0cf] px-3 py-2 text-[12.5px] font-semibold text-[#9c7210]',
    );
  });

  it('opens the stored description on the edit path with no click', async () => {
    await renderWizard(editSale);

    expect(labeledInput('Nome / descrição do item 1').value).toBe(storedServicoDescription);
    expect(buttonExists(revealLabel)).toBe(false);
  });
});
