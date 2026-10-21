// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowupsView, type FollowupsViewProps } from '../FollowupsView';
import { PERIOD_ALL_SELECTION } from '../../period';
import { FOLLOWUP_COPY } from '../followups';
import type { FollowupListRow } from '../crm-types';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;

const ROWS: FollowupListRow[] = [
  { id: 'fu-1', leadId: 'lead-1', leadContactName: 'Ana Souza', nextStep: 'Ligar', dueOn: '2026-10-19', ownerName: 'Marina', doneAt: null },
  { id: 'fu-2', leadId: 'lead-2', leadContactName: 'Bruno Lima', nextStep: 'Mandar tabela', dueOn: '2026-10-21', ownerName: null, doneAt: null },
  { id: 'fu-3', leadId: 'lead-3', leadContactName: 'Carla', nextStep: 'Já feito', dueOn: '2026-10-10', ownerName: null, doneAt: '2026-10-10T10:00:00.000Z' },
];

function props(overrides: Partial<FollowupsViewProps> = {}): FollowupsViewProps {
  return {
    rows: ROWS,
    today: '2026-10-20',
    scope: 'team',
    onScopeChange: vi.fn(),
    showScopeToggle: true,
    status: 'open',
    onStatusChange: vi.fn(),
    period: PERIOD_ALL_SELECTION,
    onPeriodChange: vi.fn(),
    onOpenLead: vi.fn(),
    onMarkDone: vi.fn(),
    ...overrides,
  };
}

async function render(next: FollowupsViewProps) {
  root = createRoot(container);
  await act(async () => root?.render(<FollowupsView {...next} />));
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}
const q = (selector: string) => container.querySelector<HTMLElement>(selector);

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

describe('FollowupsView', () => {
  it('renders the rows with their due state, and a done row has no Concluir', async () => {
    await render(props());
    expect(q('[data-followup-row="fu-1"] [data-followup-state]')?.textContent).toBe('Atrasado');
    expect(q('[data-followup-row="fu-2"] [data-followup-state]')?.textContent).toBe('Agendado');
    expect(q('[data-followup-row="fu-3"] [data-followup-done]')).toBeNull();
    expect(q('[data-followup-row="fu-3"]')?.textContent).toContain(FOLLOWUP_COPY.doneBadge);
    expect(container.textContent).not.toContain('fu-1');
  });

  it('shows the scope toggle only when offered, and aria-pressed follows the scope', async () => {
    await render(props({ scope: 'mine', showScopeToggle: true }));
    expect(q('[data-followup-scope="mine"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-followup-scope="team"]')?.getAttribute('aria-pressed')).toBe('false');

    await render(props({ showScopeToggle: false }));
    expect(q('[data-followup-scope="team"]')).toBeNull();
  });

  it('Concluir calls onMarkDone with the id, and the lead name calls onOpenLead', async () => {
    const next = props();
    await render(next);
    await click(q('[data-followup-done="fu-2"]')!);
    expect(next.onMarkDone).toHaveBeenCalledWith('fu-2');
    await click(q('[data-followup-open-lead="lead-1"]')!);
    expect(next.onOpenLead).toHaveBeenCalledWith('lead-1');
  });

  it('the status picker and the period filter are Comboboxes, never a native select', async () => {
    await render(props());
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelectorAll('[role="combobox"]').length).toBeGreaterThanOrEqual(2);
  });

  it('shows the empty copy when there are no rows', async () => {
    await render(props({ rows: [] }));
    expect(container.textContent).toContain(FOLLOWUP_COPY.empty);
  });
});
