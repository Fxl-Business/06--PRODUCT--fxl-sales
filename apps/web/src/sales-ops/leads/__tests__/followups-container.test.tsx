// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FollowupListRow, ListFollowupsParams } from '../crm-types';
import { FollowupsContainer } from '../FollowupsContainer';

const mocks = vi.hoisted(() => ({
  roles: ['admin'] as string[],
  params: [] as ListFollowupsParams[],
  rows: [] as FollowupListRow[],
  markDone: vi.fn(),
}));

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({ roles: mocks.roles }),
  useSalesEdition: () => 'full',
  useAccessToken: () => ({ getToken: async () => 'token' }),
}));
vi.mock('@fxl-sales/shared-utils/sao-paulo-day', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fxl-sales/shared-utils/sao-paulo-day')>();
  return { ...actual, todayInSaoPaulo: () => '2026-10-20' };
});
vi.mock('../crm-hooks', () => ({
  useFollowups: (params: ListFollowupsParams) => {
    mocks.params.push(params);
    return { isPending: false, isError: false, data: mocks.rows };
  },
  useMarkFollowupDone: () => ({ isPending: false, variables: undefined, mutate: mocks.markDone }),
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;

function Probe() {
  const location = useLocation();
  return <output data-path>{location.pathname}</output>;
}

async function render(workspace: 'operacional' | 'meus-dados') {
  root = createRoot(container);
  await act(async () => root?.render(
    <MemoryRouter initialEntries={[`/${workspace}/follow-ups`]}>
      <Routes>
        <Route element={<FollowupsContainer workspace={workspace} />} path="/:workspace/follow-ups" />
      </Routes>
      <Probe />
    </MemoryRouter>,
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
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
  mocks.roles = ['admin'];
  mocks.params = [];
  mocks.rows = [
    { id: 'fu-1', leadId: 'lead-1', leadContactName: 'Ana Souza', nextStep: 'Ligar', dueOn: '2026-10-21', ownerName: null, doneAt: null },
  ];
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
});

describe('FollowupsContainer', () => {
  it('under operacional as an admin the first query is the team scope over the next seven days', async () => {
    await render('operacional');
    expect(mocks.params[0]).toEqual({ scope: 'team', status: 'open', from: '2026-10-20', to: '2026-10-26' });
  });

  it('switching to Minha re-queries with the mine scope', async () => {
    await render('operacional');
    await click(q('[data-followup-scope="mine"]')!);
    expect(mocks.params.at(-1)).toMatchObject({ scope: 'mine' });
  });

  it('under meus-dados there is no scope toggle and the scope is mine', async () => {
    mocks.roles = ['seller'];
    await render('meus-dados');
    expect(q('[data-followup-scope="team"]')).toBeNull();
    expect(mocks.params[0]).toMatchObject({ scope: 'mine' });
  });

  it('a lead name navigates to the lead summary', async () => {
    await render('operacional');
    await click(q('[data-followup-open-lead="lead-1"]')!);
    expect(q('[data-path]')?.textContent).toBe('/operacional/leads/lead-1');
  });

  it('Concluir marks the follow-up done by id', async () => {
    await render('operacional');
    await click(q('[data-followup-done="fu-1"]')!);
    expect(mocks.markDone).toHaveBeenCalledWith('fu-1');
  });
});
