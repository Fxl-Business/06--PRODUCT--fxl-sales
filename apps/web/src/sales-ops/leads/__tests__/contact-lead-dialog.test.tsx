// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactLeadDialog } from '../ContactLeadDialog';

/**
 * The leads edition's contact dialog, driven through the REAL `Dialog` and the
 * REAL `Combobox`. It asks for contact data only and sends the six-key
 * `ContactLeadPayload`; empresa, produtos and valor do not exist here.
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
  const node = dialogNode().querySelector('[role="combobox"]');
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
  it('renders exactly the six contact fields, in order', async () => {
    await renderDialog();
    const labels = [...dialogNode().querySelectorAll('label, [id="lead-seller-label"]')].map(
      (node) => node.textContent?.trim(),
    );
    expect(labels).toEqual([
      'Nome *',
      'Data de aniversário',
      'Número (telefone/WhatsApp)',
      'Email',
      'Descrição',
      'Vendedor responsável',
    ]);
  });

  it('has no empresa, produtos, valor or numeric input', async () => {
    await renderDialog();
    const text = dialogNode().textContent ?? '';
    for (const banned of ['Empresa', 'Produtos', 'Valor estimado', 'R$']) {
      expect(text).not.toContain(banned);
    }
    expect(dialogNode().querySelector('input[type="number"]')).toBeNull();
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
    expect(blockedText()).toBe('Informe o nome.');

    await typeInto(input('lead-contact-name'), 'Ana');
    expect(saveButton().disabled).toBe(false);
    expect(blockedText()).toBeNull();
  });

  it('blocks a future birthday and accepts today', async () => {
    await renderDialog();
    await typeInto(input('lead-contact-name'), 'Ana');

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

  it('sends the six-key payload and closes', async () => {
    const { onSubmit, onOpenChange } = await renderDialog();
    await typeInto(input('lead-contact-name'), 'Ana Construbom');
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
      sellerPersonId: SELLER_TWO,
    });
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
