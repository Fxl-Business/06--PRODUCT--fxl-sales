// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Label } from '../label';
import { Combobox, type ComboboxProps } from '../combobox';
import type { ComboboxOption } from '../combobox-filter';

/**
 * Behavioural oracle for the Combobox primitive. The panel is inline and
 * non-portalled by design, so every assertion here is a plain DOM query against
 * the render container - nothing is mocked away.
 */
const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const OPTIONS: ComboboxOption[] = [
  { value: 'v1', label: 'Valéria', description: 'Clínica de Psicologia', group: 'Contatos' },
  { value: 'v2', label: 'Vinícius', group: 'Contatos' },
  { value: 'v3', label: 'Bruno', description: 'Bruno Consultoria', group: 'Empresas' },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

type RenderProps = Partial<Omit<ComboboxProps, 'onChange' | 'onCreate'>> & {
  withCreate?: boolean;
};

async function renderCombobox(props: RenderProps = {}) {
  const { withCreate, ...rest } = props;
  const onChange = vi.fn();
  const onCreate = vi.fn();
  await act(async () => {
    root.render(
      <Combobox
        options={OPTIONS}
        value={null}
        onChange={onChange}
        {...(withCreate ? { onCreate } : {})}
        {...rest}
      />,
    );
  });
  return { onChange, onCreate };
}

function trigger(): HTMLButtonElement {
  const el = container.querySelector('[role="combobox"]');
  if (!(el instanceof HTMLButtonElement)) throw new Error('trigger not found');
  return el;
}

function panelSearch(): HTMLInputElement {
  const el = container.querySelector('input[type="text"]');
  if (!(el instanceof HTMLInputElement)) throw new Error('search field not found');
  return el;
}

function listbox(): HTMLElement | null {
  const el = container.querySelector('[role="listbox"]');
  return el instanceof HTMLElement ? el : null;
}

function optionRows(): HTMLElement[] {
  return [...container.querySelectorAll('[role="option"]')].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
}

function row(index: number): HTMLElement {
  const rows = optionRows();
  const el = rows[index];
  if (!el) throw new Error(`option row ${index} not found (have ${rows.length})`);
  return el;
}

function createRow(): HTMLElement | null {
  const el = container.querySelector('[data-combobox-create="true"]');
  return el instanceof HTMLElement ? el : null;
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function type(value: string) {
  const input = panelSearch();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(el: Element, k: string): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  await act(async () => {
    el.dispatchEvent(event);
  });
  return event;
}

async function open() {
  await click(trigger());
}

function activeDescendant(): string | null {
  return panelSearch().getAttribute('aria-activedescendant');
}

describe('Combobox', () => {
  it('renders a closed trigger with the placeholder and no listbox', async () => {
    await renderCombobox();

    expect(trigger().getAttribute('role')).toBe('combobox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().hasAttribute('aria-controls')).toBe(false);
    expect(trigger().textContent).toContain('Selecionar...');
    expect(listbox()).toBeNull();
  });

  it('renders the selected option label on the trigger', async () => {
    await renderCombobox({ value: 'v1' });

    expect(trigger().textContent).toContain('Valéria');
    expect(trigger().textContent).not.toContain('Selecionar...');
    expect(trigger().hasAttribute('data-placeholder')).toBe(false);
  });

  it('falls back to valueLabel when the value matches no option', async () => {
    await renderCombobox({ value: 'novo-1', valueLabel: 'Cliente Novo' });

    expect(trigger().textContent).toContain('Cliente Novo');
  });

  it('opens on trigger click, focuses the search field and wires aria-controls', async () => {
    await renderCombobox();
    await open();

    const panel = listbox();
    expect(panel).not.toBeNull();
    expect(panel!.id.endsWith('-listbox')).toBe(true);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(panel!.id);
    expect(document.activeElement).toBe(panelSearch());
    expect(optionRows()).toHaveLength(3);
    // Every option must live inside the listbox it is controlled by.
    for (const optionRow of optionRows()) expect(panel!.contains(optionRow)).toBe(true);
  });

  it('opens on ArrowDown, Enter and Space from the trigger', async () => {
    await renderCombobox();

    for (const k of ['ArrowDown', 'Enter', ' ']) {
      await key(trigger(), k);
      expect(listbox(), `expected ${k} to open the panel`).not.toBeNull();
      await key(panelSearch(), 'Escape');
      expect(listbox()).toBeNull();
    }
  });

  it('filters options ignoring case and diacritics', async () => {
    await renderCombobox();
    await open();

    await type('valeria');
    expect(optionRows()).toHaveLength(1);
    expect(row(0).textContent).toContain('Valéria');

    await type('VINI');
    expect(optionRows()).toHaveLength(1);
    expect(row(0).textContent).toContain('Vinícius');

    // The secondary description line is searchable too.
    await type('psicologia');
    expect(optionRows()).toHaveLength(1);
    expect(row(0).textContent).toContain('Valéria');

    await type('');
    expect(optionRows()).toHaveLength(3);
  });

  it('renders group headings and the secondary description line', async () => {
    await renderCombobox();
    await open();

    const panel = listbox();
    expect(panel!.textContent).toContain('Contatos');
    expect(panel!.textContent).toContain('Empresas');
    expect(panel!.textContent).toContain('Clínica de Psicologia');

    const groups = [...panel!.querySelectorAll('[role="group"]')];
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      const headingId = group.getAttribute('aria-labelledby');
      expect(headingId).toBeTruthy();
      // getElementById, not a selector: React.useId ids contain colons.
      const heading = document.getElementById(headingId!);
      expect(heading).not.toBeNull();
      expect(panel!.contains(heading)).toBe(true);
      expect(heading!.textContent).toBeTruthy();
    }

    expect(optionRows()).toHaveLength(3);
  });

  it('shows the create row with the typed query when nothing matches', async () => {
    await renderCombobox({ withCreate: true, entityLabel: 'contato' });
    await open();
    await type('adsad');

    expect(createRow()).not.toBeNull();
    expect(createRow()!.textContent!.trim()).toBe('+ Criar novo contato "adsad"');
    expect(optionRows()).toHaveLength(1);
    expect(row(0)).toBe(createRow());

    // The acceptance criterion says the create row is rendered INSIDE the
    // listbox and IS the active descendant. A role="option" outside its owning
    // listbox is an orphan, and aria-activedescendant may only reference an
    // element inside the controlled listbox, so both halves are load-bearing.
    expect(listbox()!.contains(createRow())).toBe(true);
    expect(activeDescendant()).toBe(createRow()!.id);
  });

  it('uses feminine agreement when entityGender is f', async () => {
    await renderCombobox({ withCreate: true, entityLabel: 'área', entityGender: 'f' });
    await open();
    await type('Jurídico');

    expect(createRow()!.textContent!.trim()).toBe('+ Criar nova área "Jurídico"');
  });

  it('keeps the create row visible below the filtered options when some match', async () => {
    await renderCombobox({ withCreate: true, entityLabel: 'contato' });
    await open();
    await type('Val');

    expect(optionRows()).toHaveLength(2);
    expect(row(0).textContent).toContain('Valéria');
    expect(row(1)).toBe(createRow());
    // Pinned footer: inside the listbox, but outside the scrollable options
    // area, so it stays on screen however long the option list gets.
    const scrollArea = listbox()!.querySelector('.overflow-y-auto');
    expect(scrollArea).not.toBeNull();
    expect(scrollArea!.contains(createRow())).toBe(false);
    // Positive control for the line above. Without it the negative would also pass if
    // the scroll area stopped existing, or if no row were inside it at all.
    expect(scrollArea!.contains(row(0))).toBe(true);
    expect(createRow()!.closest('.overflow-y-auto')).toBeNull();
    expect(listbox()!.contains(createRow())).toBe(true);
  });

  it('hands onCreate the trimmed query, not the raw input value', async () => {
    const { onChange, onCreate } = await renderCombobox({
      withCreate: true,
      entityLabel: 'contato',
    });
    await open();
    await type('  Maria  ');

    // The label the operator reads is already trimmed, and so is the committed value.
    expect(createRow()!.textContent!.trim()).toBe('+ Criar novo contato "Maria"');
    expect(panelSearch().value).toBe('  Maria  ');

    await click(createRow()!);

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith('Maria');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('hides the create row when the query exactly matches an existing option label', async () => {
    await renderCombobox({ withCreate: true, entityLabel: 'contato' });
    await open();

    await type('Valéria');
    expect(createRow()).toBeNull();
    expect(optionRows()).toHaveLength(1);

    await type('  valéria  ');
    expect(createRow()).toBeNull();
    expect(optionRows()).toHaveLength(1);
  });

  it('shows the create row when the query differs from an option only by an accent', async () => {
    await renderCombobox({ withCreate: true, entityLabel: 'contato' });
    await open();
    await type('Valeria');

    expect(createRow()).not.toBeNull();
    expect(optionRows()).toHaveLength(2);
    expect(row(0).textContent).toContain('Valéria');
  });

  it('hides the create row when the query is empty or whitespace only', async () => {
    await renderCombobox({ withCreate: true, entityLabel: 'contato' });
    await open();
    await type('   ');

    expect(createRow()).toBeNull();
    expect(optionRows()).toHaveLength(3);
  });

  it('shows the empty state instead of a create row when onCreate is absent', async () => {
    await renderCombobox();
    await open();
    await type('zzz');

    expect(listbox()!.textContent).toContain('Nenhum resultado encontrado.');
    expect(createRow()).toBeNull();
    expect(optionRows()).toHaveLength(0);
  });

  it('selects an option with the mouse, closes the panel and restores focus', async () => {
    const { onChange } = await renderCombobox();
    await open();
    await click(row(1));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('v2');
    expect(listbox()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
  });

  it('moves the active row with ArrowDown and ArrowUp and reflects it in aria-activedescendant', async () => {
    const { onChange } = await renderCombobox();
    await open();

    expect(activeDescendant()).toBe(row(0).id);

    await key(panelSearch(), 'ArrowDown');
    await key(panelSearch(), 'ArrowDown');
    expect(activeDescendant()).toBe(row(2).id);
    expect(row(2).getAttribute('data-active')).toBe('true');
    expect(row(0).hasAttribute('data-active')).toBe(false);
    expect(row(1).hasAttribute('data-active')).toBe(false);

    await key(panelSearch(), 'ArrowUp');
    expect(activeDescendant()).toBe(row(1).id);

    await key(panelSearch(), 'Enter');
    expect(onChange).toHaveBeenCalledWith('v2');
    expect(listbox()).toBeNull();
  });

  it('wraps the active row at both ends', async () => {
    await renderCombobox();
    await open();

    await key(panelSearch(), 'ArrowUp');
    expect(activeDescendant()).toBe(row(2).id);

    await key(panelSearch(), 'ArrowDown');
    expect(activeDescendant()).toBe(row(0).id);
  });

  it('starts with the selected option active when reopening', async () => {
    await renderCombobox({ value: 'v3' });
    await open();

    const bruno = optionRows().find((row) => row.textContent?.includes('Bruno'));
    expect(bruno).toBeDefined();
    expect(activeDescendant()).toBe(bruno!.id);
  });

  it('selects the create row with Enter when it is the active row', async () => {
    const { onChange, onCreate } = await renderCombobox({
      withCreate: true,
      entityLabel: 'cliente',
    });
    await open();
    await type('Cliente Novo');

    expect(optionRows()).toHaveLength(1);
    expect(row(0)).toBe(createRow());
    // Enter commits whatever aria-activedescendant announces, so the create row
    // being the announced row is what makes this keystroke predictable.
    expect(activeDescendant()).toBe(createRow()!.id);

    await key(panelSearch(), 'Enter');

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith('Cliente Novo');
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on Escape without selecting and stops the event from reaching an ancestor', async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn();
    const ancestorKeyDown = vi.fn();
    await act(async () => {
      root.render(
        <div onKeyDown={ancestorKeyDown}>
          <Combobox
            entityLabel="contato"
            onChange={onChange}
            onCreate={onCreate}
            options={OPTIONS}
            value={null}
          />
        </div>,
      );
    });

    await open();
    await type('Val');
    ancestorKeyDown.mockClear();

    const event = await key(panelSearch(), 'Escape');

    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
    expect(ancestorKeyDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('closes on outside mousedown without changing the value', async () => {
    const { onChange } = await renderCombobox();
    await open();
    expect(listbox()).not.toBeNull();

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Tab without selecting and lets focus move on', async () => {
    const { onChange } = await renderCombobox();
    await open();

    const event = await key(panelSearch(), 'Tab');

    expect(listbox()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('never submits a surrounding form on Enter', async () => {
    const submitSpy = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <form onSubmit={submitSpy}>
          <Combobox onChange={onChange} options={OPTIONS} value={null} />
        </form>,
      );
    });

    await open();
    await type('zzz');
    expect(optionRows()).toHaveLength(0);

    const event = await key(panelSearch(), 'Enter');

    expect(submitSpy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('resets the query and the active row on every open', async () => {
    await renderCombobox();
    await open();
    await type('valeria');
    await key(panelSearch(), 'Escape');

    await open();

    expect(panelSearch().value).toBe('');
    expect(optionRows()).toHaveLength(3);
    expect(activeDescendant()).toBe(row(0).id);
  });

  it('opens on a trigger keydown when enabled', async () => {
    // Control for the disabled test below: it establishes that this exact
    // interaction is capable of opening the panel, so the disabled test's
    // absence assertion means something.
    await renderCombobox();

    const event = await key(trigger(), 'ArrowDown');

    expect(listbox()).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not open when disabled, and lets the key through instead of swallowing it', async () => {
    await renderCombobox({ disabled: true });

    expect(trigger().disabled).toBe(true);

    // A programmatic click on a disabled button never reaches React's handler,
    // so clicking alone would assert the browser's behaviour rather than ours.
    // A keydown does reach the handler, which is what exercises the guard.
    const event = await key(trigger(), 'ArrowDown');

    expect(listbox()).toBeNull();
    // A disabled control must not consume ArrowDown: the keystroke has to stay
    // available to the page (scrolling, an ancestor's own key handling).
    expect(event.defaultPrevented).toBe(false);

    await open();
    expect(listbox()).toBeNull();
  });

  it('closes an open panel when the trigger is clicked again', async () => {
    const { onChange } = await renderCombobox();

    await open();
    expect(listbox()).not.toBeNull();

    // The trigger toggles, per the WAI-ARIA combobox pattern: without this a
    // mouse user has no obvious way to dismiss the panel.
    await click(trigger());

    expect(listbox()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('takes its accessible name from a Label through htmlFor and forwards aria-labelledby', async () => {
    const onChange = vi.fn();
    await act(async () => {
      root.render(
        <>
          <Label htmlFor="cliente-cb" id="cliente-cb-label">
            Cliente
          </Label>
          <Combobox
            aria-labelledby="cliente-cb-label"
            id="cliente-cb"
            onChange={onChange}
            options={OPTIONS}
            value={null}
          />
        </>,
      );
    });

    expect(trigger().id).toBe('cliente-cb');
    expect(container.querySelector('label[for="cliente-cb"]')!.textContent).toBe('Cliente');
    expect(trigger().getAttribute('aria-labelledby')).toBe('cliente-cb-label');

    await open();

    expect(listbox()!.getAttribute('aria-labelledby')).toBe('cliente-cb');
    expect(panelSearch().getAttribute('aria-label')).toBe('Buscar...');
    expect(panelSearch().getAttribute('aria-autocomplete')).toBe('list');
  });

  it('matches the Input box styling and lets a caller className win', async () => {
    await renderCombobox();

    for (const token of [
      'h-10',
      'w-full',
      'rounded-md',
      'border-input',
      'bg-background',
      'text-sm',
      'ring-offset-background',
      'focus-visible:ring-2',
      'data-[placeholder]:text-muted-foreground',
    ]) {
      expect(trigger().className, `missing ${token}`).toContain(token);
    }

    await renderCombobox({
      className: 'h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] pr-9',
    });

    const merged = trigger().className;
    for (const token of ['h-11', 'rounded-[10px]', 'border-[#dcdce2]', 'bg-[#fafafb]', 'pr-9']) {
      expect(merged, `missing ${token}`).toContain(token);
    }
    for (const token of ['h-10', 'rounded-md', 'border-input', 'bg-background']) {
      expect(merged, `should have been displaced: ${token}`).not.toContain(token);
    }
  });
});
