// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDevIdentitySwitcher, type DevIdentityOption } from '../dev-identity-switcher';

const HOST_SELECTOR = '#fxl-sales-dev-identity-switcher';

function host(): HTMLElement {
  const element = document.querySelector(HOST_SELECTOR);
  if (!(element instanceof HTMLElement)) throw new Error('switcher host not found');
  return element;
}

function pillButton(): HTMLButtonElement {
  const button = host().querySelector('[data-testid="dev-identity-pill"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('pill button not found');
  return button;
}

function panel(): HTMLElement {
  const element = host().querySelector('[data-testid="dev-identity-panel"]');
  if (!(element instanceof HTMLElement)) throw new Error('panel not found');
  return element;
}

function expand(): void {
  pillButton().click();
}

function row(id: string): HTMLElement {
  const element = panel().querySelector(`[data-identity-id="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`row not found for ${id}`);
  return element;
}

const IDENTITIES: DevIdentityOption[] = [
  { id: 'team-owner', label: 'Ana (dona da organizacao)', exercises: 'papel owner: acesso total' },
  { id: 'no-access', label: 'Heitor (sem acesso)', exercises: 'organizacao sem acesso: 402' },
];

afterEach(() => {
  document.querySelector(HOST_SELECTOR)?.remove();
  document.body.innerHTML = '';
});

describe('mountDevIdentitySwitcher', () => {
  it('lists the whole roster with its human label and the branch it exercises', () => {
    mountDevIdentitySwitcher(IDENTITIES, 'team-owner', vi.fn());
    expand();

    const text = panel().textContent ?? '';
    for (const identity of IDENTITIES) {
      expect(text).toContain(identity.label);
      expect(text).toContain(identity.exercises);
    }
  });

  it('calls onSelect with the chosen identity id', () => {
    const onSelect = vi.fn();
    mountDevIdentitySwitcher(IDENTITIES, 'team-owner', onSelect);
    expand();

    row('no-access').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith('no-access');
  });

  it('mounts once, so a hot reload does not stack copies', () => {
    mountDevIdentitySwitcher(IDENTITIES, 'team-owner', vi.fn());
    mountDevIdentitySwitcher(IDENTITIES, 'no-access', vi.fn());

    expect(document.querySelectorAll(HOST_SELECTOR).length).toBe(1);
  });

  it('filters on the exercises line as well as the label', () => {
    mountDevIdentitySwitcher(IDENTITIES, 'team-owner', vi.fn());
    expand();

    const search = panel().querySelector('input');
    if (!(search instanceof HTMLInputElement)) throw new Error('search input not found');

    search.value = '402';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    const text = panel().querySelector('[data-testid="dev-identity-list"]')?.textContent ?? '';
    expect(text).toContain('Heitor (sem acesso)');
    expect(text).not.toContain('Ana (dona da organizacao)');
  });
});

describe('switchDevIdentity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    try {
      localStorage.removeItem('fxl-sales.dev-identity');
    } catch {
      // ignore
    }
  });

  it('stores the id under fxl-sales.dev-identity and reloads', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, origin: 'http://localhost:8006' });

    const { switchDevIdentity } = await import('../install-dev-identity');
    switchDevIdentity('team-owner');

    expect(localStorage.getItem('fxl-sales.dev-identity')).toBe('team-owner');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads when localStorage refuses the write', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload, origin: 'http://localhost:8006' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage refused');
    });

    const { switchDevIdentity } = await import('../install-dev-identity');
    expect(() => switchDevIdentity('team-owner')).not.toThrow();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
