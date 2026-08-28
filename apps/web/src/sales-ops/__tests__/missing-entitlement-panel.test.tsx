// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingEntitlementPanel } from '../MissingEntitlementPanel';
import { MISSING_ENTITLEMENT_COPY } from '../missing-entitlement-copy';

/**
 * The ONE mock this file needs. The panel reads the Organization seam from
 * `@/auth/react` and takes only `onRetry` as a prop, so the whole surface is
 * drivable from plain objects and `vi.fn()`: no live Hub, no network, no
 * QueryClientProvider, no router.
 */
type Organization = { id: string; name?: string; products?: string[] };

type Seam = {
  active: Organization | null;
  activeName: string | undefined;
  organizations: Organization[];
  others: Organization[];
  setActive: ReturnType<typeof vi.fn>;
  client: { checkoutUrl: ReturnType<typeof vi.fn> };
};

let seam: Seam;

vi.mock('@/auth/react', () => ({
  useOrganizations: () => seam,
}));

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const orgAtiva: Organization = { id: 'org-active', name: 'Acme Holding' };
const orgAlfa: Organization = { id: 'org-alfa', name: 'Alfa Consultoria' };
const orgBeta: Organization = { id: 'org-beta', name: 'Beta Engenharia' };
const orgSemNome: Organization = { id: 'org-sem-nome' };

const CHECKOUT_HREF = 'https://hub.example/checkout/sales';

let container: HTMLDivElement;
let root: Root;
let reloadSpy: ReturnType<typeof vi.fn>;

/**
 * `others` and `activeName` are DERIVED here exactly as the real seam derives them,
 * so a fixture can never present a combination the live hook could not produce.
 * A test that needs the degenerate token overrides them explicitly.
 */
function makeSeam(overrides: Partial<Seam> = {}): Seam {
  const active = 'active' in overrides ? (overrides.active ?? null) : orgAtiva;
  const organizations = overrides.organizations ?? [orgAtiva, orgAlfa, orgBeta];
  return {
    active,
    activeName: 'activeName' in overrides ? overrides.activeName : active?.name,
    organizations,
    others:
      overrides.others ?? organizations.filter((org) => org.id !== active?.id),
    setActive: overrides.setActive ?? vi.fn().mockResolvedValue(undefined),
    client: overrides.client ?? {
      checkoutUrl: vi.fn().mockResolvedValue(CHECKOUT_HREF),
    },
  };
}

function mountContainer() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
}

beforeEach(() => {
  seam = makeSeam();
  mountContainer();
  reloadSpy = vi.fn();
  Object.defineProperty(window.location, 'reload', {
    configurable: true,
    value: reloadSpy,
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function renderPanel(props: { onRetry?: () => void } = {}) {
  await act(async () => {
    root.render(<MissingEntitlementPanel {...props} />);
  });
  await flushReact();
}

function section(): HTMLElement {
  const match = container.querySelector('[data-missing-entitlement]');
  if (!(match instanceof HTMLElement)) throw new Error('panel section not found');
  return match;
}

function sectionText(): string {
  return section().textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

function optionRows(): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"]')];
}

function optionRow(index: number): HTMLElement {
  const row = optionRows()[index];
  if (!row) throw new Error(`option row not found: ${index}`);
  return row;
}

function checkoutAnchor(): HTMLAnchorElement | null {
  const match = container.querySelector('[data-hub-checkout] a');
  return match instanceof HTMLAnchorElement ? match : null;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flushReact();
}

async function openPicker() {
  await click(comboboxTrigger(MISSING_ENTITLEMENT_COPY.switchAriaLabel));
}

describe('MissingEntitlementPanel - honest copy', () => {
  it('names the active Organization in the panel copy', async () => {
    await renderPanel();
    expect(sectionText()).toContain(MISSING_ENTITLEMENT_COPY.activePrefix);
    expect(sectionText()).toContain('Acme Holding');
    expect(sectionText()).not.toContain('Verifique o servidor local');
  });

  it('names the active Organization from the name claim when the token carries no id', async () => {
    seam = makeSeam({ active: null, activeName: 'Acme Holding' });
    await renderPanel();
    expect(sectionText()).toContain(MISSING_ENTITLEMENT_COPY.activePrefix);
    expect(sectionText()).toContain('Acme Holding');
    expect(sectionText()).not.toContain(MISSING_ENTITLEMENT_COPY.activeUnknown);
  });

  it('says the Organization could not be identified when neither an id nor a name is known', async () => {
    seam = makeSeam({ active: null, activeName: undefined });
    await renderPanel();
    expect(sectionText()).toContain(MISSING_ENTITLEMENT_COPY.activeUnknown);
  });

  it('never renders the word workspace in user facing copy', async () => {
    await renderPanel();
    expect(sectionText().toLowerCase()).not.toContain('workspace');
  });
});

describe('MissingEntitlementPanel - the switch offer', () => {
  it('lists the account other Organizations and never the active one', async () => {
    await renderPanel();
    await openPicker();
    const labels = optionRows().map((row) => row.textContent?.trim() ?? '');
    expect(labels).toEqual(['Alfa Consultoria', 'Beta Engenharia']);
    for (const label of labels) {
      expect(label).not.toContain('Acme Holding');
      expect(label).not.toContain('org-active');
    }
  });

  it('switches with setActive using the chosen Organization id and never reloads the page', async () => {
    await renderPanel();
    await openPicker();
    const beta = optionRows().find((row) => row.textContent?.includes('Beta Engenharia'));
    expect(beta).toBeTruthy();
    await click(beta as HTMLElement);
    expect(seam.setActive).toHaveBeenCalledTimes(1);
    expect(seam.setActive).toHaveBeenCalledWith('org-beta');
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it('calls onRetry after a successful switch and never before', async () => {
    const order: string[] = [];
    seam = makeSeam({
      setActive: vi.fn(() => {
        order.push('setActive:call');
        return Promise.resolve().then(() => {
          order.push('setActive:resolve');
        });
      }),
    });
    const onRetry = vi.fn(() => {
      order.push('onRetry');
    });
    await renderPanel({ onRetry });
    await openPicker();
    await click(optionRow(0));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['setActive:call', 'setActive:resolve', 'onRetry']);
  });

  it('switches without an onRetry prop and does not throw', async () => {
    await renderPanel();
    await openPicker();
    await click(optionRow(0));
    expect(seam.setActive).toHaveBeenCalledTimes(1);
    expect(seam.setActive).toHaveBeenCalledWith('org-alfa');
  });

  it('reports an honest error when setActive rejects and does not refetch', async () => {
    seam = makeSeam({ setActive: vi.fn().mockRejectedValue(new Error('403')) });
    const onRetry = vi.fn();
    await renderPanel({ onRetry });
    await openPicker();
    await click(optionRow(0));
    expect(sectionText()).toContain(MISSING_ENTITLEMENT_COPY.switchFailed);
    expect(onRetry).not.toHaveBeenCalled();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        `button[role="combobox"][aria-label="${MISSING_ENTITLEMENT_COPY.switchAriaLabel}"]`,
      ),
    ).not.toBeNull();
  });

  it('offers a direct switch button when the account has exactly one other Organization', async () => {
    seam = makeSeam({ organizations: [orgAtiva, orgAlfa] });
    await renderPanel();
    expect(container.querySelector('button[role="combobox"]')).toBeNull();
    const direct = container.querySelector('button[aria-label="Trocar para Alfa Consultoria"]');
    expect(direct).toBeInstanceOf(HTMLButtonElement);
    expect(direct?.textContent).toContain(MISSING_ENTITLEMENT_COPY.switchSinglePrefix.trim());
    expect(direct?.textContent).toContain('Alfa Consultoria');
    await click(direct as HTMLElement);
    expect(seam.setActive).toHaveBeenCalledWith('org-alfa');
  });

  it('renders no picker at all when there is no other Organization and still offers the Hub checkout', async () => {
    seam = makeSeam({ organizations: [orgAtiva] });
    await renderPanel();
    expect(container.querySelector('[data-organization-switch]')).toBeNull();
    expect(
      container.querySelectorAll('[role="listbox"], [role="option"], button[role="combobox"]'),
    ).toHaveLength(0);
    expect(sectionText()).toContain(MISSING_ENTITLEMENT_COPY.leadWithoutOthers);
    expect(checkoutAnchor()?.getAttribute('href')).toBe(CHECKOUT_HREF);
  });

  it('keeps the raw Organization id on the muted secondary line of every picker row', async () => {
    seam = makeSeam({ organizations: [orgAtiva, orgSemNome, orgAlfa] });
    await renderPanel();
    await openPicker();
    const row = optionRows().find((candidate) => candidate.textContent?.includes('org-sem-nome'));
    expect(row).toBeTruthy();
    const muted = row?.querySelector('.text-muted-foreground');
    expect(muted?.textContent?.trim()).toBe('org-sem-nome');
  });

  it('styles a fallback active Organization label as muted monospace', async () => {
    seam = makeSeam({ active: orgSemNome, organizations: [orgSemNome, orgAlfa] });
    await renderPanel();
    const label = section().querySelector('[data-active-organization]');
    expect(label).toBeTruthy();
    expect(label?.className).toContain('font-mono');
    expect(label?.className).toContain('text-muted-foreground');
    expect(label?.textContent?.trim()).toBe('org-sem-nome');
  });
});

describe('MissingEntitlementPanel - the Hub checkout', () => {
  it('resolves the Hub checkout href through client.checkoutUrl', async () => {
    await renderPanel();
    const anchor = checkoutAnchor();
    expect(anchor?.textContent?.trim()).toBe(MISSING_ENTITLEMENT_COPY.checkoutLink);
    expect(anchor?.getAttribute('href')).toBe(CHECKOUT_HREF);
    expect(seam.client.checkoutUrl).toHaveBeenCalledTimes(1);
  });

  it('renders a skeleton, never an empty state, while the Hub checkout link is resolving', async () => {
    let resolveHref: (href: string) => void = () => {};
    const deferred = new Promise<string>((resolve) => {
      resolveHref = resolve;
    });
    seam = makeSeam({ client: { checkoutUrl: vi.fn().mockReturnValue(deferred) } });
    await renderPanel();

    const loading = container.querySelector('[data-hub-checkout="loading"]');
    expect(loading).toBeTruthy();
    expect(loading?.querySelector('.animate-pulse')).toBeTruthy();
    expect(loading?.textContent).toContain(MISSING_ENTITLEMENT_COPY.checkoutLoading);
    expect(loading?.querySelector('a')).toBeNull();

    await act(async () => {
      resolveHref(CHECKOUT_HREF);
      await deferred;
    });
    await flushReact();
    expect(checkoutAnchor()?.getAttribute('href')).toBe(CHECKOUT_HREF);
  });

  it('degrades honestly when client.checkoutUrl rejects and renders no dead link', async () => {
    seam = makeSeam({
      client: { checkoutUrl: vi.fn().mockRejectedValue(new Error('discovery failed')) },
    });
    await renderPanel();
    expect(sectionText()).toContain(MISSING_ENTITLEMENT_COPY.checkoutFailed);
    expect(checkoutAnchor()).toBeNull();
  });

  it('retries the Hub checkout discovery when Tentar novamente is clicked', async () => {
    const checkoutUrl = vi
      .fn()
      .mockRejectedValueOnce(new Error('discovery failed'))
      .mockResolvedValueOnce(CHECKOUT_HREF);
    seam = makeSeam({ client: { checkoutUrl } });
    await renderPanel();
    expect(sectionText()).toContain(MISSING_ENTITLEMENT_COPY.checkoutFailed);

    await click(buttonByText(MISSING_ENTITLEMENT_COPY.checkoutRetry));
    expect(checkoutUrl).toHaveBeenCalledTimes(2);
    expect(checkoutAnchor()?.getAttribute('href')).toBe(CHECKOUT_HREF);
  });
});

describe('MissingEntitlementPanel - source invariants', () => {
  it('contains no page reload, no native picker and no dash characters in its source', () => {
    /*
      Built with `node:path` rather than `new URL(relative, import.meta.url)`:
      happy-dom replaces the global `URL`, and its resolution ignores a `file:` base,
      yielding `http://localhost:3000/...` and a `fileURLToPath` throw.
    */
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'MissingEntitlementPanel.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/location\s*\.\s*reload/);
    expect(source).not.toMatch(/<\s*(select|option|datalist)\b/);
    expect(source).not.toMatch(new RegExp('[\\u2014\\u2013]'));

    /* The copy lives one module over, so the dash ban has to follow it there. */
    const copy = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'missing-entitlement-copy.ts'),
      'utf8',
    );
    expect(copy).not.toMatch(new RegExp('[\\u2014\\u2013]'));
  });
});
