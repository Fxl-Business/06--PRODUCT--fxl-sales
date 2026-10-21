// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERIOD_ALL_SELECTION, PERIOD_COPY, type PeriodSelection } from '../period';
import { PeriodFilter } from '../PeriodFilter';

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

async function render(value: PeriodSelection, onChange = vi.fn(), presets?: Parameters<typeof PeriodFilter>[0]['presets']) {
  await act(async () => {
    root.render(<PeriodFilter onChange={onChange} presets={presets} value={value} />);
  });
  await settle();
  return onChange;
}

function trigger(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Período"]');
  if (!el) throw new Error('period trigger missing');
  return el;
}

async function pickOption(label: string) {
  await click(trigger());
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
    node.textContent?.includes(label),
  );
  if (!option) throw new Error(`option ${label} missing`);
  await click(option);
}

describe('PeriodFilter', () => {
  it('renders a Combobox trigger named Período and no native select', async () => {
    await render(PERIOD_ALL_SELECTION);
    expect(container.querySelector('select')).toBeNull();
    expect(trigger().textContent).toContain('Todo o período');
  });

  it('choosing Personalizado asks for the custom preset', async () => {
    const onChange = await render(PERIOD_ALL_SELECTION);
    await pickOption('Personalizado');
    expect(onChange).toHaveBeenCalledWith({ preset: 'custom', from: '', to: '' });
  });

  it('shows De and Até date inputs for the custom preset', async () => {
    await render({ preset: 'custom', from: '2026-10-01', to: '2026-10-10' });
    expect(container.querySelector('input[type="date"][aria-label="De"]')).not.toBeNull();
    expect(container.querySelector('input[type="date"][aria-label="Até"]')).not.toBeNull();
  });

  it('typing a reversed range shows the inline error and the control reports it', async () => {
    await render({ preset: 'custom', from: '2026-10-20', to: '2026-10-01' });
    const error = container.querySelector('[data-period-error]');
    expect(error?.textContent).toBe(PERIOD_COPY.invalid);
  });

  it('a preset other than custom shows no date inputs and no error', async () => {
    await render({ preset: 'last7', from: '', to: '' });
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(container.querySelector('[data-period-error]')).toBeNull();
  });

  it('offers only the presets it is given', async () => {
    await render(PERIOD_ALL_SELECTION, vi.fn(), ['all', 'next7']);
    await click(trigger());
    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
  });
});
