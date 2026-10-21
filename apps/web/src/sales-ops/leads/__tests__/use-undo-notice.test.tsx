// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNDO_CONFLICT, UndoConflictError } from '../undo-conflict';
import { UndoLayer } from '../UndoLayer';
import { useUndoNotice, type UndoNoticeApi } from '../use-undo-notice';

const restoreMutate = vi.hoisted(() => vi.fn());
vi.mock('../deleted-leads', () => ({ useRestoreLead: () => ({ mutateAsync: restoreMutate }) }));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;
const handle = { current: null as UndoNoticeApi | null };

function Harness() {
  const undo = useUndoNotice();
  React.useEffect(() => {
    handle.current = undo;
  });
  return <UndoLayer undo={undo} />;
}

async function render() {
  root = createRoot(container);
  await act(async () => root?.render(<Harness />));
}

const notice = () => container.querySelector<HTMLElement>('[data-undo-notice]');
const undoButton = () => container.querySelector<HTMLButtonElement>('[data-undo-action]');
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  handle.current = null;
  restoreMutate.mockReset();
  vi.useRealTimers();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('useUndoNotice', () => {
  it('publish shows a notice with the label and an enabled Desfazer', async () => {
    await render();
    await act(async () => handle.current?.publish('Lead movido', async () => undefined));
    expect(notice()?.textContent).toContain('Lead movido');
    expect(undoButton()?.disabled).toBe(false);
  });

  it('run calls the undo once and clears the notice on success', async () => {
    await render();
    const undo = vi.fn(async () => undefined);
    await act(async () => handle.current?.publish('Lead editado', undo));
    await act(async () => { void handle.current?.run(); void handle.current?.run(); });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
    expect(alertText()).toBeNull();
  });

  it('a rejected undo keeps the notice, re-enables the button and shows the retry copy', async () => {
    await render();
    await act(async () => handle.current?.publish('Lead movido', async () => { throw new Error('boom'); }));
    await act(async () => { await handle.current?.run(); });
    expect(notice()).not.toBeNull();
    expect(undoButton()?.disabled).toBe(false);
    expect(alertText()).toBe('Não foi possível desfazer. Tente novamente.');
  });

  it('an UndoConflictError shows UNDO_CONFLICT', async () => {
    await render();
    await act(async () => handle.current?.publish('Lead movido', async () => { throw new UndoConflictError(UNDO_CONFLICT); }));
    await act(async () => { await handle.current?.run(); });
    expect(alertText()).toBe(UNDO_CONFLICT);
  });

  it('the notice expires after about five seconds and the timer is cleared on unmount', async () => {
    vi.useFakeTimers();
    await render();
    await act(async () => handle.current?.publish('Lead movido', async () => undefined));
    await act(async () => { vi.advanceTimersByTime(4900); });
    expect(notice()).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(notice()).toBeNull();
    await act(async () => handle.current?.publish('Lead movido', async () => undefined));
    await act(async () => root?.unmount());
    root = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishRestore renders the restore notice and run(restore) awaits the given restore', async () => {
    await render();
    restoreMutate.mockResolvedValue(undefined);
    await act(async () => handle.current?.publishRestore('lead-9'));
    expect(notice()?.textContent).toContain('Lead excluído');
    await act(async () => { await undoButton()?.click(); });
    expect(restoreMutate).toHaveBeenCalledWith('lead-9');
    expect(notice()).toBeNull();
  });
});
