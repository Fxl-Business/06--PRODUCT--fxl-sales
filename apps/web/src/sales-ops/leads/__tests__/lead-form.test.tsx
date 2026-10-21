// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsClient, SalesOpsProduct } from '../../types';
import type { FieldDefinition } from '../crm-types';
import { LeadForm, type LeadFormProps } from '../LeadForm';
import { CLIENT_PICKER_COPY } from '../client-picker-copy';
import { LEAD_FORM_COPY } from '../lead-form';
import type { SalesOpsLead } from '../types';
import { addDaysToIsoDay, todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function escape(element: Element) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await settle();
}

function field(id: string, kind: FieldDefinition['kind'], position: number, extra: Partial<FieldDefinition> = {}): FieldDefinition {
  return {
    id,
    key: extra.key ?? id.replace(/^f-/, ''),
    label: extra.label ?? id,
    kind,
    referenceTarget: null,
    multiple: false,
    options: null,
    filterable: true,
    isSystem: false,
    removable: true,
    position,
    ...extra,
  };
}

const DEFS: FieldDefinition[] = [
  field('f-cli', 'reference', 0, {
    key: 'cliente',
    label: 'Cliente',
    referenceTarget: 'cliente',
    isSystem: true,
    removable: false,
  }),
  field('f-desc', 'text', 1, { key: 'descricao', label: 'Descrição' }),
  field('f-qtd', 'number', 2, { key: 'qtd', label: 'Quantidade' }),
  field('f-orc', 'money', 3, { key: 'orcamento', label: 'Orçamento' }),
  field('f-prazo', 'date', 4, { key: 'prazo', label: 'Prazo' }),
  field('f-origem', 'options', 5, {
    key: 'origem',
    label: 'Origem',
    options: [
      { key: 'site', label: 'Site' },
      { key: 'indicacao', label: 'Indicação' },
    ],
  }),
  field('f-prod', 'reference', 6, { key: 'produtos', label: 'Produtos', referenceTarget: 'produto', multiple: true }),
];

const CLIENTS = [
  { id: 'c1', orgId: 'o', name: 'Acme', contact: 'ana@acme.com' },
  { id: 'c2', orgId: 'o', name: 'Beta', contact: '(11) 99999-0000' },
  { id: 'c3', orgId: 'o', name: 'Gama', contact: null },
] as unknown as SalesOpsClient[];

const PRODUCTS = [
  { id: 'P1', orgId: 'o', name: 'Site institucional', kind: 'product', status: 'active' },
  { id: 'S1', orgId: 'o', name: 'Consultoria', kind: 'service', status: 'active' },
] as unknown as SalesOpsProduct[];

const SELLERS = [
  { value: 'V1', label: 'Ana Vendedora' },
  { value: 'V2', label: 'Bruno Vendedor' },
];

type Overrides = Partial<LeadFormProps>;

async function renderForm(overrides: Overrides = {}) {
  const onSubmit = vi.fn(async () => undefined);
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <LeadForm
        clients={CLIENTS}
        definitions={DEFS}
        initial={null}
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        open
        products={PRODUCTS}
        sellers={SELLERS}
        {...overrides}
      />,
    );
  });
  await settle();
  return { onSubmit, onOpenChange };
}

function dialogNode(): Element {
  const node = document.querySelector('[role="dialog"]');
  if (!node) throw new Error('dialog not rendered');
  return node;
}

function input(id: string): HTMLInputElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLInputElement)) throw new Error(`input not found: ${id}`);
  return node;
}

function textarea(id: string): HTMLTextAreaElement {
  const node = document.getElementById(id);
  if (!(node instanceof HTMLTextAreaElement)) throw new Error(`textarea not found: ${id}`);
  return node;
}

async function typeInto(target: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(target, value);
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

function saveButton(): HTMLButtonElement {
  const node = dialogNode().querySelector('[data-lead-save]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('Salvar not rendered');
  return node;
}

function blockedText(): string | null {
  return dialogNode().querySelector('[data-lead-blocked]')?.textContent ?? null;
}

function clientTrigger(): HTMLButtonElement {
  const node = dialogNode().querySelector('[role="combobox"][aria-labelledby="lead-client-label"]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('cliente picker missing');
  return node;
}

function sellerTrigger(): HTMLButtonElement {
  const node = dialogNode().querySelector('[role="combobox"][aria-label="Vendedor responsável"]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('vendedor picker missing');
  return node;
}

function comboboxSearch(): HTMLInputElement {
  const search = document.querySelector('[role="listbox"]')?.parentElement?.querySelector('input[type="text"]');
  if (!(search instanceof HTMLInputElement)) throw new Error('combobox search not found');
  return search;
}

function optionByText(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!row) throw new Error(`option "${label}" not offered`);
  return row;
}

async function pickClient(label: string) {
  await click(clientTrigger());
  await click(optionByText(label));
}

async function pickSeller(label: string) {
  await click(sellerTrigger());
  await click(optionByText(label));
}

function buttonWithText(text: string): HTMLButtonElement {
  const node = [...dialogNode().querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
  if (!node) throw new Error(`button "${text}" not rendered`);
  return node;
}

function fieldRoot(key: string): Element {
  const node = dialogNode().querySelector(`[data-lead-field="${key}"]`);
  if (!node) throw new Error(`field ${key} not rendered`);
  return node;
}

function leadFixture(overrides: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: 'L1',
    stageId: 'S1',
    position: 1,
    contactName: 'Ana',
    clientId: null,
    clientNameSnapshot: '',
    estimatedValueBrl: 0,
    description: null,
    contactPhone: '123',
    contactEmail: 'ana@example.com',
    contactBirthDate: null,
    sellerPersonId: 'V1',
    sellerNameSnapshot: 'Ana Vendedora',
    lostReason: null,
    stageChangedAt: '2026-10-01T00:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: null,
    ...overrides,
  } as unknown as SalesOpsLead;
}

describe('LeadForm', () => {
  it('requires a name and one contact before Salvar enables', async () => {
    await renderForm();
    expect(saveButton().disabled).toBe(true);
    await typeInto(input('lead-contact-name'), 'Ana');
    expect(saveButton().disabled).toBe(true);
    expect(blockedText()).toBeNull();
    await typeInto(input('lead-phone'), '11999990000');
    expect(saveButton().disabled).toBe(false);
    await typeInto(input('lead-phone'), '');
    await typeInto(input('lead-email'), 'ana@acme.com');
    expect(saveButton().disabled).toBe(false);
    await typeInto(input('lead-email'), 'ana@');
    expect(saveButton().disabled).toBe(true);
    expect(blockedText()).toBe(LEAD_FORM_COPY.emailInvalid);
  });

  it('shows the name error only after Nome changed, and the contact error after Telefone or E-mail changed', async () => {
    await renderForm();
    expect(blockedText()).toBeNull();
    await typeInto(input('lead-contact-name'), 'A');
    await typeInto(input('lead-contact-name'), '');
    expect(blockedText()).toBe(LEAD_FORM_COPY.nameRequired);
    await typeInto(input('lead-contact-name'), 'Ana');
    expect(blockedText()).toBeNull();
    await typeInto(input('lead-phone'), '1');
    await typeInto(input('lead-phone'), '');
    expect(blockedText()).toBe(LEAD_FORM_COPY.contactRequired);
  });

  it('the Cliente picker is always present, even with no definitions', async () => {
    await renderForm({ definitions: [] });
    const cliente = dialogNode().querySelectorAll('[data-lead-field="cliente"]');
    expect(cliente).toHaveLength(1);
    expect(cliente[0]?.querySelector('[role="combobox"][aria-labelledby="lead-client-label"]')).not.toBeNull();
  });

  it('the Cliente is not duplicated nor removable when the org lists it', async () => {
    await renderForm();
    expect(dialogNode().querySelectorAll('[data-lead-field="cliente"]')).toHaveLength(1);
    expect(dialogNode().querySelector('[data-field-remove]')).toBeNull();
    expect(
      [...dialogNode().querySelectorAll('button')].some((b) => /remover campo|ocultar campo/i.test(b.textContent ?? '')),
    ).toBe(false);
    expect(fieldRoot('cliente').getAttribute('data-field-removable')).toBe('false');
  });

  it('creates a cliente by name inline', async () => {
    const CREATED_ID = 'c0000000-0000-4000-8000-0000000000aa';
    const onCreateClient = vi.fn(async () => ({ value: CREATED_ID, label: 'Nova Obra' }));
    const { onSubmit } = await renderForm({ onCreateClient });
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '11999990000');
    await click(clientTrigger());
    await typeInto(comboboxSearch(), 'Nova Obra');
    const createRow = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((node) =>
      node.textContent?.toLowerCase().includes('criar'),
    );
    if (!createRow) throw new Error('create row not offered');
    await click(createRow);
    expect(onCreateClient).toHaveBeenCalledWith('Nova Obra');
    await click(saveButton());
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.clientId).toBe(CREATED_ID);
    expect(payload.clientName).toBe('Nova Obra');
  });

  it('the picker reads Buscar ou criar novo cliente only while onCreateClient is wired', async () => {
    await renderForm({ onCreateClient: vi.fn(async () => null) });
    await click(clientTrigger());
    expect(clientTrigger().textContent).toContain(CLIENT_PICKER_COPY.searchOrCreate);
    expect(document.querySelector(`input[aria-label="${CLIENT_PICKER_COPY.searchOrCreate}"]`)).not.toBeNull();
    await escape(comboboxSearch());
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderForm();
    expect(clientTrigger().textContent).toContain(CLIENT_PICKER_COPY.searchOnly);
    await click(clientTrigger());
    expect(document.querySelector(`input[aria-label="${CLIENT_PICKER_COPY.searchOnly}"]`)).not.toBeNull();
    expect([...document.querySelectorAll('[role="listbox"] [role="option"]')].some((n) => n.textContent?.toLowerCase().includes('criar'))).toBe(false);
  });

  it('choosing an empresa prefills a blank e-mail, a blank phone, and nothing else', async () => {
    await renderForm();
    await pickClient('Acme');
    expect(input('lead-email').value).toBe('ana@acme.com');
    expect(input('lead-phone').value).toBe('');
    expect(dialogNode().querySelector('[data-contact-prefilled]')).not.toBeNull();
    await pickClient('Gama');
    expect(input('lead-phone').value).toBe('');
    expect(dialogNode().querySelector('[data-contact-prefilled]')).toBeNull();
  });

  it('a prefill never overwrites what the operator typed', async () => {
    await renderForm();
    await typeInto(input('lead-phone'), '(21) 1');
    await pickClient('Beta');
    expect(input('lead-phone').value).toBe('(21) 1');
  });

  it('choosing an empresa leaves the responsável alone', async () => {
    await renderForm();
    await pickSeller('Bruno Vendedor');
    const before = sellerTrigger().textContent;
    await pickClient('Acme');
    expect(sellerTrigger().textContent).toBe(before);
  });

  it('Limpar clears the cliente but keeps the typed contact', async () => {
    await renderForm();
    await typeInto(input('lead-phone'), '11999990000');
    await pickClient('Acme');
    await click(buttonWithText(LEAD_FORM_COPY.clearLabel));
    expect(clientTrigger().textContent).not.toContain('Acme');
    expect(input('lead-phone').value).toBe('11999990000');
  });

  it('renders each dynamic field by kind', async () => {
    await renderForm();
    expect(fieldRoot('descricao').querySelector('textarea')).not.toBeNull();
    expect(fieldRoot('qtd').querySelector('input[type="number"]')).not.toBeNull();
    expect(fieldRoot('orcamento').querySelector('input[step="0.01"]')).not.toBeNull();
    expect(fieldRoot('prazo').querySelector('input[type="date"]')).not.toBeNull();
    expect(fieldRoot('origem').querySelector('[role="combobox"]')).not.toBeNull();
    expect(fieldRoot('produtos').querySelector('[role="combobox"]')).not.toBeNull();
    expect(fieldRoot('produtos').querySelector('input#lead-field-f-prod-free')).not.toBeNull();
  });

  it('submits the dynamic values encoded by kind', async () => {
    const { onSubmit } = await renderForm();
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '11999990000');
    await typeInto(input('lead-field-f-qtd'), '3');
    await typeInto(input('lead-field-f-orc'), '1500.50');
    await typeInto(input('lead-field-f-prazo'), '2026-11-01');
    await click(fieldRoot('origem').querySelector('[role="combobox"]') as HTMLElement);
    await click(optionByText('Site'));
    await click(fieldRoot('produtos').querySelector('[role="combobox"]') as HTMLElement);
    await click(optionByText('Site institucional'));
    await click(buttonWithText('Adicionar'));
    await typeInto(input('lead-field-f-prod-free'), 'Consultoria avulsa');
    await click(buttonWithText('+ Adicionar item livre'));
    await click(saveButton());
    const payload = onSubmit.mock.calls[0]?.[0] as { fields: Array<{ fieldId: string; value: unknown }> };
    expect(payload.fields).toEqual([
      { fieldId: 'f-qtd', value: 3 },
      { fieldId: 'f-orc', value: 150050 },
      { fieldId: 'f-prazo', value: '2026-11-01' },
      { fieldId: 'f-origem', value: 'site' },
      {
        fieldId: 'f-prod',
        value: [
          { id: 'P1', name: 'Site institucional' },
          { id: null, name: 'Consultoria avulsa' },
        ],
      },
    ]);
  });

  it('a single (multiple:false) reference replaces its item', async () => {
    const defs = [field('f-cli', 'reference', 0, { key: 'cliente', referenceTarget: 'cliente', isSystem: true, removable: false }), field('f-prod', 'reference', 1, { key: 'produtos', label: 'Produto', referenceTarget: 'produto', multiple: false })];
    const { onSubmit } = await renderForm({ definitions: defs });
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '1');
    await typeInto(input('lead-field-f-prod-free'), 'Um');
    await click(buttonWithText('+ Adicionar item livre'));
    await typeInto(input('lead-field-f-prod-free'), 'Dois');
    await click(buttonWithText('+ Adicionar item livre'));
    await click(saveButton());
    const payload = onSubmit.mock.calls[0]?.[0] as { fields: Array<{ value: unknown }> };
    expect(payload.fields[0]?.value).toEqual([{ id: null, name: 'Dois' }]);
  });

  it('Escape on the open cliente picker closes only the picker', async () => {
    const { onOpenChange } = await renderForm({ onCreateClient: vi.fn(async () => null) });
    await click(clientTrigger());
    const search = document.querySelector(`input[aria-label="${CLIENT_PICKER_COPY.searchOrCreate}"]`);
    if (!(search instanceof HTMLInputElement)) throw new Error('cliente search not found by its name');
    await escape(search);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
    await escape(clientTrigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Escape on an open dynamic options picker closes only that picker', async () => {
    const { onOpenChange } = await renderForm();
    await click(fieldRoot('origem').querySelector('[role="combobox"]') as HTMLElement);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    const search = document.querySelector('[role="listbox"]')?.parentElement?.querySelector('input[type="text"]');
    if (!(search instanceof HTMLInputElement)) throw new Error('options search not found');
    await escape(search);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('the birth date input is capped at today, and no other date field is', async () => {
    await renderForm({ definitions: [...DEFS, field('f-nasc', 'date', 7, { key: 'nascimento', label: 'Nascimento' })] });
    expect(input('lead-field-f-nasc').getAttribute('type')).toBe('date');
    expect(input('lead-field-f-nasc').getAttribute('max')).toBe(todayInSaoPaulo());
    expect(input('lead-field-f-prazo').getAttribute('max')).toBeNull();
  });

  it('a future birth date blocks Salvar with the message, and today is accepted', async () => {
    const today = todayInSaoPaulo();
    await renderForm({ definitions: [...DEFS, field('f-nasc', 'date', 7, { key: 'nascimento', label: 'Nascimento' })] });
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '11999990000');
    expect(saveButton().disabled).toBe(false);

    await typeInto(input('lead-field-f-nasc'), addDaysToIsoDay(today, 1));
    expect(saveButton().disabled).toBe(true);
    expect(blockedText()).toBe(LEAD_FORM_COPY.birthDateFuture);

    await typeInto(input('lead-field-f-nasc'), today);
    expect(saveButton().disabled).toBe(false);
    expect(blockedText()).toBeNull();
  });

  it('a refused save keeps the dialog open with the typed values and an inline error', async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error('x');
    });
    const { onOpenChange } = await renderForm({ onSubmit });
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '11999990000');
    await click(saveButton());
    expect(dialogNode().querySelector('[data-lead-save-error]')?.textContent).toBe(LEAD_FORM_COPY.saveFailed);
    expect(input('lead-contact-name').value).toBe('Ana');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('a 400 no_open_stage shows the no-etapa copy', async () => {
    const onSubmit = vi.fn(async () => {
      throw Object.assign(new Error('x'), { status: 400, reason: 'no_open_stage' });
    });
    await renderForm({ onSubmit });
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '11999990000');
    await click(saveButton());
    expect(dialogNode().querySelector('[data-lead-save-error]')?.textContent).toBe(LEAD_FORM_COPY.noStageError);
  });

  it('closes only once the save resolves', async () => {
    let resolveSave: () => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { onOpenChange } = await renderForm({ onSubmit });
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '11999990000');
    await click(saveButton());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    await act(async () => {
      resolveSave();
    });
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('edit mode seeds the lead, titles Editar lead and sends the id', async () => {
    const lead = leadFixture({
      fields: [
        { fieldId: 'f-desc', key: 'descricao', value: 'Antes' },
        { fieldId: 'f-qtd', key: 'qtd', value: 3 },
      ] as SalesOpsLead['fields'],
    });
    const { onSubmit } = await renderForm({ initial: lead });
    expect(dialogNode().textContent).toContain(LEAD_FORM_COPY.editTitle);
    expect(textarea('lead-field-f-desc').value).toBe('Antes');
    await typeInto(textarea('lead-field-f-desc'), '');
    await click(saveButton());
    const payload = onSubmit.mock.calls[0]?.[0] as { id?: string; fields: Array<{ fieldId: string; value: unknown }> };
    expect(payload.id).toBe('L1');
    expect(payload.fields).toContainEqual({ fieldId: 'f-desc', value: null });
  });

  it('an edit of a contact-less lead keeps saving without a contact', async () => {
    const lead = leadFixture({ contactPhone: null, contactEmail: null, fields: [] });
    const { onSubmit } = await renderForm({ initial: lead });
    expect(saveButton().disabled).toBe(false);
    await click(saveButton());
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('contactPhone' in payload).toBe(false);
  });

  it('Excluir lead renders on edit only and only when onDelete is given', async () => {
    const onDelete = vi.fn();
    await renderForm({ onDelete });
    expect(dialogNode().querySelector('[data-delete-lead-form]')).toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderForm({ initial: leadFixture(), onDelete });
    const del = dialogNode().querySelector('[data-delete-lead-form]');
    expect(del).not.toBeNull();
    await click(del as Element);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides the vendedor and omits sellerPersonId when showSellerPicker is false', async () => {
    const { onSubmit } = await renderForm({ showSellerPicker: false });
    expect(dialogNode().querySelector('[role="combobox"][aria-label="Vendedor responsável"]')).toBeNull();
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-phone'), '11999990000');
    await click(saveButton());
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('sellerPersonId' in payload).toBe(false);
  });

  it('stretches the inline action buttons', async () => {
    await renderForm({ onCreateClient: vi.fn(async () => null) });
    expect(buttonWithText(LEAD_FORM_COPY.clearLabel).className).toContain('self-stretch');
    expect(buttonWithText('Adicionar').className).toContain('self-stretch');
    expect(buttonWithText('+ Adicionar item livre').className).toContain('self-stretch');
    expect(buttonWithText('Cancelar').className).not.toContain('self-stretch');
  });

  it('never renders a raw id', async () => {
    const lead = leadFixture({ clientId: 'c1', clientNameSnapshot: 'Acme', sellerPersonId: 'V1' });
    await renderForm({ initial: lead });
    const text = dialogNode().textContent ?? '';
    expect(text).not.toContain('f-desc');
    expect(text).not.toContain('f-cli');
    expect(text).not.toContain('L1');
  });
});
