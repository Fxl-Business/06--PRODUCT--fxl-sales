// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVANCE_COPY } from '../advance';
import { AdvanceDialog, type AdvanceDialogProps } from '../AdvanceDialog';
import type { LeadNextStage } from '../crm-types';

const TODAY = '2026-10-20';
const NORMAL: LeadNextStage = { id: 'stage-prop', name: 'Proposta enviada', type: 'normal', exitKind: null, requiresReason: false };
const CONVERSION: LeadNextStage = { id: 'stage-orc', name: 'Orçamento', type: 'orcamento', exitKind: null, requiresReason: false };
const GANHO: LeadNextStage = { id: 'stage-ganho', name: 'Ganho', type: 'saida', exitKind: 'ganho', requiresReason: false };
const PERDIDO: LeadNextStage = { id: 'stage-perdido', name: 'Perdido', type: 'saida', exitKind: 'perdido', requiresReason: true };

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}
async function click(element: Element) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await settle();
}
function dialogNode(): Element {
  const node = document.querySelector('[role="dialog"]');
  if (!node) throw new Error('dialog not rendered');
  return node;
}
async function openPicker(): Promise<string[]> {
  const trigger = dialogNode().querySelector('[role="combobox"]');
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('combobox trigger not found');
  await click(trigger);
  return [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((node) => node.textContent?.trim() ?? '');
}
async function pick(label: string) {
  const row = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((node) => node.textContent?.trim() === label);
  if (!row) throw new Error(`option "${label}" not offered`);
  await click(row);
}
function typeInto(id: string, value: string) {
  const node = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!node) throw new Error(`missing ${id}`);
  const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
}
const confirm = () => dialogNode().querySelector<HTMLButtonElement>('[data-advance-confirm]')!;

async function mount(overrides: Partial<AdvanceDialogProps> = {}) {
  const props: AdvanceDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    leadName: 'Ana Souza',
    nextStages: [NORMAL, CONVERSION, GANHO],
    opensConversionIds: new Set([CONVERSION.id]),
    today: TODAY,
    onSubmit: vi.fn(async () => ({})),
    onConvert: vi.fn(async () => true),
    ...overrides,
  };
  root = createRoot(container);
  await act(async () => root?.render(<AdvanceDialog {...props} />));
  await settle();
  return props;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
});

describe('AdvanceDialog', () => {
  it('the destination picker lists exactly the given next stages', async () => {
    await mount();
    expect(await openPicker()).toEqual(['Proposta enviada', 'Orçamento', 'Ganho']);
  });

  it('a normal stage reveals the next step and date, and Avançar waits for both', async () => {
    const props = await mount();
    await openPicker();
    await pick('Proposta enviada');
    expect(document.getElementById('advance-next-step')).not.toBeNull();
    expect((document.getElementById('advance-due-on') as HTMLInputElement).getAttribute('min')).toBe(TODAY);
    expect(confirm().disabled).toBe(true);

    typeInto('advance-next-step', 'Ligar');
    expect(confirm().disabled).toBe(true);
    typeInto('advance-due-on', '2026-10-25');
    await settle();
    expect(confirm().disabled).toBe(false);

    await click(confirm());
    expect(props.onSubmit).toHaveBeenCalledWith({ toStageId: NORMAL.id, nextStep: 'Ligar', dueOn: '2026-10-25' });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('an exit hides the follow-up fields and enables Avançar at once', async () => {
    await mount();
    await openPicker();
    await pick('Ganho');
    expect(document.getElementById('advance-next-step')).toBeNull();
    expect(confirm().disabled).toBe(false);
  });

  it('a lost exit that requires a reason stays blocked until the reason is typed', async () => {
    await mount({ nextStages: [PERDIDO] });
    await openPicker();
    await pick('Perdido');
    expect(document.getElementById('advance-reason')).not.toBeNull();
    expect(confirm().disabled).toBe(true);
    typeInto('advance-reason', 'Preço');
    await settle();
    expect(confirm().disabled).toBe(false);
  });

  it('a conversion stage shows the hint, hides the fields and calls onConvert, never onSubmit', async () => {
    const props = await mount();
    await openPicker();
    await pick('Orçamento');
    expect(dialogNode().textContent).toContain(ADVANCE_COPY.conversionHint);
    expect(document.getElementById('advance-next-step')).toBeNull();
    await click(confirm());
    expect(props.onConvert).toHaveBeenCalledWith(CONVERSION);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it('a refused advance keeps the dialog open with the copy and the typed values', async () => {
    const props = await mount({
      onSubmit: vi.fn(async () => {
        throw { status: 409, error: 'transition_not_allowed' };
      }),
    });
    await openPicker();
    await pick('Proposta enviada');
    typeInto('advance-next-step', 'Ligar');
    typeInto('advance-due-on', '2026-10-25');
    await settle();
    await click(confirm());

    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(dialogNode().querySelector('[data-advance-error]')?.textContent).toBe(ADVANCE_COPY.notAllowed);
    expect((document.getElementById('advance-next-step') as HTMLInputElement).value).toBe('Ligar');
  });
});
