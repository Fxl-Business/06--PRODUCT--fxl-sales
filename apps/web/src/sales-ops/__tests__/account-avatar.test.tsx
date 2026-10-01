// @vitest-environment happy-dom

import * as React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountAvatar } from '../AccountAvatar';

/**
 * The ONE account avatar shared by the three account surfaces: the sales ops shell,
 * `MissingEntitlementPanel` and `NoRolePage`. The render cases pin the tile's
 * behaviour; the source cases pin that exactly one implementation exists, that each
 * surface imports it, and that the module imports none of them (no cycle).
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const webSrc = path.resolve(__dirname, '../..');
const readSource = (relative: string) => readFileSync(path.join(webSrc, relative), 'utf8');

const TILE_CLASS =
  'sales-ops-num flex size-10 flex-none items-center justify-center overflow-hidden rounded-[11px] bg-[#eaa81a] text-[14px] font-bold text-[#18181b]';

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
});

async function render(element: React.ReactElement) {
  if (!root) root = createRoot(container);
  await act(async () => root?.render(element));
}

function tile() {
  return container.querySelector('[data-account-avatar]');
}

describe('AccountAvatar', () => {
  it('renders the decorative avatar image inside the 40px amber tile', async () => {
    await render(<AccountAvatar avatarUrl="https://cdn.example/ana.png" name="Ana Souza" />);

    expect(tile()?.getAttribute('class')).toBe(TILE_CLASS);
    const image = tile()?.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://cdn.example/ana.png');
    expect(image?.getAttribute('alt')).toBe('');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(tile()?.textContent).toBe('');
  });

  it('renders the initials when there is no avatar', async () => {
    await render(<AccountAvatar name="Ana Souza" />);

    expect(tile()?.querySelector('img')).toBeNull();
    expect(tile()?.textContent).toBe('AS');
  });

  it('falls back to the initials when the image fails, and retries a NEW url', async () => {
    await render(<AccountAvatar avatarUrl="https://cdn.example/broken.png" name="Ana Souza" />);
    await act(async () => {
      tile()?.querySelector('img')?.dispatchEvent(new Event('error'));
    });
    expect(tile()?.querySelector('img')).toBeNull();
    expect(tile()?.textContent).toBe('AS');

    await render(<AccountAvatar avatarUrl="https://cdn.example/fresh.png" name="Ana Souza" />);
    expect(tile()?.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/fresh.png');
  });
});

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : listSources(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

describe('one shared AccountAvatar', () => {
  it('is implemented exactly once in apps/web/src', () => {
    const owners = listSources(webSrc).filter((file) =>
      /function AccountAvatar\b|const AccountAvatar\b/.test(readFileSync(file, 'utf8')),
    );
    expect(owners.map((file) => path.relative(webSrc, file))).toEqual([
      path.join('sales-ops', 'AccountAvatar.tsx'),
    ]);
  });

  it.each([
    ['sales-ops/SalesOpsApp.tsx', "from './AccountAvatar'"],
    ['sales-ops/MissingEntitlementPanel.tsx', "from './AccountAvatar'"],
    ['pages/errors/NoRolePage.tsx', "from '@/sales-ops/AccountAvatar'"],
  ])('%s imports the shared module', (file, specifier) => {
    const source = readSource(file);
    expect(source).toContain(specifier);
    expect(source).toContain('<AccountAvatar');
  });

  it('imports none of the surfaces that render it (no cycle)', () => {
    const imports = [...readSource('sales-ops/AccountAvatar.tsx').matchAll(/from '([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(imports.sort()).toEqual(['./calculations', 'react']);
  });
});
