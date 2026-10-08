// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactLeadDialog } from '../ContactLeadDialog';
import { CLIENT_PICKER_COPY } from '../client-picker-copy';

/**
 * The leads edition's contact dialog, driven through the REAL `Dialog` and the
 * REAL `Combobox`. It carries the contact data plus an empresa (Cliente) picker
 * and a valor estimado; produtos still do not exist here.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const TODAY = '2026-10-05';
const LEAD_ID = 'aaaaaaaa-0000-4000-8000-000000000009';
const SELLER_ID = 'd0000000-0000-4000-8000-000000000001';
const SELLER_TWO = 'd0000000-0000-4000-8000-000000000002';
const SELLER_THREE = 'd0000000-0000-4000-8000-000000000003';

const SELLERS = [
  { value: SELLER_ID, label: 'Marina Souza' },
  { value: SELLER_TWO, label: 'Rafael Lima' },
  { value: SELLER_THREE, label: 'Paula Reis' },
];

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
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  await settle();
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

async function typeInto(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const proto =
      field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
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

function sellerTrigger(): HTMLButtonElement {
  // Two comboboxes now (Cliente then Vendedor); target the vendedor by its label.
  const node = dialogNode().querySelector('[role="combobox"][aria-label="Vendedor responsável"]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('vendedor picker missing');
  return node;
}

function comboboxSearch(): HTMLInputElement {
  const search = document
    .querySelector('[role="listbox"]')
    ?.parentElement?.querySelector('input[type="text"]');
  if (!(search instanceof HTMLInputElement)) throw new Error('combobox search not found');
  return search;
}

async function pickSeller(label: string) {
  await click(sellerTrigger());
  const row = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!row) throw new Error(`option "${label}" not offered`);
  await click(row);
}

function clientTrigger(): HTMLButtonElement {
  const node = dialogNode().querySelector('[role="combobox"][aria-labelledby="lead-client-label"]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('cliente picker missing');
  return node;
}

async function pickClient(label: string) {
  await click(clientTrigger());
  const row = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!row) throw new Error(`client option "${label}" not offered`);
  await click(row);
}

type Overrides = Partial<React.ComponentProps<typeof ContactLeadDialog>>;

async function renderDialog(overrides: Overrides = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <ContactLeadDialog
        initial={null}
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
        open
        sellers={SELLERS}
        today={TODAY}
        {...overrides}
      />,
    );
  });
  await settle();
  return { onSubmit, onOpenChange };
}

describe('ContactLeadDialog', () => {
  it('renders the contact fields plus empresa and valor, in order', async () => {
    await renderDialog();
    const labels = [
      ...dialogNode().querySelectorAll(
        'label, [id="lead-client-label"], [id="lead-seller-label"]',
      ),
    ].map((node) => node.textContent?.trim());
    expect(labels).toEqual([
      'Nome do contato (comprador) *',
      'Cliente',
      'Valor estimado (R$)',
      'Data de aniversário',
      'Número (telefone/WhatsApp)',
      'Email',
      'Descrição',
      'Vendedor responsável',
    ]);
  });

  it('has the empresa and valor fields but no produtos', async () => {
    await renderDialog();
    const text = dialogNode().textContent ?? '';
    expect(text).toContain('Cliente');
    expect(text).toContain('Valor estimado');
    expect(text).not.toContain('Produtos');
    expect(dialogNode().querySelector('input[type="number"]')).not.toBeNull();
  });

  it('the birthday is a date input capped at today', async () => {
    await renderDialog();
    const birth = input('lead-birth-date');
    expect(birth.getAttribute('type')).toBe('date');
    expect(birth.getAttribute('max')).toBe(TODAY);
  });

  it('blocks a blank name until one is typed', async () => {
    await renderDialog();
    expect(saveButton().disabled).toBe(true);

    await typeInto(input('lead-contact-name'), 'Ana');
    expect(saveButton().disabled).toBe(false);
    expect(blockedText()).toBeNull();
  });

  it('opens with no validation text, on create and on edit', async () => {
    await renderDialog();
    expect(blockedText()).toBeNull();
    expect(dialogNode().textContent).not.toContain('Informe o nome.');
    expect(saveButton().disabled).toBe(true);
  });

  it('shows the name error only after Nome changes, and clears it once valid', async () => {
    await renderDialog();
    await typeInto(input('lead-contact-name'), 'A');
    expect(blockedText()).toBeNull();
    await typeInto(input('lead-contact-name'), '');
    expect(blockedText()).toBe('Informe o nome.');
    expect(saveButton().disabled).toBe(true);
    await typeInto(input('lead-contact-name'), 'Ana');
    expect(blockedText()).toBeNull();
  });

  it('does not show the email error while only another field changed', async () => {
    await renderDialog({
      initial: {
        contactName: 'Ana',
        contactEmail: 'ana@',
        contactPhone: null,
        contactBirthDate: null,
        description: null,
        sellerPersonId: SELLER_ID,
      },
    });
    expect(blockedText()).toBeNull();
    await typeInto(input('lead-phone'), '11999999999');
    expect(blockedText()).toBeNull();
    expect(saveButton().disabled).toBe(true);
    await typeInto(input('lead-email'), 'ana@x');
    await typeInto(input('lead-email'), 'ana@');
    expect(blockedText()).toBe('Informe um email válido.');
  });

  it('blocks a future birthday and accepts today', async () => {
    await renderDialog();
    await typeInto(input('lead-contact-name'), 'Ana');
    expect(blockedText()).toBeNull();

    await typeInto(input('lead-birth-date'), '2026-10-06');
    expect(saveButton().disabled).toBe(true);
    expect(blockedText()).toBe('A data de aniversário não pode ser no futuro.');

    await typeInto(input('lead-birth-date'), '2026-10-05');
    expect(saveButton().disabled).toBe(false);
  });

  it('blocks a malformed email', async () => {
    await renderDialog();
    await typeInto(input('lead-contact-name'), 'Ana');
    await typeInto(input('lead-email'), 'ana@');
    expect(saveButton().disabled).toBe(true);
    expect(blockedText()).toBe('Informe um email válido.');
  });

  it('sends the contact payload with empresa/valor and closes', async () => {
    const { onSubmit, onOpenChange } = await renderDialog();
    await typeInto(input('lead-contact-name'), 'Ana Construbom');
    await typeInto(input('lead-estimated-value'), '1500');
    await typeInto(input('lead-birth-date'), '1990-02-28');
    await typeInto(input('lead-phone'), '(11) 98888-7777');
    await typeInto(input('lead-email'), 'ana@construbom.com.br');
    await typeInto(textarea('lead-description'), 'Indicação da feira');
    await pickSeller('Rafael Lima');

    await click(saveButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      contactName: 'Ana Construbom',
      contactPhone: '(11) 98888-7777',
      contactEmail: 'ana@construbom.com.br',
      contactBirthDate: '1990-02-28',
      description: 'Indicação da feira',
      clientId: null,
      clientName: null,
      estimatedValueBrl: 150000,
      sellerPersonId: SELLER_TWO,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('selects an existing client and sends its id and name', async () => {
    const CLIENT_ID = 'c0000000-0000-4000-8000-000000000001';
    const { onSubmit } = await renderDialog({
      clients: [{ value: CLIENT_ID, label: 'Construtora Alfa' }],
    });
    await typeInto(input('lead-contact-name'), 'Ana');
    await pickClient('Construtora Alfa');
    await click(saveButton());

    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.clientId).toBe(CLIENT_ID);
    expect(payload.clientName).toBe('Construtora Alfa');
  });

  it('creates a client by name inline through onCreateClient', async () => {
    const CREATED_ID = 'c0000000-0000-4000-8000-0000000000aa';
    const onCreateClient = vi.fn(async () => ({ value: CREATED_ID, label: 'Nova Obra' }));
    const { onSubmit } = await renderDialog({ onCreateClient });
    await typeInto(input('lead-contact-name'), 'Ana');

    await click(clientTrigger());
    await typeInto(comboboxSearch(), 'Nova Obra');
    const createRow = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(
      (node) => node.textContent?.toLowerCase().includes('criar'),
    );
    if (!createRow) throw new Error('create row not offered');
    await click(createRow);
    expect(onCreateClient).toHaveBeenCalledWith('Nova Obra');

    await click(saveButton());
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.clientId).toBe(CREATED_ID);
    expect(payload.clientName).toBe('Nova Obra');
  });

  it('with inline create wired, the cliente trigger and search read Buscar ou criar novo cliente (AC5)', async () => {
    await renderDialog({ onCreateClient: vi.fn(async () => null) });
    expect(clientTrigger().textContent?.trim()).toBe(CLIENT_PICKER_COPY.searchOrCreate);
    expect(clientTrigger().hasAttribute('data-placeholder')).toBe(true);

    await click(clientTrigger());
    const search = comboboxSearch();
    expect(search.getAttribute('placeholder')).toBe(CLIENT_PICKER_COPY.searchOrCreate);
    expect(search.getAttribute('aria-label')).toBe(CLIENT_PICKER_COPY.searchOrCreate);

    // The copy keeps its promise: an unknown name offers the Criar row.
    await typeInto(search, 'Nova Obra');
    expect(document.querySelector('[data-combobox-create]')).not.toBeNull();
  });

  it('without onCreateClient the cliente picker never promises creation (AC5)', async () => {
    await renderDialog();
    expect(clientTrigger().textContent?.trim()).toBe(CLIENT_PICKER_COPY.searchOnly);

    await click(clientTrigger());
    const search = comboboxSearch();
    expect(search.getAttribute('placeholder')).toBe(CLIENT_PICKER_COPY.searchOnly);
    expect(search.getAttribute('aria-label')).toBe(CLIENT_PICKER_COPY.searchOnly);

    await typeInto(search, 'Nova Obra');
    expect(document.querySelector('[data-combobox-create]')).toBeNull();
    expect(clientTrigger().textContent ?? '').not.toMatch(/criar/i);
    expect(search.getAttribute('placeholder') ?? '').not.toMatch(/criar/i);
  });

  it('Escape on the open cliente picker closes only the picker', async () => {
    const { onOpenChange } = await renderDialog({ onCreateClient: vi.fn(async () => null) });
    await click(clientTrigger());
    const search = document.querySelector(
      `input[aria-label="${CLIENT_PICKER_COPY.searchOrCreate}"]`,
    );
    if (!(search instanceof HTMLInputElement)) throw new Error('cliente search not found by its name');

    await escape(search);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Positive control: the real Radix dialog does close on a bare Escape.
    await escape(clientTrigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('clearing a field on an edit sends null and carries the id', async () => {
    const { onSubmit } = await renderDialog({
      initial: {
        id: LEAD_ID,
        contactName: 'Ana',
        contactPhone: '(11) 98888-7777',
        contactEmail: null,
        contactBirthDate: '1990-02-28',
        description: null,
        sellerPersonId: SELLER_ID,
      },
    });
    expect(input('lead-phone').value).toBe('(11) 98888-7777');

    await typeInto(input('lead-phone'), '');
    await click(saveButton());

    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      id: LEAD_ID,
      contactName: 'Ana',
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: '1990-02-28',
      description: null,
      clientId: null,
      clientName: null,
      estimatedValueBrl: 0,
      sellerPersonId: SELLER_ID,
    });
  });

  it('titles create and edit', async () => {
    await renderDialog();
    expect(dialogNode().textContent).toContain('Novo lead');

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderDialog({
      initial: {
        id: LEAD_ID,
        contactName: 'Ana',
        contactPhone: null,
        contactEmail: null,
        contactBirthDate: null,
        description: null,
        sellerPersonId: null,
      },
    });
    expect(dialogNode().textContent).toContain('Editar lead');
    expect(dialogNode().textContent).not.toContain('Novo lead');
  });

  it('Escape on the open vendedor picker closes only the picker', async () => {
    const { onOpenChange } = await renderDialog();
    await click(sellerTrigger());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    await escape(comboboxSearch());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Positive control: the real Radix dialog does close on a bare Escape.
    await escape(sellerTrigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('names the vendedor picker and the close button for assistive technology (D-07.1e)', async () => {
    await renderDialog();
    expect(sellerTrigger().getAttribute('aria-label')).toBe('Vendedor responsável');
    const close = [...dialogNode().querySelectorAll('button')].find(
      (node) => node.getAttribute('aria-label') === 'Fechar',
    );
    expect(close).toBeDefined();
  });

  it('hides the vendedor and sends no sellerPersonId key when the picker is not offered (D-07.1b)', async () => {
    const { onSubmit } = await renderDialog({ showSellerPicker: false });
    // The Cliente picker still renders; only the vendedor one is hidden.
    expect(
      dialogNode().querySelector('[role="combobox"][aria-label="Vendedor responsável"]'),
    ).toBeNull();
    expect(dialogNode().textContent).not.toContain('Vendedor responsável');

    await typeInto(input('lead-contact-name'), 'Ana');
    await click(saveButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      contactName: 'Ana',
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
      description: null,
      clientId: null,
      clientName: null,
      estimatedValueBrl: 0,
    });
  });

  it('an edit without the picker leaves the stored vendedor out of the payload', async () => {
    const { onSubmit } = await renderDialog({
      showSellerPicker: false,
      initial: {
        id: LEAD_ID,
        contactName: 'Ana',
        contactPhone: null,
        contactEmail: null,
        contactBirthDate: null,
        description: null,
        sellerPersonId: SELLER_ID,
      },
    });
    await click(saveButton());
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      id: LEAD_ID,
      contactName: 'Ana',
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
      description: null,
      clientId: null,
      clientName: null,
      estimatedValueBrl: 0,
    });
  });

  it('a rejected save keeps the dialog open with the typed values and an inline error (D-07.1c)', async () => {
    const onSubmit = vi.fn(() => Promise.reject({ status: 403, error: 'forbidden' }));
    const { onOpenChange } = await renderDialog({ onSubmit });
    await typeInto(input('lead-contact-name'), 'Ana Construbom');
    await typeInto(input('lead-phone'), '(11) 98888-7777');

    await click(saveButton());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(input('lead-contact-name').value).toBe('Ana Construbom');
    expect(input('lead-phone').value).toBe('(11) 98888-7777');
    expect(dialogNode().querySelector('[data-lead-save-error]')?.textContent).toBe(
      'Não foi possível salvar o lead. Tente novamente.',
    );
    expect(saveButton().disabled).toBe(false);
  });

  it('a 400 no_open_stage keeps the dialog open with the no-etapa copy', async () => {
    const onSubmit = vi.fn(() =>
      Promise.reject({ status: 400, error: 'validation_error', reason: 'no_open_stage' }),
    );
    const { onOpenChange } = await renderDialog({ onSubmit });
    await typeInto(input('lead-contact-name'), 'Ana');
    await click(saveButton());

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(dialogNode().querySelector('[data-lead-save-error]')?.textContent).toBe(
      'Nenhuma etapa ativa no funil. O lead não foi salvo.',
    );
  });

  it('closes only once the save resolves', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { onOpenChange } = await renderDialog({ onSubmit });
    await typeInto(input('lead-contact-name'), 'Ana');
    await click(saveButton());
    expect(onOpenChange).not.toHaveBeenCalled();
    // A second click while the request is in flight sends nothing.
    expect(saveButton().disabled).toBe(true);

    await act(async () => resolve({ lead: {} }));
    await settle();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dialogNode().querySelector('[data-lead-save-error]')).toBeNull();
  });

  it('never renders a raw seller id', async () => {
    await renderDialog({
      initial: {
        id: LEAD_ID,
        contactName: 'Ana',
        contactPhone: null,
        contactEmail: null,
        contactBirthDate: null,
        description: null,
        sellerPersonId: SELLER_TWO,
      },
    });
    const text = dialogNode().textContent ?? '';
    expect(text).toContain('Rafael Lima');
    for (const id of [SELLER_ID, SELLER_TWO, SELLER_THREE, LEAD_ID]) {
      expect(text).not.toContain(id);
    }
  });
});
