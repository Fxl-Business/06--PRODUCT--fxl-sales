// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsFuncao } from '../../types';
import type { CrmPipeline } from '../crm-types';
import { PIPELINE_SETTINGS_COPY } from '../pipeline-settings';
import { PipelinesPanel } from '../PipelinesPanel';

/**
 * The funções picker of the pipeline dialog inside the REAL `Dialog` (the same trap as
 * `advance-dialog-inline-layer.test.tsx`): Escape on the open picker puts the picker away and
 * leaves the dialog open; the positive control proves Escape would close the dialog otherwise.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const PIPELINE: CrmPipeline = {
  id: 'p0000001-0000-4000-8000-000000000001',
  name: 'Comercial',
  isDefault: true,
  position: 0,
  status: 'active',
  funcaoIds: [],
  stages: [],
  transitions: [],
};

const FINANCEIRO: SalesOpsFuncao = {
  id: 'f0000001-0000-4000-8000-000000000001',
  orgId: 'org',
  name: 'Financeiro',
  slug: 'financeiro',
  isSystem: false,
  status: 'active',
  createdAt: '',
  updatedAt: null,
};

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

function funcoesTrigger(): HTMLButtonElement {
  const match = document.querySelector(`[role="dialog"] button[aria-label="${PIPELINE_SETTINGS_COPY.funcoesLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error('funções picker not found');
  return match;
}

describe('Escape inside the pipeline dialog', () => {
  it('puts the funções picker away and keeps the dialog open', async () => {
    await act(async () => {
      root.render(
        <PipelinesPanel
          funcoes={[FINANCEIRO]}
          onSavePipeline={vi.fn(async () => PIPELINE)}
          onSelect={vi.fn()}
          pipelines={[PIPELINE]}
          selectedId={PIPELINE.id}
        />,
      );
    });
    const newButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === PIPELINE_SETTINGS_COPY.newAction,
    );
    await click(newButton!);
    expect(document.querySelector('[data-pipeline-form]')).not.toBeNull();

    await click(funcoesTrigger());
    const search = document.querySelector('[role="listbox"]')?.parentElement?.querySelector('input[type="text"]');
    expect(search).toBeInstanceOf(HTMLInputElement);
    await escape(search!);

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.querySelector('[data-pipeline-form]')).not.toBeNull();

    // POSITIVE CONTROL: with no inline layer open, Escape reaches the real Dialog and closes it.
    await escape(funcoesTrigger());
    expect(document.querySelector('[data-pipeline-form]')).toBeNull();
  });
});
