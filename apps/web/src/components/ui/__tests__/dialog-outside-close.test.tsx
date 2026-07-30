// @vitest-environment happy-dom

import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prop-contract half of this slice's oracle, complementing - never replacing -
 * the behavioural outside-pointerdown tests in
 * `dialog-close-affordances.test.tsx`. Those are the ones that prove the
 * acceptance criterion; these pin two properties they cannot observe: that the
 * guards really are `preventDefault`-ing handlers rather than dismissal
 * happening to be inert for some other reason, and that a call site's own
 * `onPointerDownOutside` is dropped rather than composed, so the post-spread
 * ordering in `dialog.tsx` cannot be defeated.
 *
 * The trade-off is explicit: mocking `@radix-ui/react-dialog` couples these
 * five tests to Radix prop *names*, so an upstream rename would leave them
 * green. The behavioural file is what catches that, which is exactly why it
 * exists alongside this one.
 */
const captured: { props: Record<string, unknown> | null } = { props: null };

vi.mock('@radix-ui/react-dialog', () => {
  const passthrough = (name: string) => {
    const Component = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
    Component.displayName = name;
    return Component;
  };

  const Content = ({ children, ...props }: { children?: ReactNode }) => {
    captured.props = props as Record<string, unknown>;
    return <div>{children}</div>;
  };
  Content.displayName = 'DialogContent';

  const Close = ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  );
  Close.displayName = 'DialogClose';

  return {
    Root: passthrough('DialogRoot'),
    Trigger: passthrough('DialogTrigger'),
    Portal: passthrough('DialogPortal'),
    Close,
    Overlay: passthrough('DialogOverlay'),
    Content,
    Title: passthrough('DialogTitle'),
    Description: passthrough('DialogDescription'),
  };
});

// Must be a dynamic import: a static one is hoisted above `captured`, so the
// mock factory would run inside its temporal dead zone and throw.
const { Dialog, DialogContent, DialogTitle } = await import('../dialog');

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  captured.props = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderDialog(extraProps: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      <Dialog open>
        <DialogContent
          {...(extraProps as unknown as React.ComponentPropsWithoutRef<typeof DialogContent>)}
        >
          <DialogTitle>Titulo</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
  });
  const { props } = captured;
  if (!props) throw new Error('Radix content props were not captured');
  return props;
}

function fakeEvent() {
  return { defaultPrevented: false, preventDefault: vi.fn() } as unknown as Event & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

function handler(props: Record<string, unknown>, name: string) {
  const value = props[name];
  if (typeof value !== 'function') throw new Error(`${name} is not a function`);
  return value as (event: Event) => void;
}

describe('DialogContent outside-interaction contract', () => {
  it('passes a preventDefault-ing onPointerDownOutside to the Radix content', async () => {
    const props = await renderDialog();

    expect(typeof props.onPointerDownOutside).toBe('function');

    const event = fakeEvent();
    handler(props, 'onPointerDownOutside')(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('passes a preventDefault-ing onInteractOutside to the Radix content', async () => {
    const props = await renderDialog();

    expect(typeof props.onInteractOutside).toBe('function');

    const event = fakeEvent();
    handler(props, 'onInteractOutside')(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  /**
   * Escape is intercepted CONDITIONALLY, and the condition is the whole point:
   * it is spent on an open inline layer (a `Combobox` panel, an `InfoHint`) if
   * there is one, and otherwise falls through to the dialog, which is the
   * affordance this file's header comment says stays working. The behavioural
   * proof of both halves is `inline-layer-escape.test.tsx`; what is pinned here
   * is that the handler exists and defaults to NOT intercepting.
   */
  it('leaves the Escape key alone when no inline layer is open', async () => {
    const props = await renderDialog();

    expect(typeof props.onEscapeKeyDown).toBe('function');

    const event = fakeEvent();
    handler(props, 'onEscapeKeyDown')(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a call-site attempt to take over Escape', async () => {
    const callSiteHandler = vi.fn();
    const props = await renderDialog({ onEscapeKeyDown: callSiteHandler });

    handler(props, 'onEscapeKeyDown')(fakeEvent());

    expect(callSiteHandler).not.toHaveBeenCalled();
  });

  it('labels the close affordance in pt-BR', async () => {
    await renderDialog();

    expect(container.textContent).toContain('Fechar');
    expect(container.textContent).not.toContain('Close');
  });

  it('ignores a call-site attempt to re-enable outside dismissal', async () => {
    const callSiteHandler = vi.fn();
    const props = await renderDialog({ onPointerDownOutside: callSiteHandler });

    const event = fakeEvent();
    handler(props, 'onPointerDownOutside')(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(callSiteHandler).not.toHaveBeenCalled();
  });
});
