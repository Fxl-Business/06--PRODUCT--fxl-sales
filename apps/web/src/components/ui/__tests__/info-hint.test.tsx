// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InfoHint } from '../info-hint';

/**
 * Behavioural oracle for the InfoHint primitive. Like `Combobox`, the panel is
 * inline and non-portalled by design, so every assertion here is a plain DOM
 * query against the render container - nothing is mocked away.
 */
const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

/** The real step-3 call site copy, so this test also documents a production string. */
const HINT_TEXT =
  'Aloque os profissionais do projeto e ajuste os percentuais - a margem líquida e as comissões são calculadas em tempo real.';

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
  vi.restoreAllMocks();
});

async function renderHint(options: { onWrapperKeyDown?: (event: unknown) => void } = {}) {
  await act(async () => {
    root.render(
      <div onKeyDown={options.onWrapperKeyDown}>
        <InfoHint label="Profissionais alocados">{HINT_TEXT}</InfoHint>
      </div>,
    );
  });
}

function trigger(): HTMLButtonElement {
  const match = container.querySelector('button');
  if (!(match instanceof HTMLButtonElement)) throw new Error('trigger not found');
  return match;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function keyDown(element: Element, key: string) {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

async function mouseDown(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
}

describe('InfoHint', () => {
  it('renders a labelled trigger and keeps the hint out of the layout until asked', async () => {
    await renderHint();

    expect(trigger().getAttribute('aria-label')).toBe(
      'Mais informações sobre Profissionais alocados',
    );
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('type')).toBe('button');
    // The whole point of the slice: the sentence is not on screen on first paint.
    expect(container.textContent).not.toContain(HINT_TEXT);
  });

  it('reveals the hint on click and wires aria-controls to the panel it opened', async () => {
    await renderHint();

    await click(trigger());

    expect(container.textContent).toContain(HINT_TEXT);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const panelId = trigger().getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(container.querySelector(`[id="${panelId}"]`)?.textContent).toContain(HINT_TEXT);
  });

  it('points aria-controls at nothing while closed, because an absent id is invalid', async () => {
    await renderHint();

    expect(trigger().getAttribute('aria-controls')).toBeNull();
  });

  it('dismisses on a second click, on Escape and on an outside click', async () => {
    await renderHint();

    await click(trigger());
    await click(trigger());
    expect(container.textContent).not.toContain(HINT_TEXT);

    await click(trigger());
    trigger().focus();
    await keyDown(trigger(), 'Escape');
    expect(container.textContent).not.toContain(HINT_TEXT);
    expect(document.activeElement).toBe(trigger());

    await click(trigger());
    await mouseDown(document.body);
    expect(container.textContent).not.toContain(HINT_TEXT);
  });

  it('opens from a focused trigger, because a mouse is not the only pointer', async () => {
    await renderHint();

    trigger().focus();
    expect(document.activeElement).toBe(trigger());
    // A real <button> turns Enter/Space into a click event, so asserting the click
    // path from a focused trigger is the honest keyboard assertion here.
    await click(trigger());

    expect(container.textContent).toContain(HINT_TEXT);
  });

  /**
   * Scoped honestly: this proves Escape does not reach a React handler ABOVE the
   * hint. It says NOTHING about a surrounding Radix Dialog, whose Escape
   * listener is a document capture-phase one that no React handler can pre-empt.
   * That case is the whole subject of `inline-layer-escape.test.tsx`, which
   * drives a real `Dialog`; a wrapper spy like this one passes either way and
   * would have hidden the bug.
   */
  it('does not bubble its Escape to a React handler above it', async () => {
    const onWrapperKeyDown = vi.fn();
    await renderHint({ onWrapperKeyDown });

    await click(trigger());
    await keyDown(trigger(), 'Escape');

    expect(container.textContent).not.toContain(HINT_TEXT);
    expect(onWrapperKeyDown).not.toHaveBeenCalled();
  });

  it('lets every other key through, so only Escape is intercepted', async () => {
    const onWrapperKeyDown = vi.fn();
    await renderHint({ onWrapperKeyDown });

    await keyDown(trigger(), 'Tab');

    expect(onWrapperKeyDown).toHaveBeenCalledTimes(1);
  });
});
