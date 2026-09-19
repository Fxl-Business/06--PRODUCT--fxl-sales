// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDialog } from '../LeadDialog';

/**
 * The lead create / edit dialog, driven through the REAL `Dialog` and the REAL
 * `Combobox`.
 *
 * Two boundaries these oracles exist to hold: a lead NEVER creates a cadastro
 * row of any kind (no create row on the cliente picker, and the free-product
 * path writes a snapshot with no id), and the dialog DERIVES no seller list of
 * its own - it renders exactly the options it is handed.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const CLIENT_ID = 'c0000000-0000-4000-8000-000000000001';
const PRODUCT_ID = 'e0000000-0000-4000-8000-000000000001';
const SELLER_ID = 'd0000000-0000-4000-8000-000000000001';
const SELLER_TWO = 'd0000000-0000-4000-8000-000000000002';
const SELLER_THREE = 'd0000000-0000-4000-8000-000000000003';

const CLIENTS = [{ value: CLIENT_ID, label: 'Acme Indústria' }];
const PRODUCTS = [{ value: PRODUCT_ID, label: 'FXL Custom' }];
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

async function typeInto(field: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

function buttonWithText(text: string): HTMLButtonElement {
  const match = [...dialogNode().querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  );
  if (!match) throw new Error(`button not found: ${text}`);
  return match;
}

function comboboxTriggers(): HTMLButtonElement[] {
  return [...dialogNode().querySelectorAll('[role="combobox"]')].filter(
    (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
  );
}

function optionRows(): HTMLElement[] {
  return [...document.querySelectorAll('[role="listbox"] [role="option"]')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

async function pick(index: number, label: string) {
  const trigger = comboboxTriggers()[index];
  if (!trigger) throw new Error(`no combobox at index ${index}`);
  await click(trigger);
  const row = optionRows().find((node) => node.textContent?.trim() === label);
  if (!row) throw new Error(`option "${label}" not offered`);
  await click(row);
}

type Overrides = Partial<React.ComponentProps<typeof LeadDialog>>;

async function renderDialog(overrides: Overrides = {}) {
  const onSubmit = vi.fn();
  await act(async () => {
    root.render(
      <LeadDialog
        clients={CLIENTS}
        initial={null}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        products={PRODUCTS}
        sellers={SELLERS}
        {...overrides}
      />,
    );
  });
  await settle();
  return { onSubmit };
}

describe('LeadDialog', () => {
  it('offers no create row on the cliente picker', async () => {
    await renderDialog();

    const trigger = comboboxTriggers()[0];
    if (!trigger) throw new Error('cliente picker missing');
    await click(trigger);
    const search = document.querySelector('[role="listbox"]')?.parentElement?.querySelector(
      'input[type="text"]',
    );
    if (!(search instanceof HTMLInputElement)) throw new Error('search field missing');
    await typeInto(search, 'Empresa que não existe');

    // A lead never creates a `sales_ops_clients` row; the resolve-or-create
    // happens at conversion time.
    expect(document.querySelector('[data-combobox-create]')).toBeNull();
  });

  it('keeps a free-text company when no cliente is picked', async () => {
    const { onSubmit } = await renderDialog();

    await typeInto(input('lead-contact-name'), 'Ana Paula');
    await typeInto(input('lead-company-text'), 'Beta Serviços');
    await click(buttonWithText('Salvar'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      contactName: 'Ana Paula',
      clientId: null,
      clientName: 'Beta Serviços',
    });
  });

  it('adds a free product line with a null productId and its typed name', async () => {
    const { onSubmit } = await renderDialog();

    await typeInto(input('lead-contact-name'), 'Ana Paula');
    await typeInto(input('lead-company-text'), 'Beta Serviços');
    await typeInto(input('lead-free-product'), 'Integração X');
    await click(buttonWithText('+ Adicionar item livre'));
    await click(buttonWithText('Salvar'));

    // The snapshot convention: no catalog id is invented for a free line.
    expect(onSubmit.mock.calls[0]?.[0].products).toEqual([{ productName: 'Integração X' }]);
  });

  it('renders exactly the sellers it is given and derives none itself', async () => {
    await renderDialog();

    const triggers = comboboxTriggers();
    const sellerTrigger = triggers[triggers.length - 1];
    if (!sellerTrigger) throw new Error('vendedor picker missing');
    await click(sellerTrigger);

    expect(optionRows().map((node) => node.textContent?.trim())).toEqual([
      'Marina Souza',
      'Rafael Lima',
      'Paula Reis',
    ]);
  });

  it('offers no etapa picker at all, because the API assigns the stage', async () => {
    // RECONCILED against the shipped `CreateLeadSchema`, which is `.strict()` and
    // declares no `stageId`: a new lead always lands in the first active normal
    // stage, so a card born converted or lost is not expressible rather than
    // merely rejected. A picker here could only offer a value nothing reads.
    const { onSubmit } = await renderDialog();

    expect(dialogNode().textContent).not.toContain('Etapa');

    await typeInto(input('lead-contact-name'), 'Ana Paula');
    await typeInto(input('lead-company-text'), 'Beta Serviços');
    await click(buttonWithText('Salvar'));

    expect(Object.keys(onSubmit.mock.calls[0]?.[0] ?? {})).not.toContain('stageId');
  });

  it('blocks Salvar with a blank contact name', async () => {
    const { onSubmit } = await renderDialog();

    await typeInto(input('lead-company-text'), 'Beta Serviços');

    expect(buttonWithText('Salvar').disabled).toBe(true);
    expect(dialogNode().querySelector('[data-lead-blocked]')).not.toBeNull();
    await click(buttonWithText('Salvar'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('names the estimated value as an estimate and submits integer cents', async () => {
    const { onSubmit } = await renderDialog();

    expect(dialogNode().textContent).toContain('Valor estimado (R$)');

    await typeInto(input('lead-contact-name'), 'Ana Paula');
    await typeInto(input('lead-company-text'), 'Beta Serviços');
    await typeInto(input('lead-estimated-value'), '1234.56');
    await click(buttonWithText('Salvar'));

    expect(onSubmit.mock.calls[0]?.[0].estimatedValueBrl).toBe(123456);
  });

  it('never renders a raw identifier', async () => {
    await renderDialog({
      initial: {
        id: 'aaaaaaaa-0000-4000-8000-000000000009',
        contactName: 'Ana Paula',
        clientId: CLIENT_ID,
        clientName: 'Acme Indústria',
        estimatedValueBrl: 100_000,
        description: null,
        sellerPersonId: SELLER_ID,
        products: [{ productId: PRODUCT_ID }],
      },
    });

    const rendered = dialogNode().textContent ?? '';
    for (const id of [
      CLIENT_ID,
      PRODUCT_ID,
      SELLER_ID,
      'aaaaaaaa-0000-4000-8000-000000000009',
    ]) {
      expect(rendered).not.toContain(id);
    }
  });

  it('picks a cliente and sends its id alongside the resolved name', async () => {
    const { onSubmit } = await renderDialog();

    await typeInto(input('lead-contact-name'), 'Ana Paula');
    await pick(0, 'Acme Indústria');
    expect(input('lead-company-text').disabled).toBe(true);
    await click(buttonWithText('Salvar'));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      clientId: CLIENT_ID,
      // REQUIRED by the API's `clientName` (min 1); the server overwrites it
      // from the cadastro row anyway.
      clientName: 'Acme Indústria',
    });
  });
});
