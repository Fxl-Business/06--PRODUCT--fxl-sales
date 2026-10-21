// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  effectiveStageBehavior,
  modulesForEdition,
  type OrgModules,
} from '@fxl-sales/shared-utils/crm-model';
import { OrgModulesContext } from '@/auth/org-modules-context';
import { LeadsBoardContainer } from '../leads/LeadsBoardContainer';
import type { SalesOpsLead, SalesOpsLeadStage } from '../leads/types';
import { pipelineFixtureFor } from '../leads/__tests__/pipeline-fixture';

/**
 * R1-3: moving a lead onto the Proposta stage through the non-drag path (`Mover`
 * in the Lista view) never requests a conversion while `orcamentos` is off, and
 * does while it is on.
 *
 * The board is driven for real: the Lista, the REAL `MoveLeadDialog` and the REAL
 * `Combobox`. Only the API layer is mocked. The org's modules are handed the way
 * the shell hands them (`OrgModulesContext`), and the stage behaviour is projected
 * the way the API projects it (`effectiveStageBehavior`), so the board sees exactly
 * what the server would send for that organization.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const modulesState = vi.hoisted(() => ({ current: null as OrgModules | null }));
const mutation = vi.hoisted(() => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})) }));
const query = vi.hoisted(() => ({ data: [] as SalesOpsLeadStage[], leads: [] as SalesOpsLead[] }));

vi.mock('../leads/crm-hooks', () => ({
  useFieldDefinitions: () => ({ isPending: false, data: [] }),
  usePipelines: () => {
    const fixture = pipelineFixtureFor(query.data);
    const modules = modulesState.current!;
    return {
      isPending: false,
      isError: false,
      isSuccess: true,
      data: fixture.pipelines.map((pipeline) => ({
        ...pipeline,
        stages: pipeline.stages.map((stage) => ({
          ...stage,
          behavior: effectiveStageBehavior({ type: stage.type, behavior: stage.behavior }, modules),
        })),
      })),
    };
  },
}));
vi.mock('../leads/hooks', () => ({
  useLeadStages: () => ({ data: query.data, isPending: false, isError: false }),
  useLeadsBoard: () => ({
    data: { leads: query.leads, hasMore: false },
    isPending: false,
    isError: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useLeadStageSummary: () => ({ data: undefined }),
  useMoveLead: () => mutation,
  useSaveLead: () => mutation,
  useDeleteLead: () => mutation,
}));
vi.mock('@/auth/react', async () => {
  const { editionFromModules: toEdition } = await import('@fxl-sales/shared-utils/crm-model');
  return {
    useAuthProfile: () => ({ roles: ['admin'] }),
    // The real `useSalesEdition` projects the shell's modules; mirror that projection.
    useSalesEdition: () => toEdition(modulesState.current!),
  };
});

let container: HTMLDivElement;
let root: Root;

const PROPOSTA_ID = 'proposta';
const DRAFT_ID = 'draft';

function stage(
  id: string,
  name: string,
  position: number,
  kind: SalesOpsLeadStage['kind'],
): SalesOpsLeadStage {
  return {
    id,
    name,
    position,
    kind,
    isSystem: kind !== 'normal',
    status: 'active',
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: null,
  };
}

const lead: SalesOpsLead = {
  id: 'lead-a',
  stageId: DRAFT_ID,
  position: 1,
  contactName: 'Ana',
  clientId: null,
  clientNameSnapshot: 'Acme',
  estimatedValueBrl: 100_000,
  description: null,
  contactPhone: null,
  contactEmail: null,
  contactBirthDate: null,
  sellerPersonId: null,
  sellerNameSnapshot: 'Marina',
  lostReason: null,
  stageChangedAt: '2026-09-15T00:00:00.000Z',
  saleId: null,
  saleStatus: null,
  saleCode: null,
  products: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: null,
};

const FULL: OrgModules = modulesForEdition('full');
const LEADS: OrgModules = modulesForEdition('leads');

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  query.data = [
    stage(DRAFT_ID, 'Contato', 1, 'normal'),
    stage(PROPOSTA_ID, 'Proposta', 2, 'conversion'),
  ];
  query.leads = [lead];
  mutation.mutateAsync.mockClear();
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

async function renderBoard(modules: OrgModules, onRequestConversion: ReturnType<typeof vi.fn>) {
  modulesState.current = modules;
  await act(async () => {
    root.render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <OrgModulesContext.Provider value={modules}>
          <LeadsBoardContainer
            clients={[]}
            onRequestConversion={onRequestConversion}
            people={[]}
            products={[]}
            routedMode="stage"
            selectedStageId={DRAFT_ID}
            sellers={[]}
            showSellerFilter={false}
            workspace="operacional"
          />
        </OrgModulesContext.Provider>
      </MemoryRouter>,
    );
  });
  await settle();
}

/** Moves the lead through the Lista `Mover` action and the real dialog. */
async function moveLeadTo(stageName: string) {
  await click(container.querySelector(`[data-move-trigger="${lead.id}"]`)!);
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) throw new Error('move dialog not rendered');
  await click(dialog.querySelector('[role="combobox"]')!);
  const option = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(
    (node) => node.textContent?.trim() === stageName,
  );
  if (!option) throw new Error(`stage "${stageName}" not offered`);
  await click(option);
  const confirm = dialog.querySelector<HTMLButtonElement>('[data-move-confirm]');
  if (!confirm) throw new Error('confirm button not found');
  await click(confirm);
}

describe('moving onto Proposta follows orcamentos', () => {
  it('orcamentos off: the lead moves and no conversion is requested', async () => {
    const onRequestConversion = vi.fn(async () => 'sale-1');
    await renderBoard(LEADS, onRequestConversion);

    await moveLeadTo('Proposta');

    expect(mutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: lead.id, toStageId: PROPOSTA_ID }),
    );
    expect(onRequestConversion).not.toHaveBeenCalled();
  });

  it('orcamentos on: the same move requests the conversion and rides the resolved sale id', async () => {
    const onRequestConversion = vi.fn(async () => 'sale-1');
    await renderBoard(FULL, onRequestConversion);

    await moveLeadTo('Proposta');

    expect(onRequestConversion).toHaveBeenCalledWith(
      expect.objectContaining({ lead: expect.objectContaining({ id: lead.id }), toStageId: PROPOSTA_ID }),
    );
    expect(mutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: lead.id, toStageId: PROPOSTA_ID, saleId: 'sale-1' }),
    );
  });
});
