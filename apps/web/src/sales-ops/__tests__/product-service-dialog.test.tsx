// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SalesOpsArea,
  SalesOpsFuncao,
  SalesOpsProduct,
  SalesOpsProductFuncaoCost,
  SalesOpsProductKind,
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

import { ProductDialog } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const areaFixture: SalesOpsArea = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orgId: 'org-test',
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const product = (patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct => ({
  id: '11111111-1111-4111-8111-111111111111',
  orgId: 'org-test',
  name: 'FXL Finance',
  kind: 'product',
  codeSuffix: '7',
  areaId: areaFixture.id,
  openPrice: false,
  setupBrl: 100000,
  hasMonthly: false,
  monthlyBrl: 0,
  recurringCommission: false,
  hasFinderCommission: false,
  sellerCommissionType: 'pct',
  sellerCommissionValue: '10.00',
  sellerWithFinderCommissionType: 'pct',
  sellerWithFinderCommissionValue: '7.00',
  finderCommissionType: 'pct',
  finderCommissionValue: '3.00',
  defaultPaymentMethod: 'pix',
  defaultEntradaMode: 'none',
  defaultEntradaPct: null,
  defaultEntradaBrl: null,
  defaultRemainingInstallments: 1,
  defaultRecurringCycles: null,
  modules: [],
  providers: [],
  status: 'active',
  createdAt: '2026-07-13T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const funcao = (patch: Partial<SalesOpsFuncao> = {}): SalesOpsFuncao => ({
  id: 'ffffffff-ffff-4fff-8fff-ffffffffff01',
  orgId: 'org-test',
  name: 'Desenvolvedor',
  slug: 'desenvolvedor',
  isSystem: false,
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const devFuncao = funcao();
const testerFuncao = funcao({
  id: 'ffffffff-ffff-4fff-8fff-ffffffffff02',
  name: 'Testador',
  slug: 'testador',
});
const vendedorFuncao = funcao({
  id: 'ffffffff-ffff-4fff-8fff-ffffffffff03',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
});
const archivedFuncao = funcao({
  id: 'ffffffff-ffff-4fff-8fff-ffffffffff05',
  name: 'Redator',
  slug: 'redator',
  status: 'archived',
});

const funcaoCost = (
  patch: Partial<SalesOpsProductFuncaoCost> = {},
): SalesOpsProductFuncaoCost => ({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01',
  orgId: 'org-test',
  productId: product().id,
  funcaoId: devFuncao.id,
  mode: 'pct',
  valuePct: '5.00',
  valueBrl: null,
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

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
  vi.restoreAllMocks();
});

type RenderOptions = {
  existing?: SalesOpsProduct;
  productKind?: SalesOpsProductKind;
  funcoes?: SalesOpsFuncao[];
  funcaoCosts?: SalesOpsProductFuncaoCost[];
  /** The org's whole catalogue, i.e. the set the código suffix suggestion reads. */
  products?: SalesOpsProduct[];
  onSave?: ReturnType<typeof vi.fn>;
};

async function renderDialog(options: RenderOptions = {}) {
  const onSave = options.onSave ?? vi.fn();
  /*
    A real remount between two renders in one test. `ProductDialog`'s key is identical
    for two identical create rows, so without this the second `renderDialog()` of a test
    would silently keep the first one's form state AND its wizard step, which is never
    what a test that renders twice means.
  */
  await act(async () => root.render(null));
  await act(async () => {
    root.render(
      <ProductDialog
        areas={[areaFixture]}
        funcaoCosts={options.funcaoCosts ?? []}
        funcoes={options.funcoes ?? [devFuncao, testerFuncao]}
        modal={{
          kind: 'product',
          product: options.existing,
          productKind: options.productKind,
        }}
        onClose={vi.fn()}
        onSave={onSave}
        products={options.products ?? []}
        saving={false}
      />,
    );
  });
  return onSave;
}

function text(): string {
  return container.textContent ?? '';
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function maybeButton(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function labeledInput(label: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return match;
}

function labeledButton(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

/** The money `<Input>` inside the `<Field>` whose visible label matches. */
function moneyInput(label: string): HTMLInputElement {
  const match = [...container.querySelectorAll('input[type="number"]')].find((candidate) =>
    candidate.closest('label')?.textContent?.includes(label),
  );
  if (!(match instanceof HTMLInputElement)) throw new Error(`money input not found: ${label}`);
  return match;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

function comboboxText(ariaLabel: string): string {
  return comboboxTrigger(ariaLabel).textContent?.trim() ?? '';
}

/** Open the picker, read the labels it is offering, then close it again. */
async function comboboxOptions(ariaLabel: string): Promise<string[]> {
  await click(comboboxTrigger(ariaLabel));
  const rows = [...container.querySelectorAll('[role="option"]')].map(
    (row) => row.textContent?.trim() ?? '',
  );
  await click(comboboxTrigger(ariaLabel));
  return rows;
}

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === optionLabel,
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
}

async function chooseArea() {
  await pickOption('Área do produto', areaFixture.name);
  expect(comboboxText('Área do produto')).toBe(areaFixture.name);
}

function nameInput(): HTMLInputElement {
  const match = container.querySelector('input[placeholder="Nome"]');
  if (!(match instanceof HTMLInputElement)) throw new Error('name input not found');
  return match;
}

/**
 * Both controls step 1 gates on. Every test that reaches a later step calls this
 * FIRST: `Avançar` and the stepper are both disabled until the two are filled, so
 * navigation is impossible without it.
 */
async function fillIdentity(name = 'FXL Produto') {
  await change(nameInput(), name);
  await chooseArea();
}

const stepLabels = {
  1: 'Identificação',
  2: 'Valores',
  3: 'Pagamento',
  4: 'Comissões e custos',
} as const;

function stepButton(target: 1 | 2 | 3 | 4): HTMLButtonElement {
  const label = stepLabels[target];
  const match = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.trim().endsWith(label),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`step button not found: ${label}`);
  return match;
}

async function goToStep(target: 1 | 2 | 3 | 4) {
  await click(stepButton(target));
}

function codeSuffixInput(): HTMLInputElement {
  const match = container.querySelector('input[inputmode="numeric"]');
  if (!(match instanceof HTMLInputElement)) throw new Error('code suffix input not found');
  return match;
}

/** The `Adicionar` button of one `DialogSection`, found through its section title. */
function addButtonOf(sectionTitle: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) =>
      candidate.textContent?.trim() === 'Adicionar' &&
      candidate.closest('div.border-t')?.textContent?.includes(sectionTitle),
  );
  if (!(match instanceof HTMLButtonElement)) {
    throw new Error(`Adicionar button not found for section: ${sectionTitle}`);
  }
  return match;
}

const COSTS_SECTION = 'Custos padrão por função';

async function addModule(name: string, valueBrl: string) {
  await click(addButtonOf('Módulos'));
  const field = container.querySelector('input[placeholder="Nome do módulo"]');
  if (!(field instanceof HTMLInputElement)) throw new Error('module name input not found');
  await change(field, name);
  const row = field.closest('div.rounded-xl');
  const value = row?.querySelector('input[type="number"]');
  if (!(value instanceof HTMLInputElement)) throw new Error('module value input not found');
  await change(value, valueBrl);
}

async function addCostRow(index: number, funcaoName: string, unit: '%' | 'R$', value: string) {
  await click(addButtonOf(COSTS_SECTION));
  await pickOption(`Função do custo padrão ${index}`, funcaoName);
  await click(
    labeledButton(
      `Custo da função ${index} em ${unit === '%' ? 'porcentagem' : 'reais'}`,
    ),
  );
  await change(labeledInput(`Custo da função ${index}`), value);
}

describe('product and service dialog', () => {
  it('titles and describes the dialog from the selected kind', async () => {
    await renderDialog({ productKind: 'service' });

    expect(container.querySelector('h2')?.textContent?.trim()).toBe('Novo serviço');
    expect(text()).toContain('custos por função');

    await click(labeledButton('Classificar como produto'));
    expect(container.querySelector('h2')?.textContent?.trim()).toBe('Novo produto');
    expect(text()).toContain('Catálogo, valores e comissões padrão');
  });

  it('titles an existing record from its stored kind', async () => {
    // Distinct ids so the dialog's remount key really changes between the two renders.
    await renderDialog({
      existing: product({
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'service',
        openPrice: true,
        setupBrl: 0,
      }),
    });
    expect(container.querySelector('h2')?.textContent?.trim()).toBe('Editar serviço');

    await renderDialog({ existing: product() });
    expect(container.querySelector('h2')?.textContent?.trim()).toBe('Editar produto');
  });

  it('has no preço em aberto switch', async () => {
    await renderDialog({ productKind: 'product' });
    expect(text()).not.toContain('Preço em aberto');
    // Positive control: the control that replaced it is on screen.
    expect(labeledButton('Classificar como serviço')).toBeInstanceOf(HTMLButtonElement);

    await renderDialog({ productKind: 'service' });
    expect(text()).not.toContain('Preço em aberto');
    expect(labeledButton('Classificar como produto')).toBeInstanceOf(HTMLButtonElement);
  });

  it('sends kind and never sends openPrice', async () => {
    const onSave = await renderDialog({ productKind: 'product' });

    await fillIdentity();
    await submit();

    const payload = onSave.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ kind: 'product' });
    expect(payload).not.toHaveProperty('openPrice');
  });

  it('sends kind service when the serviço segment is active', async () => {
    const onSave = await renderDialog({ productKind: 'service' });

    await fillIdentity();
    await submit();

    const payload = onSave.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ kind: 'service', setupBrl: 0, monthlyBrl: 0 });
    expect(payload).not.toHaveProperty('openPrice');
  });

  it('renders editable base value inputs for a serviço and submits them', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(2);
    await click(labeledButton('Possui mensalidade'));

    expect(text()).toContain('Valor base (R$)');
    expect(text()).toContain('Valor da mensalidade (R$)');
    // The dashed notice and the kind-specific banner are gone: the dialog already
    // says once, at the top, that everything in it is a default.
    expect(text()).not.toContain('Definido na venda');
    expect(text()).not.toContain('Serviços têm valor variável');

    const baseInput = [...container.querySelectorAll('input[type="number"]')].find(
      (candidate) => candidate.closest('label')?.textContent?.includes('Valor base (R$)'),
    );
    if (!(baseInput instanceof HTMLInputElement)) throw new Error('base value input not found');
    await change(baseInput, '2500');
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ kind: 'service', setupBrl: 250000 });
  });

  it('keeps definido na venda as the zero state for a serviço with no base value', async () => {
    // Every Serviço that predates slice 07 stores 0, so this is what the whole
    // existing catalog opens as. `0` is the ABSENCE of a base value, and printing a
    // literal 0 in the field would state a price nobody set - the same lie the list
    // avoids by printing `Variável` instead of `R$ 0,00` for this very row.
    await renderDialog({
      existing: product({
        id: '99999999-9999-4999-8999-999999999999',
        kind: 'service',
        openPrice: true,
        setupBrl: 0,
        hasMonthly: true,
        monthlyBrl: 0,
      }),
    });
    await goToStep(2);

    const base = moneyInput('Valor base (R$)');
    expect(base.value).toBe('');
    expect(base.placeholder).toBe('Definido na venda');

    const monthly = moneyInput('Valor da mensalidade (R$)');
    expect(monthly.value).toBe('');
    expect(monthly.placeholder).toBe('Definido na venda');
  });

  it('seeds the stored base value of a serviço that has one', async () => {
    // Positive control for the case above: the blank is about the value being 0,
    // not about the kind, so a valued Serviço still opens on its own number.
    await renderDialog({
      existing: product({
        id: '99999999-9999-4999-8999-999999999998',
        kind: 'service',
        openPrice: true,
        setupBrl: 500000,
        hasMonthly: true,
        monthlyBrl: 20000,
      }),
    });
    await goToStep(2);

    expect(moneyInput('Valor base (R$)').value).toBe('5000');
    expect(moneyInput('Valor da mensalidade (R$)').value).toBe('200');
  });

  it('preserves the own value when a produto is reclassified as a serviço', async () => {
    const onSave = await renderDialog({
      existing: product({ setupBrl: 100000, hasMonthly: true, monthlyBrl: 50000 }),
    });

    await click(labeledButton('Classificar como serviço'));
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      kind: 'service',
      setupBrl: 100000,
      monthlyBrl: 50000,
    });
  });

  it('keeps the own-value inputs editable for a produto', async () => {
    const onSave = await renderDialog({ productKind: 'product' });
    await fillIdentity();
    await goToStep(2);

    const setupInput = [...container.querySelectorAll('input[type="number"]')].find(
      (candidate) => candidate.closest('label')?.textContent?.includes('Setup (R$)'),
    );
    if (!(setupInput instanceof HTMLInputElement)) throw new Error('setup input not found');
    await change(setupInput, '2500');
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ setupBrl: 250000 });
  });

  it('states that every value here is only a default', async () => {
    await renderDialog({ productKind: 'service' });
    await fillIdentity();

    await goToStep(4);
    expect(text()).toContain('Comissionamento padrão');
  });

  /**
   * The tip is first-run explanatory copy: true on every step, useless after the
   * first read, and it used to eat a full banner row at the top of step 1. It now
   * hangs off the dialog title, which is the heading that owns it, and it is only
   * ever in the layout while the operator asked for it.
   */
  it('keeps the default-values explanation behind an info hint instead of a banner', async () => {
    await renderDialog({ productKind: 'service' });

    const tip =
      'Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.';
    expect(text()).not.toContain(tip);

    const hintTriggers = [...container.querySelectorAll('button')].filter((candidate) =>
      candidate.getAttribute('aria-label')?.startsWith('Mais informações sobre'),
    );
    expect(hintTriggers).toHaveLength(1);
    expect(hintTriggers[0]!.getAttribute('aria-expanded')).toBe('false');

    await click(hintTriggers[0]!);
    expect(text()).toContain(tip);
    expect(hintTriggers[0]!.getAttribute('aria-expanded')).toBe('true');

    // A second click puts the space back.
    await click(hintTriggers[0]!);
    expect(text()).not.toContain(tip);
  });

  /**
   * Positive control for the classification rule: a Serviço's zero-state value slot
   * is a STATE INDICATOR, not a tip, so it stays inline and un-hidden.
   */
  it('leaves the definido na venda state indicator inline when the tip moves', async () => {
    await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(2);
    await click(labeledButton('Possui mensalidade'));

    expect(moneyInput('Valor base (R$)').placeholder).toBe('Definido na venda');
    expect(moneyInput('Valor da mensalidade (R$)').placeholder).toBe('Definido na venda');
  });

  it('submits the app-default plan when nothing is touched', async () => {
    const onSave = await renderDialog({ productKind: 'product' });

    await fillIdentity();
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      defaultEntradaMode: 'none',
      defaultEntradaPct: null,
      defaultEntradaBrl: null,
      defaultRemainingInstallments: 1,
      defaultPaymentMethod: 'pix',
      defaultRecurringCycles: null,
    });
  });

  it('submits a percentage entrada into defaultEntradaPct only', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    await pickOption('Tipo de entrada', '%');
    await change(labeledInput('Valor da entrada'), '50');
    await change(labeledInput('Parcelas restantes'), '3');
    await pickOption('Forma de pagamento padrão', 'Boleto');
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      defaultEntradaMode: 'pct',
      defaultEntradaPct: 50,
      defaultEntradaBrl: null,
      defaultRemainingInstallments: 3,
      defaultPaymentMethod: 'boleto',
    });
  });

  it('submits a fixed entrada into defaultEntradaBrl as integer cents', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    await pickOption('Tipo de entrada', 'R$ fixo');
    await change(labeledInput('Valor da entrada'), '1500');
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      defaultEntradaMode: 'fix',
      defaultEntradaBrl: 150000,
      defaultEntradaPct: null,
    });
  });

  it('unmounts the entrada value input when the mode is nenhuma', async () => {
    await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    await pickOption('Tipo de entrada', '%');
    // Positive control: the input exists while a value-carrying mode is selected.
    expect(container.querySelector('input[aria-label="Valor da entrada"]')).not.toBeNull();

    await pickOption('Tipo de entrada', 'nenhuma');
    expect(container.querySelector('input[aria-label="Valor da entrada"]')).toBeNull();
  });

  it('caps the entrada plus parcelas pair at the 120 installment ceiling', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    await change(labeledInput('Parcelas restantes'), '120');
    // With no entrada row, 120 parcelas is exactly the API ceiling.
    expect(labeledInput('Parcelas restantes').getAttribute('max')).toBe('120');

    await pickOption('Tipo de entrada', '%');
    await change(labeledInput('Valor da entrada'), '10');
    // The entrada row sits on top, so the pair may only reach 120 rows in total.
    expect(labeledInput('Parcelas restantes').getAttribute('max')).toBe('119');
    expect(labeledInput('Parcelas restantes').value).toBe('119');

    await submit();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ defaultRemainingInstallments: 119 });
  });

  /**
   * The `max` attribute and the mode-change clamp both stop at the ceiling, but neither
   * can stop a hand-typed value: `max` does not block a programmatic set, and the value
   * never passes through `setEntradaMode`. This pins the third layer, the submit clamp,
   * which is the only one standing between a typed 500 and a 501-row plan the sale write
   * endpoints would reject.
   */
  it('clamps a hand-typed parcela count to the ceiling at submit', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    await change(labeledInput('Parcelas restantes'), '500');
    await submit();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ defaultRemainingInstallments: 120 });

    // With an entrada the row budget is one smaller, so the same typed value clamps lower.
    const onSaveWithEntrada = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);
    await pickOption('Tipo de entrada', 'R$ fixo');
    await change(labeledInput('Valor da entrada'), '1000');
    await change(labeledInput('Parcelas restantes'), '500');
    await submit();
    expect(onSaveWithEntrada.mock.calls[0]?.[0]).toMatchObject({
      defaultRemainingInstallments: 119,
    });
  });

  it('floors a hand-typed parcela count at one', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    await change(labeledInput('Parcelas restantes'), '0');
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ defaultRemainingInstallments: 1 });
  });

  it('treats a blank ciclos as prazo indeterminado and shows no checkbox', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();

    await goToStep(2);
    await click(labeledButton('Possui mensalidade'));
    await goToStep(3);
    expect(labeledInput('Número de ciclos').value).toBe('');
    expect(text()).toContain('Deixe em branco para prazo indeterminado');
    expect(maybeButton('Prazo indeterminado')).toBeUndefined();

    await submit();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ defaultRecurringCycles: null });
  });

  it('submits a bounded cycle count', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();

    await goToStep(2);
    await click(labeledButton('Possui mensalidade'));
    await goToStep(3);
    await change(labeledInput('Número de ciclos'), '12');
    await submit();

    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ defaultRecurringCycles: 12 });
  });

  it('hides the ciclos field and nulls the column when the product has no mensalidade', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    expect(container.querySelector('input[aria-label="Número de ciclos"]')).toBeNull();
    // Positive control: the plan step really is on screen, so the null above is about
    // the mensalidade switch and not about an unmounted step.
    expect(labeledInput('Parcelas restantes')).toBeInstanceOf(HTMLInputElement);
    await submit();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ defaultRecurringCycles: null });
  });

  it('never puts a date in the default payment plan controls', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();

    await goToStep(2);
    await click(labeledButton('Possui mensalidade'));
    await goToStep(3);
    expect(container.querySelectorAll('input[type="date"]').length).toBe(0);

    await submit();
    const payload = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).filter((key) => /date/i.test(key))).toEqual([]);
  });

  it('saves função costs as a discriminated pct row and a fix row in cents', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(4);

    await addCostRow(1, 'Desenvolvedor', '%', '5');
    await addCostRow(2, 'Testador', 'R$', '300');
    await submit();

    expect(onSave.mock.calls[0]?.[0]?.productFuncaoCosts).toEqual([
      { funcaoId: devFuncao.id, mode: 'pct', valuePct: 5 },
      { funcaoId: testerFuncao.id, mode: 'fix', valueBrl: 30000 },
    ]);
  });

  it('never offers a system função as a cost default', async () => {
    await renderDialog({ productKind: 'service', funcoes: [devFuncao, vendedorFuncao] });
    await fillIdentity();
    await goToStep(4);

    await click(addButtonOf(COSTS_SECTION));
    const offered = await comboboxOptions('Função do custo padrão 1');

    // Positive control: a non-system função is offered, so an empty pool could not pass.
    expect(offered).toContain('Desenvolvedor');
    expect(offered).not.toContain('Vendedor');
  });

  it('never offers an archived função as a cost default', async () => {
    const archived = funcao({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffff04',
      name: 'Arquivada',
      slug: 'arquivada',
      status: 'archived',
    });
    await renderDialog({ productKind: 'service', funcoes: [devFuncao, archived] });
    await fillIdentity();
    await goToStep(4);

    await click(addButtonOf(COSTS_SECTION));
    const offered = await comboboxOptions('Função do custo padrão 1');

    expect(offered).toContain('Desenvolvedor');
    expect(offered).not.toContain('Arquivada');
  });

  it('does not offer the same função twice', async () => {
    await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(4);

    await addCostRow(1, 'Desenvolvedor', '%', '5');
    await click(addButtonOf(COSTS_SECTION));

    const offered = await comboboxOptions('Função do custo padrão 2');
    expect(offered).toContain('Testador');
    expect(offered).not.toContain('Desenvolvedor');

    await pickOption('Função do custo padrão 2', 'Testador');
    expect(addButtonOf(COSTS_SECTION).disabled).toBe(true);
    expect(addButtonOf(COSTS_SECTION).getAttribute('title')).toBe(
      'Todas as funções já têm custo padrão',
    );
  });

  /**
   * A função is never deleted, only archived, so a cost row pointing at an archived
   * função is the expected end state of archiving one that carries money. It has to
   * keep naming that função: a row reading "R$ 300,00 for no função" both misstates
   * stored configuration and invites the operator to silently retarget the cost.
   */
  it('keeps naming an archived função on the cost row that already carries it', async () => {
    const onSave = await renderDialog({
      existing: product({ kind: 'service', openPrice: true, setupBrl: 0 }),
      funcoes: [devFuncao, archivedFuncao],
      funcaoCosts: [
        funcaoCost({
          funcaoId: archivedFuncao.id,
          mode: 'fix',
          valuePct: null,
          valueBrl: 30000,
        }),
      ],
    });
    await goToStep(4);

    // The trigger names the função rather than falling back to the placeholder, and
    // says it is archived so the operator can tell it is no longer assignable.
    expect(comboboxText('Função do custo padrão 1')).toBe('Redator (arquivada)');
    expect(labeledInput('Custo da função 1').value).toBe('300');

    // It is offered on its own row, so the value stays restorable after a stray edit.
    const offered = await comboboxOptions('Função do custo padrão 1');
    expect(offered).toContain('Redator (arquivada)');
    // Positive control: an active função carries no marker, so the suffix above is
    // about the archived status and not about every label.
    expect(offered).toContain('Desenvolvedor');

    await submit();
    expect(onSave.mock.calls[0]?.[0]?.productFuncaoCosts).toEqual([
      { funcaoId: archivedFuncao.id, mode: 'fix', valueBrl: 30000 },
    ]);
  });

  it('names a cost row whose função is missing from the bootstrap instead of showing the placeholder', async () => {
    await renderDialog({
      existing: product({ kind: 'service', openPrice: true, setupBrl: 0 }),
      // The stored cost points at a função this bootstrap does not carry at all.
      funcoes: [devFuncao],
      funcaoCosts: [
        funcaoCost({
          funcaoId: '00000000-0000-4000-8000-00000000dead',
          mode: 'fix',
          valuePct: null,
          valueBrl: 30000,
        }),
      ],
    });
    await goToStep(4);

    const trigger = comboboxText('Função do custo padrão 1');
    expect(trigger).toBe('Função não encontrada');
    // Positive control: the row is really rendered and still holds its money.
    expect(labeledInput('Custo da função 1').value).toBe('300');
    // And never the raw uuid.
    expect(trigger).not.toContain('0000');
  });

  it('never offers an archived função to a row that does not already carry it', async () => {
    await renderDialog({
      existing: product({ kind: 'service', openPrice: true, setupBrl: 0 }),
      funcoes: [devFuncao, archivedFuncao],
      funcaoCosts: [
        funcaoCost({ funcaoId: archivedFuncao.id, mode: 'pct', valuePct: '5.00' }),
      ],
    });
    await goToStep(4);

    await click(addButtonOf(COSTS_SECTION));
    const offered = await comboboxOptions('Função do custo padrão 2');

    // Positive control: the fresh row does get the assignable pool.
    expect(offered).toContain('Desenvolvedor');
    // The archived one stays out of the pool a NEW row draws from, matching the rule
    // the pessoa assignment picker already follows.
    expect(offered.some((label) => label.includes('Redator'))).toBe(false);
  });

  it('explains where to register funções when none exist', async () => {
    await renderDialog({ productKind: 'service', funcoes: [] });
    await fillIdentity();
    await goToStep(4);

    expect(text()).toContain(
      'Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.',
    );
    expect(addButtonOf(COSTS_SECTION).disabled).toBe(true);
  });

  it('removes a função cost row', async () => {
    const onSave = await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(4);

    await addCostRow(1, 'Desenvolvedor', '%', '5');
    await addCostRow(2, 'Testador', 'R$', '300');
    await click(labeledButton('Remover custo padrão 1'));
    await submit();

    expect(onSave.mock.calls[0]?.[0]?.productFuncaoCosts).toEqual([
      { funcaoId: testerFuncao.id, mode: 'fix', valueBrl: 30000 },
    ]);
  });

  it('does not reintroduce any control the payment plan builder removes', async () => {
    await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(2);
    await click(labeledButton('Possui mensalidade'));

    // Swept across every step, so a control cannot hide behind an unmounted one.
    let rendered = text();
    for (const step of [1, 3, 4] as const) {
      await goToStep(step);
      rendered += text();
    }
    for (const forbidden of [
      'Dividir em',
      '+ parcela',
      'Número de parcelas',
      'Remover parcela',
      'Adicionar recorrência',
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
    // Positive control: the controls this slice is supposed to render ARE mounted under
    // slice 11's own labels, so the negatives above cannot pass by way of an empty dialog.
    await goToStep(3);
    expect(labeledInput('Parcelas restantes')).toBeInstanceOf(HTMLInputElement);
    expect(labeledInput('Número de ciclos')).toBeInstanceOf(HTMLInputElement);
    expect(rendered).toContain('Plano de pagamento padrão');
  });

  it('drops the free-text prestador picker and never writes providers', async () => {
    const onSave = await renderDialog({ productKind: 'product' });
    await fillIdentity();
    await goToStep(4);

    expect(container.querySelector('datalist#sales-ops-collaborators')).toBeNull();
    expect(text()).not.toContain('Prestadores de serviço');
    // Positive control: the editor that replaced it is on screen.
    expect(text()).toContain(COSTS_SECTION);

    await submit();
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('providers');
  });

  it('surfaces legacy prestador names read-only inside the função cost section', async () => {
    const onSave = await renderDialog({
      existing: product({
        providers: [{ personName: 'Ana', commissionType: 'pct', commissionValue: 5 }],
      }),
    });
    await goToStep(4);

    expect(text()).toContain(
      'Prestadores antigos deste cadastro não foram convertidos automaticamente: Ana. Recadastre o custo por função acima.',
    );

    await submit();
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty('providers');
  });

  it('renders módulos only for a produto and preserves them when reclassified', async () => {
    const onSave = await renderDialog({
      existing: product({ modules: [{ name: 'Extra BI', type: 'Upsell', valueBrl: 50000 }] }),
    });
    await goToStep(2);

    expect(text()).toContain('Módulos');
    const moduleName = container.querySelector('input[placeholder="Nome do módulo"]');
    expect(moduleName instanceof HTMLInputElement && moduleName.value).toBe('Extra BI');

    await goToStep(1);
    await click(labeledButton('Classificar como serviço'));
    await goToStep(2);
    expect(text()).not.toContain('Módulos');
    expect(container.querySelector('input[placeholder="Nome do módulo"]')).toBeNull();

    await submit();
    expect(onSave.mock.calls[0]?.[0]?.modules).toEqual([
      { name: 'Extra BI', type: 'Upsell', valueBrl: 50000 },
    ]);
  });

  it('rehydrates the stored plan columns and the funcaoCosts prop when reopened', async () => {
    await renderDialog({
      existing: product({
        kind: 'service',
        openPrice: true,
        setupBrl: 0,
        defaultEntradaMode: 'pct',
        defaultEntradaPct: '50.00',
        defaultEntradaBrl: null,
        defaultRemainingInstallments: 3,
        defaultPaymentMethod: 'boleto',
        defaultRecurringCycles: null,
        hasMonthly: true,
      }),
      funcaoCosts: [
        funcaoCost(),
        funcaoCost({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
          funcaoId: testerFuncao.id,
          mode: 'fix',
          valuePct: null,
          valueBrl: 30000,
        }),
      ],
    });
    await goToStep(3);

    expect(comboboxText('Tipo de entrada')).toBe('%');
    expect(labeledInput('Valor da entrada').value).toBe('50');
    expect(labeledInput('Parcelas restantes').value).toBe('3');
    expect(comboboxText('Forma de pagamento padrão')).toBe('Boleto');
    expect(labeledInput('Número de ciclos').value).toBe('');

    await goToStep(4);
    expect(comboboxText('Função do custo padrão 1')).toBe('Desenvolvedor');
    expect(labeledInput('Custo da função 1').value).toBe('5');
    expect(labeledButton('Custo da função 1 em porcentagem').className).toContain('bg-[#201f24]');

    expect(comboboxText('Função do custo padrão 2')).toBe('Testador');
    expect(labeledInput('Custo da função 2').value).toBe('300');
    expect(labeledButton('Custo da função 2 em reais').className).toContain('bg-[#201f24]');
  });

  it('resubmits rehydrated função costs without changing their units', async () => {
    const onSave = await renderDialog({
      existing: product({ kind: 'service', openPrice: true, setupBrl: 0 }),
      funcaoCosts: [
        funcaoCost(),
        funcaoCost({
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02',
          funcaoId: testerFuncao.id,
          mode: 'fix',
          valuePct: null,
          valueBrl: 30000,
        }),
      ],
    });

    await submit();

    expect(onSave.mock.calls[0]?.[0]?.productFuncaoCosts).toEqual([
      { funcaoId: devFuncao.id, mode: 'pct', valuePct: 5 },
      { funcaoId: testerFuncao.id, mode: 'fix', valueBrl: 30000 },
    ]);
  });

  it('keeps the commission editor working unchanged for a serviço', async () => {
    await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(4);

    expect(labeledInput('Comissão do vendedor - somente vendedor').value).toBe('10');
    await click(button('Vendedor + Finder'));
    expect(labeledInput('Comissão do vendedor - com finder').value).toBe('7');
    expect(labeledInput('Comissão do finder').value).toBe('3');
    await click(button('Somente vendedor'));
    expect(labeledInput('Comissão do vendedor - somente vendedor').value).toBe('10');
  });

  it('summarises the default plan back to the operator', async () => {
    await renderDialog({ productKind: 'service' });
    await fillIdentity();
    await goToStep(3);

    expect(text()).toContain('1x · PIX');

    await pickOption('Tipo de entrada', '%');
    await change(labeledInput('Valor da entrada'), '50');
    await change(labeledInput('Parcelas restantes'), '3');
    expect(text()).toContain('Entrada de 50% + 3x do restante · PIX');

    await goToStep(2);
    await click(labeledButton('Possui mensalidade'));
    await goToStep(3);
    expect(text()).toContain('· mensal por prazo indeterminado');
    await change(labeledInput('Número de ciclos'), '12');
    expect(text()).toContain('· mensal por 12 ciclos');
  });
});

describe('the produto wizard shell', () => {
  it('renders the four numbered steps in order on the proposta wizard shell', async () => {
    await renderDialog({ productKind: 'product' });

    // The literal ask: the same chrome as the proposta wizard, at the same width.
    const shell = container.querySelector('div[class*="max-w-[940px]"]');
    if (!(shell instanceof HTMLElement)) throw new Error('wizard shell not found');
    for (const token of ['flex', 'flex-col', 'h-[92vh]', 'overflow-hidden', 'rounded-[22px]']) {
      expect(shell.className.split(' ')).toContain(token);
    }

    const form = shell.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
    const [stepper, body, footer] = [0, 1, 2].map((index) => form.children.item(index)) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ];
    // positive controls: prove we grabbed the right three nodes before asserting on them
    expect(stepper.textContent).toContain('Identificação');
    // Step 1's own copy. The `Tudo aqui é padrão` banner that used to anchor this
    // assertion is gone: it is an `InfoHint` on the title now, i.e. in the HEADER.
    expect(body.textContent).toContain('Final do código da venda');
    expect(footer.textContent).toContain('Avançar');

    // only the body scrolls, and it absorbs all the free space - never a calc() height
    for (const token of ['min-h-0', 'flex-1', 'overflow-y-auto']) {
      expect(body.className.split(' ')).toContain(token);
    }
    expect(body.className).not.toContain('calc(');
    expect(stepper.className.split(' ')).toContain('shrink-0');
    expect(footer.className.split(' ')).toContain('shrink-0');

    const rendered = text();
    for (const label of ['Identificação', 'Valores', 'Pagamento', 'Comissões e custos']) {
      expect(rendered).toContain(label);
    }
    const order = ['Identificação', 'Valores', 'Pagamento', 'Comissões e custos'].map((label) =>
      rendered.indexOf(label),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(rendered).toContain('Passo 1 de 4');
  });

  /**
   * The operator's one hard ordering constraint, pinned directionally in both halves
   * so it cannot pass against an empty render: the payment rules are only reachable
   * once Setup and Mensalidade are settled.
   */
  it('puts Plano de pagamento padrão on a step after the mensalidade controls', async () => {
    await renderDialog({ productKind: 'product' });
    await fillIdentity();

    await goToStep(2);
    expect(text()).toContain('Possui mensalidade');
    expect(text()).not.toContain('Plano de pagamento padrão');

    await goToStep(3);
    expect(text()).toContain('Plano de pagamento padrão');
    expect(text()).not.toContain('Possui mensalidade');
  });

  it('blocks Avançar until nome and área are both filled', async () => {
    await renderDialog({ productKind: 'product' });

    expect(button('Avançar').disabled).toBe(true);
    expect(stepButton(2).disabled).toBe(true);
    expect(stepButton(3).disabled).toBe(true);
    expect(stepButton(4).disabled).toBe(true);

    // Only a name.
    await change(nameInput(), 'FXL Produto');
    expect(button('Avançar').disabled).toBe(true);

    // Only an área.
    await change(nameInput(), '');
    await chooseArea();
    expect(button('Avançar').disabled).toBe(true);

    await change(nameInput(), 'FXL Produto');
    expect(button('Avançar').disabled).toBe(false);
    expect(stepButton(2).disabled).toBe(false);

    await click(button('Avançar'));
    expect(text()).toContain('Passo 2 de 4');
  });

  /**
   * `Avançar` is disabled while step 1 is incomplete, so the operator's real route to a
   * blocked step 1 is the implicit form submission Enter gives them from either field.
   * That path has to name which field is missing rather than doing nothing at all.
   */
  it('shows which identity field is missing after a blocked submit', async () => {
    const onSave = await renderDialog({ productKind: 'product' });

    expect(button('Avançar').disabled).toBe(true);
    await submit();

    expect(text()).toContain('Informe o nome do produto.');
    expect(text()).toContain('Selecione a área.');
    expect(text()).toContain('Passo 1 de 4');
    expect(onSave).not.toHaveBeenCalled();

    // And it clears field by field, so the message always describes the current form.
    await change(nameInput(), 'FXL Produto');
    expect(text()).not.toContain('Informe o nome do produto.');
    expect(text()).toContain('Selecione a área.');
  });

  /**
   * The payload-equivalence guard this whole slice hinges on. Written and passing
   * against the single-page dialog FIRST, then re-run through the wizard with nothing
   * changed but the navigation. `toEqual` rather than `toMatchObject` is the
   * load-bearing choice: it fails both when a field is dropped and when one appears,
   * which is what would catch an accidental `providers: []` or `openPrice`.
   */
  it('emits the identical SaveProductPayload for a fully filled produto', async () => {
    const onSave = await renderDialog({ productKind: 'product' });

    await change(nameInput(), 'FXL Completo');
    await chooseArea();
    await change(codeSuffixInput(), '42');

    await goToStep(2);
    await change(moneyInput('Setup (R$)'), '2500');
    await click(labeledButton('Possui mensalidade'));
    await change(moneyInput('Valor da mensalidade (R$)'), '300');
    await click(labeledButton('Incide sobre recorrente'));
    await addModule('Extra BI', '500');

    await goToStep(3);
    await pickOption('Tipo de entrada', '%');
    await change(labeledInput('Valor da entrada'), '40');
    await change(labeledInput('Parcelas restantes'), '6');
    await pickOption('Forma de pagamento padrão', 'Boleto');
    await change(labeledInput('Número de ciclos'), '12');

    await goToStep(4);
    await click(labeledButton('Comissão do vendedor - somente vendedor em reais'));
    await change(labeledInput('Comissão do vendedor - somente vendedor'), '1200');
    await click(button('Vendedor + Finder'));
    await change(labeledInput('Comissão do vendedor - com finder'), '8');
    await click(labeledButton('Comissão do finder em reais'));
    await change(labeledInput('Comissão do finder'), '400');
    await addCostRow(1, 'Desenvolvedor', '%', '5');
    await addCostRow(2, 'Testador', 'R$', '300');

    await submit();

    expect(onSave.mock.calls[0]?.[0]).toEqual({
      id: undefined,
      name: 'FXL Completo',
      areaId: areaFixture.id,
      codeSuffix: '42',
      kind: 'product',
      setupBrl: 250000,
      hasMonthly: true,
      monthlyBrl: 30000,
      recurringCommission: true,
      sellerCommissionType: 'fix',
      sellerCommissionValue: 1200,
      sellerWithFinderCommissionType: 'pct',
      sellerWithFinderCommissionValue: 8,
      finderCommissionType: 'fix',
      finderCommissionValue: 400,
      defaultPaymentMethod: 'boleto',
      defaultEntradaMode: 'pct',
      defaultEntradaPct: 40,
      defaultEntradaBrl: null,
      defaultRemainingInstallments: 6,
      defaultRecurringCycles: 12,
      productFuncaoCosts: [
        { funcaoId: devFuncao.id, mode: 'pct', valuePct: 5 },
        { funcaoId: testerFuncao.id, mode: 'fix', valueBrl: 30000 },
      ],
      modules: [{ name: 'Extra BI', type: 'Upsell', valueBrl: 50000 }],
      status: 'active',
    });
  });

  it('lands on step 1 with an existing produto prefilled and saves from any step', async () => {
    const existing = product({ name: 'FXL Finance' });
    const onSave = await renderDialog({ existing });

    expect(text()).toContain('Passo 1 de 4');
    expect(nameInput().value).toBe('FXL Finance');
    expect(comboboxText('Área do produto')).toBe(areaFixture.name);

    await click(button('Salvar alterações'));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ id: existing.id, name: 'FXL Finance' });
  });

  it('offers no mid-wizard save for a new produto', async () => {
    await renderDialog({ productKind: 'product' });
    await fillIdentity();

    expect(maybeButton('Salvar alterações')).toBeUndefined();
    await goToStep(2);
    expect(maybeButton('Salvar alterações')).toBeUndefined();
    await goToStep(3);
    expect(maybeButton('Salvar alterações')).toBeUndefined();
  });
});

/*
  `(org_id, code_suffix)` is UNIQUE and `createProduct` maps no 23505, so a suffix
  collision escapes as a bare 500. Seeding a NEW record with `max + 1` is what makes
  that path unreachable through the UI - and leaving an EXISTING record's stored
  suffix alone is what keeps it from silently renumbering every sale code the
  produto has already generated.
*/
describe('the código da venda suffix suggestion', () => {
  const otherProduct = product({
    id: '22222222-2222-4222-8222-222222222222',
    name: 'FXL Outro',
    codeSuffix: '7',
  });

  const catalogue = [product({ codeSuffix: '3' }), otherProduct];

  it('seeds a new produto with the highest suffix plus one', async () => {
    await renderDialog({ products: catalogue });
    expect(labeledInput('Final do código da venda').value).toBe('8');
  });

  it('leaves an existing produto on its own stored suffix', async () => {
    // The edit path must never see a recomputed value: 3, not 8.
    await renderDialog({ products: catalogue, existing: product({ codeSuffix: '3' }) });
    expect(labeledInput('Final do código da venda').value).toBe('3');
  });

  it('suggests the same number for a new serviço', async () => {
    // The suggestion is not gated on `kind`: the unique index is not either.
    await renderDialog({ products: catalogue, productKind: 'service' });
    expect(labeledInput('Final do código da venda').value).toBe('8');
  });

  it('falls back to 0 on an empty catalogue', async () => {
    await renderDialog({ products: [] });
    expect(labeledInput('Final do código da venda').value).toBe('0');
  });

  it('carries the suggestion through submit without coercing it away', async () => {
    const onSave = await renderDialog({ products: catalogue });
    await fillIdentity();
    await submit();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ codeSuffix: '8' }));
  });
});
