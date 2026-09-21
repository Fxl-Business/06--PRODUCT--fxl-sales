// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeadCard } from '../LeadCard';
import { buildLabelLookups } from '../board-labels';
import type { SalesOpsLead } from '../types';

/**
 * ACCEPTANCE 7, AND THE WIRING NOTHING ELSE PINS.
 *
 * "O card mostra há quantos dias o lead está parado na etapa atual, derivado de
 * um `stage_changed_at` que muda APENAS quando a etapa muda e não em qualquer
 * edição do lead."
 *
 * `daysInCurrentStage` (the arithmetic) and `describeDaysInStage` (the pt-BR
 * copy) are each pinned in isolation by `leads-calculations.test.ts` and
 * `board-labels.test.ts`. Neither of them sees WHICH lead field the CARD feeds
 * into that arithmetic, so changing `LeadCard` to read `lead.updatedAt ??
 * lead.createdAt` left the whole suite green. This file closes that hole and
 * nothing else does.
 *
 * Every fixture here holds `stageChangedAt` DELIBERATELY FAR APART from both
 * `updatedAt` and `createdAt`, in both directions. A fixture where the dates
 * coincide would render the right badge under the wrong field and prove
 * nothing, which is the whole reason the gap existed.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });
const NOW = new Date('2026-09-18T12:00:00.000Z');

function lead(patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: 'bbbbbbbb-0000-4000-8000-00000000000a',
    stageId: 'aaaaaaaa-0000-4000-8000-000000000001',
    position: 1,
    contactName: 'Helena Braga',
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: 150_000,
    description: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Marina',
    lostReason: null,
    stageChangedAt: '2026-09-06T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

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
});

async function renderCard(value: SalesOpsLead) {
  await act(async () => {
    root.render(<LeadCard lead={value} lookups={LOOKUPS} now={NOW} />);
  });
}

function badge(): HTMLElement {
  const node = container.querySelector<HTMLElement>('[data-days-in-stage]');
  if (node === null) throw new Error('the card rendered no days-parked badge at all');
  return node;
}

describe('LeadCard days-parked badge', () => {
  it('derives the badge from stageChangedAt and not from updatedAt', async () => {
    // Parked 12 days; edited THIS MORNING. The two numbers cannot be confused.
    await renderCard(
      lead({
        stageChangedAt: '2026-09-06T12:00:00.000Z',
        updatedAt: '2026-09-18T09:00:00.000Z',
        createdAt: '2026-09-18T08:00:00.000Z',
      }),
    );

    expect(badge().getAttribute('data-days-in-stage')).toBe('12');
    expect(badge().textContent).toBe('há 12 dias');
    expect(badge().getAttribute('aria-label')).toBe('há 12 dias nesta etapa');
    // The `updatedAt` reading would be "hoje". It must be nowhere on the card.
    expect(container.textContent).not.toContain('hoje');
  });

  it('keeps a lead edited today reading as 12 days parked, which is what acceptance 7 means', async () => {
    const parked = lead({
      stageChangedAt: '2026-09-06T12:00:00.000Z',
      updatedAt: null,
      createdAt: '2026-09-01T12:00:00.000Z',
    });

    await renderCard(parked);
    expect(badge().getAttribute('data-days-in-stage')).toBe('12');

    // An ordinary lead edit: every field but `stageChangedAt` moves.
    await renderCard({
      ...parked,
      contactName: 'Helena Braga Filho',
      estimatedValueBrl: 990_000,
      description: 'renegociando o escopo',
      updatedAt: '2026-09-18T11:59:00.000Z',
    });

    expect(badge().getAttribute('data-days-in-stage')).toBe('12');
    expect(badge().textContent).toBe('há 12 dias');
  });

  it('reads today for a lead moved today but created long ago, so the createdAt fallback cannot pass either', async () => {
    await renderCard(
      lead({
        stageChangedAt: '2026-09-18T08:00:00.000Z',
        updatedAt: null,
        createdAt: '2026-08-09T12:00:00.000Z',
      }),
    );

    expect(badge().getAttribute('data-days-in-stage')).toBe('0');
    expect(badge().textContent).toBe('hoje');
    // The `createdAt` fallback reading would be "há 40 dias".
    expect(container.textContent).not.toContain('40');
  });

  it('follows stageChangedAt alone when only that timestamp moves', async () => {
    const base = lead({
      stageChangedAt: '2026-09-06T12:00:00.000Z',
      updatedAt: '2026-09-10T12:00:00.000Z',
      createdAt: '2026-09-01T12:00:00.000Z',
    });

    await renderCard(base);
    expect(badge().getAttribute('data-days-in-stage')).toBe('12');

    // A stage change: only `stageChangedAt` moves, and the badge must reset.
    await renderCard({ ...base, stageChangedAt: '2026-09-17T12:00:00.000Z' });
    expect(badge().getAttribute('data-days-in-stage')).toBe('1');
    expect(badge().textContent).toBe('há 1 dia');
  });
});
