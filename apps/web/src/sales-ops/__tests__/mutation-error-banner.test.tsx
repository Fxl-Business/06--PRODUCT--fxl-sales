// @vitest-environment happy-dom

/**
 * PC23: a 403 on a financial MUTATION is a refused action, not a refused app. It
 * renders `MutationErrorBanner` on the current screen and never `ForbiddenPanel`.
 */
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORBIDDEN_COPY } from '../forbidden-copy';
import { MutationErrorBanner } from '../MutationErrorBanner';
import { MUTATION_ERROR_COPY, salesOpsMutationErrorMessage } from '../mutation-error-copy';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

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
  vi.clearAllMocks();
});

describe('salesOpsMutationErrorMessage', () => {
  it('maps a 403 to the admin-required copy', () => {
    expect(salesOpsMutationErrorMessage({ error: 'forbidden', status: 403 })).toBe(
      MUTATION_ERROR_COPY.adminRequired,
    );
  });

  it('keys the 403 on the status, not the body code', () => {
    expect(salesOpsMutationErrorMessage({ error: 'something_else', status: 403 })).toBe(
      MUTATION_ERROR_COPY.adminRequired,
    );
  });

  it('maps a 409 sale_has_active_settlements to the settlements copy', () => {
    expect(
      salesOpsMutationErrorMessage({ error: 'sale_has_active_settlements', status: 409, rows: [] }),
    ).toBe(MUTATION_ERROR_COPY.saleHasActiveSettlements);
  });

  it('falls back to the generic copy for any other failure', () => {
    expect(salesOpsMutationErrorMessage({ error: 'request_failed', status: 500 })).toBe(
      MUTATION_ERROR_COPY.generic,
    );
    expect(salesOpsMutationErrorMessage(new Error('x'))).toBe(MUTATION_ERROR_COPY.generic);
  });
});

describe('MutationErrorBanner', () => {
  it('renders nothing without an error', async () => {
    await act(async () => root.render(<MutationErrorBanner error={null} onDismiss={vi.fn()} />));

    expect(container.innerHTML).toBe('');
  });

  it('renders the admin copy as an alert and never the forbidden panel', async () => {
    await act(async () =>
      root.render(
        <MutationErrorBanner error={{ error: 'forbidden', status: 403 }} onDismiss={vi.fn()} />,
      ),
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(MUTATION_ERROR_COPY.adminRequired);
    expect(container.querySelector('[data-forbidden]')).toBeNull();
    expect(container.textContent).not.toContain(FORBIDDEN_COPY.title);
  });

  it('renders the given lines as a list under the message', async () => {
    await act(async () =>
      root.render(
        <MutationErrorBanner
          error={{ error: 'sale_has_active_settlements', status: 409 }}
          lines={['Parcela 1/3', 'Comissão do vendedor · Ana Martins']}
          onDismiss={vi.fn()}
        />,
      ),
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(MUTATION_ERROR_COPY.saleHasActiveSettlements);
    const items = [...(alert?.querySelectorAll('[data-mutation-error-lines] li') ?? [])];
    expect(items.map((node) => node.textContent)).toEqual([
      'Parcela 1/3',
      'Comissão do vendedor · Ana Martins',
    ]);
  });

  it('renders no list for empty lines', async () => {
    await act(async () =>
      root.render(
        <MutationErrorBanner error={{ error: 'forbidden', status: 403 }} lines={[]} onDismiss={vi.fn()} />,
      ),
    );

    expect(container.querySelector('[data-mutation-error-lines]')).toBeNull();
  });

  it('calls onDismiss from the close button', async () => {
    const onDismiss = vi.fn();
    await act(async () =>
      root.render(
        <MutationErrorBanner error={{ error: 'forbidden', status: 403 }} onDismiss={onDismiss} />,
      ),
    );

    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${MUTATION_ERROR_COPY.dismiss}"]`,
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
