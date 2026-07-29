// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsClient } from '../types';

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

import { ClientDialog } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const client = (patch: Partial<SalesOpsClient> = {}): SalesOpsClient => ({
  id: '11111111-1111-4111-8111-111111111111',
  orgId: 'org-test',
  name: 'SegPro',
  contact: 'contato@segpro.com',
  legalName: 'SegPro Serviços Ltda',
  document: '12.345.678/0001-90',
  address: 'Rua das Flores, 100, São Paulo - SP',
  legalRepName: 'João da Silva',
  legalRepDocument: '123.456.789-00',
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

async function renderDialog(existing?: SalesOpsClient, onSave = vi.fn()) {
  await act(async () => {
    root.render(
      <ClientDialog
        modal={{ kind: 'client', client: existing }}
        onClose={vi.fn()}
        onSave={onSave}
        saving={false}
      />,
    );
  });
  return onSave;
}

function labeledInput(label: string): HTMLInputElement {
  const match = container.querySelector(`input[aria-label="${label}"]`);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${label}`);
  return match;
}

function contactInput(): HTMLInputElement {
  const match = container.querySelector('input[placeholder="e-mail ou telefone"]');
  if (!(match instanceof HTMLInputElement)) throw new Error('contact input not found');
  return match;
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
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}

describe('client dialog legal fields', () => {
  it('submits the five legal fields alongside name and contact', async () => {
    const onSave = await renderDialog();

    const nameInput = container.querySelector('input') as HTMLInputElement;
    await change(nameInput, 'Nova Empresa');
    await change(contactInput(), 'contato@nova.com');
    await change(labeledInput('Razão social'), 'Nova Empresa Ltda');
    await change(labeledInput('CNPJ/CPF'), '98.765.432/0001-10');
    await change(labeledInput('Endereço'), 'Av. Central, 200, Rio de Janeiro - RJ');
    await change(labeledInput('Representante legal'), 'Maria Souza');
    await change(labeledInput('CPF do representante'), '987.654.321-00');
    await submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Nova Empresa',
        contact: 'contato@nova.com',
        legalName: 'Nova Empresa Ltda',
        document: '98.765.432/0001-10',
        address: 'Av. Central, 200, Rio de Janeiro - RJ',
        legalRepName: 'Maria Souza',
        legalRepDocument: '987.654.321-00',
      }),
    );
  });

  it('rehydrates legal fields when editing an existing client', async () => {
    await renderDialog(client());

    expect(labeledInput('Razão social').value).toBe('SegPro Serviços Ltda');
    expect(labeledInput('CNPJ/CPF').value).toBe('12.345.678/0001-90');
    expect(labeledInput('Endereço').value).toBe('Rua das Flores, 100, São Paulo - SP');
    expect(labeledInput('Representante legal').value).toBe('João da Silva');
    expect(labeledInput('CPF do representante').value).toBe('123.456.789-00');
  });

  it('sends null for cleared legal fields', async () => {
    const onSave = await renderDialog(client());

    await change(labeledInput('Razão social'), '');
    await submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        legalName: null,
        document: '12.345.678/0001-90',
      }),
    );
  });
});
